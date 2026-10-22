// Tiny HTTP API over the crazy-mode Chrome: each agent gets its own named tab. POST JSON to
// /<tab>/<action>, GET / lists the open tabs. The `tab` script next to this file is the client.
// Chrome must already run with remote debugging (CRAZY_CDP, default http://127.0.0.1:9230).
//
// Loopback only by default. TABAPI_TAILNET=1 also listens on this machine's Tailscale addresses
// (never a wildcard) and answers loopback, this machine's tailnet addresses and TABAPI_ALLOW:
// comma-separated IPs or tailnet machine names, resolved through `tailscale status`. Other people's
// machines can share a tailnet, so binding to it alone isn't enough.
// TABAPI_BIND replaces the listen list, TABAPI_PORT the port (9777).
const http = require("http");
const net = require("net");
const { execFileSync } = require("child_process");
const { chromium } = require("patchright-core");

const PORT = Number(process.env.TABAPI_PORT) || 9777;
const LOOPBACK = ["127.0.0.1", "::1"];
/** "::ffff:100.1.2.3" (IPv4 on a dual-stack socket) is 100.1.2.3. */
const bare = (address = "") => address.replace(/^::ffff:/i, "").toLowerCase();

/** `tailscale status --json`, or undefined when tailscale isn't running here. */
function tailnet() {
  try {
    return JSON.parse(execFileSync("tailscale", ["status", "--json"], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return undefined;
  }
}

/** Who may call: loopback, this machine's tailnet addresses, and each TABAPI_ALLOW entry (an IP, or a tailnet machine name). */
function allowlist(status, allow = process.env.TABAPI_ALLOW ?? "") {
  const ips = [...LOOPBACK, ...(status?.Self?.TailscaleIPs ?? [])];
  const peers = Object.values(status?.Peer ?? {});
  for (const entry of allow.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    if (net.isIP(entry)) ips.push(entry);
    else for (const p of peers) if (p.DNSName?.split(".")[0].toLowerCase() === entry) ips.push(...(p.TailscaleIPs ?? []));
  }
  return new Set(ips.map(bare));
}

/** Where to listen: loopback plus this machine's tailnet addresses. Wildcards are dropped even from TABAPI_BIND. */
function binds(status, bind = process.env.TABAPI_BIND) {
  const list = bind ? bind.split(",").map((s) => s.trim()) : [...LOOPBACK, ...(status?.Self?.TailscaleIPs ?? [])];
  return [...new Set(list)].filter((a) => net.isIP(a) && !["0.0.0.0", "::"].includes(a));
}

/**
 * Runs in the page: every visible-or-not form control with what an agent needs to fill it. Replaces
 * the hand-written querySelectorAll evals. `selector` works as {selector} in the other actions.
 */
function formFields() {
  const text = (el) => (el ? (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim() : "");
  const byIds = (ids) => (ids || "").split(/\s+/).map((id) => text(document.getElementById(id))).filter(Boolean).join(" ");
  const labelOf = (el) =>
    byIds(el.getAttribute("aria-labelledby")) || (el.getAttribute("aria-label") || "").trim()
    || [...(el.labels || [])].map(text).filter(Boolean).join(" ") || el.placeholder || el.title || "";
  // A radio's or checkbox's own label is the option; the question is its fieldset or group.
  const groupOf = (el) => {
    const legend = el.closest("fieldset")?.querySelector("legend");
    if (legend) return text(legend);
    const g = el.closest('[role="radiogroup"],[role="group"]');
    return g ? byIds(g.getAttribute("aria-labelledby")) || (g.getAttribute("aria-label") || "").trim() : "";
  };
  const selectorOf = (el) => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (!el.name) return "";
    const tag = el.tagName.toLowerCase();
    return `${tag}[name="${CSS.escape(el.name)}"]${el.type === "radio" || el.type === "checkbox" ? `[value="${CSS.escape(el.value)}"]` : ""}`;
  };
  const skip = new Set(["hidden", "submit", "button", "reset", "image"]);
  return [...document.querySelectorAll("input, select, textarea")].filter((el) => !skip.has(el.type)).map((el) => {
    const tag = el.tagName.toLowerCase();
    const choice = el.type === "radio" || el.type === "checkbox";
    const field = {
      label: labelOf(el),
      name: el.name || "",
      id: el.id || "",
      type: tag === "input" ? el.type : tag,
      required: el.required || el.getAttribute("aria-required") === "true",
      value: tag === "select" ? [...el.selectedOptions].map((o) => o.text.trim()).join(", ")
        : el.type === "file" ? [...(el.files || [])].map((f) => f.name).join(", ")
        : el.value,
      selector: selectorOf(el),
      visible: el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden",
    };
    if (choice) Object.assign(field, { checked: el.checked, group: groupOf(el) });
    if (el.getAttribute("aria-invalid") === "true") field.invalid = true;
    if (tag === "select") field.options = [...el.options].slice(0, 50).map((o) => o.text.trim());
    return field;
  });
}

/**
 * Submit guard. Filling never submits: until a tab is armed (POST /<tab>/arm, sent by the runner
 * when the checked form moves to its submit step), clicks on a final-submit button and Enter outside a
 * textarea are refused. Enter in a Greenhouse field submitted four forms early on 2026-10-22, and
 * fillers clicked a last-step "Submit" to move on. Mirrors SUBMIT in src/buttons.ts, plus "Send".
 */
const SUBMIT_TEXT = /^(submit|submit application|submit your application|send|send application|finish|complete application|submit & apply|apply without saving|review and submit)$/i;
/** Why an action is refused on an unarmed tab, or undefined when it may run. `tag` is the target's tagName. */
function refuse({ action, text = "", key = "", value = "", tag = "", js = "", armed = false }) {
  if (armed) return;
  const inText = /^(textarea)$/i.test(tag);
  if (action === "click" && SUBMIT_TEXT.test(text.replace(/\s+/g, " ").trim())) return `"${text.trim()}" is the final submit; only the submit step may click it`;
  if (action === "press" && /^(Numpad)?Enter$/.test(key) && !inText) return "Enter can submit the form: click the option or the field's own button instead";
  if (action === "type" && /\n/.test(value) && !inText) return "a newline is an Enter, which can submit the form; type it without one";
  // eval is for reading the page (filler.md): a scripted click or submit skips every check above.
  if (action === "eval" && /\.(click|submit|requestSubmit)\s*\(|dispatchEvent\s*\(/.test(js)) return "eval may only read the page; use click, fill, type, select or check to change it";
}

let browser; const tabs = new Map(), popups = new Map(), used = new Map(), armed = new Set();
// Sites open popups and new tabs (OAuth, terms, target=_blank) that agents never see; they belong to
// the tab that opened them and close with it, so a finished job leaves nothing behind.
const own = (name, p) => p.on("popup", (pp) => { popups.get(name)?.add(pp); own(name, pp); });
async function closeTab(name) {
  for (const pp of popups.get(name) ?? []) await pp.close().catch(() => {});
  await tabs.get(name)?.close().catch(() => {});
  tabs.delete(name); popups.delete(name); used.delete(name); armed.delete(name);
}
/** POST /any/sweep: closes every page that no named tab owns (left by earlier tabapi runs), keeping one so Chrome stays up. */
async function sweep() {
  const keep = new Set([...tabs.values(), ...[...popups.values()].flatMap((s) => [...s])]);
  const pages = browser.contexts()[0].pages().filter((p) => !keep.has(p));
  for (const p of pages.slice(keep.size ? 0 : 1)) await p.close().catch(() => {});
  return `closed ${pages.length - (keep.size ? 0 : 1)}`;
}
const guard = (what, name) => { const why = refuse({ ...what, armed: armed.has(name) }); if (why) throw new Error(`refused: ${why}`); };
const loc = (p, b) => b.selector ? p.locator(b.selector).first()
  : b.label ? p.getByLabel(b.label, { exact: !!b.exact }).first()
  : p.getByRole(b.role || "button", { name: b.name, exact: !!b.exact }).first();
const actions = {
  open: async (p, b) => { await p.goto(b.url, { waitUntil: "domcontentloaded", timeout: 45000 }); await p.waitForTimeout(2500); return p.url(); },
  aria: async (p) => (await p.locator("body").ariaSnapshot()).slice(0, 40000),
  text: async (p) => (await p.locator("body").innerText()).slice(0, 20000),
  // Form controls in the page and its iframes; fields in an iframe carry its url as `frame`.
  fields: async (p) => {
    const out = [];
    for (const f of p.frames()) {
      const found = await f.evaluate(formFields).catch(() => []);
      out.push(...(f === p.mainFrame() ? found : found.map((x) => ({ ...x, frame: f.url() }))));
    }
    return JSON.stringify(out);
  },
  click: async (p, b, name) => {
    const l = loc(p, b);
    const text = await l.evaluate((el) => el.innerText || el.value || el.getAttribute("aria-label") || "", undefined, { timeout: 10000 }).catch(() => "");
    guard({ action: "click", text: String(text) }, name);
    await l.click({ timeout: 10000 }); await p.waitForTimeout(1500); return "ok " + p.url();
  },
  fill: async (p, b) => { await loc(p, b).fill(b.value, { timeout: 10000 }); return "ok"; },
  type: async (p, b, name) => {
    const l = loc(p, b);
    guard({ action: "type", value: b.value, tag: await l.evaluate((el) => el.tagName, undefined, { timeout: 10000 }).catch(() => "") }, name);
    await l.click({ timeout: 10000 }); await p.keyboard.type(b.value, { delay: 20 }); return "ok";
  },
  press: async (p, b, name) => {
    guard({ action: "press", key: b.key, tag: await p.evaluate(() => document.activeElement?.tagName ?? "").catch(() => "") }, name);
    await p.keyboard.press(b.key); return "ok";
  },
  // Runner only: lets this tab's submit step click Submit. Lasts until the tab closes.
  arm: async (p, b, name) => { armed.add(name); return "armed"; },
  select: async (p, b) => { await loc(p, b).selectOption(b.value, { timeout: 10000 }); return "ok"; },
  check: async (p, b) => { await loc(p, b).check({ timeout: 10000 }); return "ok"; },
  upload: async (p, b) => { await p.locator(b.selector || "input[type=file]").first().setInputFiles(b.path); return "ok"; },
  eval: async (p, b, name) => { guard({ action: "eval", js: b.js }, name); return JSON.stringify(await p.evaluate(b.js)); },
  shot: async (p, b) => { await p.screenshot({ path: b.path, fullPage: true }); return b.path; },
  close: async (p, b, name) => { await closeTab(name); return "closed"; },
};

async function handle(req, res) {
  let body = ""; for await (const c of req) body += c;
  if (req.method === "GET") { res.end(JSON.stringify({ tabs: [...tabs.keys()] })); return; }
  const [, name, action] = req.url.split("/");
  try {
    const b = body ? JSON.parse(body) : {};
    if (!actions[action] && action !== "sweep") throw new Error("actions: " + Object.keys(actions).join(","));
    browser ??= await chromium.connectOverCDP(process.env.CRAZY_CDP ?? "http://127.0.0.1:9230");
    if (action === "sweep") { res.end(await sweep()); return; }
    if (action === "close" && !tabs.has(name)) { res.end("closed"); return; }
    used.set(name, Date.now());
    let p = tabs.get(name);
    if (!p) { p = await browser.contexts()[0].newPage(); tabs.set(name, p); popups.set(name, new Set()); own(name, p); }
    const out = await actions[action](p, b, name);
    res.end(String(out));
  } catch (e) { res.statusCode = 500; res.end("ERROR " + String(e.message).split("\n").slice(0,3).join(" ")); }
}

function start() {
  // A named tab untouched for 30 minutes belongs to a job whose runner died; close it and its popups.
  setInterval(() => { for (const [name, at] of used) if (Date.now() - at > 30 * 60_000) { used.delete(name); closeTab(name); } }, 5 * 60_000);
  // Off the tailnet unless asked: then only loopback listens and answers.
  const status = process.env.TABAPI_TAILNET === "1" ? tailnet() : undefined;
  let allowed = allowlist(status);
  let refreshed = Date.now();
  const guard = (req, res) => {
    const from = bare(req.socket.remoteAddress);
    // An unknown caller may be an allowed machine on a new address: look again, at most once a minute.
    if (status && !allowed.has(from) && Date.now() - refreshed > 60_000) { allowed = allowlist(tailnet()); refreshed = Date.now(); }
    if (allowed.has(from)) return handle(req, res);
    console.log(`refused ${from} ${req.method} ${req.url}`);
    res.statusCode = 403; res.end("ERROR forbidden");
  };
  const listen = (address) => {
    const server = http.createServer(guard);
    // Tailscale may not be up yet at boot: keep trying its addresses; loopback still answers.
    server.on("error", (e) => {
      const retry = !LOOPBACK.includes(address);
      console.log(`can't listen on ${address}: ${e.code}${retry ? "; retrying in 30s" : ""}`);
      if (retry) setTimeout(() => listen(address), 30_000);
    });
    server.listen(PORT, address, () => console.log(`tabapi ${net.isIPv6(address) ? `[${address}]` : address}:${PORT}`));
  };
  for (const address of binds(status)) listen(address);
  console.log(`allowed: ${[...allowed].join(" ")}`);
}

if (require.main === module) start();
module.exports = { allowlist, binds, bare, formFields, refuse };

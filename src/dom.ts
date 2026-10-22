// Scripts that run inside the page. Kept as plain JS strings because tsx/esbuild injects
// helpers (`__name`) into compiled functions, which don't exist in the browser.

/** What the extractor returns per field. Matches the shape built in EXTRACT below. */
export type RawField = {
  id: string;
  kind: "text" | "textarea" | "select" | "radio" | "checkbox" | "checkboxes" | "combobox" | "file" | "date";
  /** input type for text-like fields (email, tel, url, number...). */
  type: string;
  label: string;
  required: boolean;
  filled: boolean;
  /** For select/radio/checkboxes: option labels. For radio/checkboxes, ids are in optionIds. */
  options: string[];
  optionIds: string[];
  /** combobox only: true when it's a text input you type into, false for a button that opens a list. */
  typeable: boolean;
  /** The heading the field sits under ("Education", "Work experience"), or "" when there's none. */
  section: string;
  /** Help text that goes with the question (aria-describedby, a hint or description next to it), or "". */
  hint: string;
};

/**
 * `([rootSelector, prefix]) => RawField[]`. Tags every control with data-jh="<id>" so the
 * node side can find it again. A control keeps its tag across extractions, so an id means the
 * same element for the whole run; new controls get `<prefix><n>`, and the caller passes a
 * prefix unique per extraction and frame. A tag copied onto a cloned node gets replaced.
 */
export const EXTRACT = String.raw`(([rootSelector, prefix]) => {
  const scope = (rootSelector && document.querySelector(rootSelector)) || document.body;
  if (!scope) return [];
  let n = 0;
  const used = new Set();
  const tagOf = (el) => {
    let id = el.getAttribute("data-jh");
    if (!id || used.has(id)) {
      id = prefix + (n++);
      el.setAttribute("data-jh", id);
    }
    used.add(id);
    return id;
  };
  const clean = (t) => (t || "").replace(/\s+/g, " ").trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  // A <label> wrapping a <select> also holds every option's text; drop the select from a copy.
  const wrapText = (wrap, el) => {
    if (el.tagName !== "SELECT") return wrap.innerText;
    const copy = wrap.cloneNode(true);
    copy.querySelectorAll("select").forEach((x) => x.remove());
    return copy.textContent;
  };
  const textOfIds = (ids) => clean(ids.split(/\s+/).map((i) => document.getElementById(i)?.innerText || "").join(" "));
  const ownLabel = (el) => {
    const by = el.getAttribute("aria-labelledby");
    if (by && textOfIds(by)) return textOfIds(by);
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l && clean(l.innerText)) return clean(l.innerText);
    }
    const wrap = el.closest("label");
    if (wrap && clean(wrap.innerText)) return clean(wrapText(wrap, el));
    if (el.getAttribute("aria-label")) return clean(el.getAttribute("aria-label"));
    return "";
  };
  // Text of node or its nearest ancestor that has any, minus exclude (option labels, select options).
  const textUp = (node, exclude = []) => {
    for (let i = 0; node && node !== document.body && i < 6; i++, node = node.parentElement) {
      let t = clean(node.innerText);
      for (const x of exclude) if (x) t = t.split(x).join(" ");
      t = clean(t);
      if (t) return t.length > 400 ? t.slice(0, 400) : t;
    }
    return "";
  };
  const contextLabel = (el, exclude = []) => textUp(el.parentElement, exclude);
  const isRequired = (el, label) =>
    el.required || el.getAttribute("aria-required") === "true" || /\*\s*$/.test(label) || /\(required\)/i.test(label);

  const out = [];
  const seenControls = new Set();
  const controls = scope.querySelectorAll(
    "input, textarea, select, [role=combobox], button[aria-haspopup=listbox], button[aria-haspopup=true], button[aria-haspopup=menu]"
  );
  // A menu button that stands in for a hidden native select (BambooHR's "Province –Select–"
  // toggle): the select a few levels up is its twin, with the real label, value and required flag.
  const twinSelect = (el) => {
    for (let node = el.parentElement, i = 0; node && i < 6; node = node.parentElement, i++) {
      const selects = node.querySelectorAll("select");
      const s = selects[0];
      if (selects.length === 1) return !visible(s) || s.getAttribute("aria-hidden") === "true" || getComputedStyle(s).opacity === "0" ? s : null;
      if (selects.length > 1) return null;
    }
    return null;
  };
  for (const el of controls) {
    if (el.closest("header, nav, [role=search]")) continue;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (tag === "input" && ["hidden", "submit", "button", "search", "image", "reset"].includes(type)) continue;
    if (el.disabled) continue;

    if (type === "file") {
      const id = tagOf(el);
      const label = ownLabel(el) || contextLabel(el) || "file upload";
      out.push({ id, kind: "file", type, label, required: isRequired(el, label), filled: el.files && el.files.length > 0,
        options: [], optionIds: [], typeable: false });
      continue;
    }

    if (type === "radio" || type === "checkbox") {
      const name = el.name;
      const byName = name
        ? [...scope.querySelectorAll('input[type="' + type + '"][name="' + CSS.escape(name) + '"]')]
        : [el];
      // Checkboxes with their own names but one shared fieldset (Ashby) are one question.
      const box = type === "checkbox" && byName.length === 1 && el.closest("fieldset, [role=group]");
      const siblings = box ? [...box.querySelectorAll('input[type="checkbox"]')] : [];
      const group = siblings.length > 1 ? siblings : byName;
      if (seenControls.has(el)) continue;
      group.forEach((g) => seenControls.add(g));
      // Custom-styled radios hide the input; the group counts if its labels are visible.
      const shown = group.filter((g) => visible(g) || (g.labels && [...g.labels].some(visible)));
      if (!shown.length) continue;
      // LinkedIn's Easy Apply leaves each radio's <label> empty and puts "Yes" in a <p> beside
      // it, so an unlabeled option takes the text of its biggest wrapper holding no other option.
      const optionText = (g) => {
        if (group.length < 2) return "";
        let box = g;
        while (box.parentElement && !group.some((o) => o !== g && box.parentElement.contains(o))) box = box.parentElement;
        return box === g ? "" : clean(box.innerText);
      };
      const optionLabels = group.map((g) => ownLabel(g) || optionText(g) || g.value);
      const optionIds = group.map(tagOf);
      // Single checkbox ("I agree", "Follow company"): its own label is the question.
      if (type === "checkbox" && group.length === 1) {
        const label = optionLabels[0] || contextLabel(el);
        out.push({ id: optionIds[0], kind: "checkbox", type, label, required: isRequired(el, label),
          filled: el.checked, options: [], optionIds: [], typeable: false });
        continue;
      }
      const fieldset = el.closest("fieldset");
      const legend = fieldset && fieldset.querySelector("legend");
      const rg = el.closest("[role=radiogroup], [role=group]");
      const rgLabel = rg && ownLabel(rg);
      let common = group[0].parentElement;
      while (common && !group.every((g) => common.contains(g))) common = common.parentElement;
      const label = clean(legend && legend.innerText) || rgLabel || textUp(common, optionLabels) || name;
      out.push({ id: "g" + optionIds[0], kind: type === "radio" ? "radio" : "checkboxes", type, label,
        required: group.some((g) => g.required) || isRequired(fieldset || common || el, label),
        filled: group.some((g) => g.checked), options: optionLabels, optionIds, typeable: false });
      continue;
    }

    if (!visible(el)) continue;
    // Hidden twins that some widgets (react-select) keep for native validation.
    if (el.closest("[aria-hidden=true]") || (el.tabIndex < 0 && getComputedStyle(el).opacity === "0")) continue;
    const id = tagOf(el);

    if (tag === "select") {
      const options = [...el.options].map((o) => clean(o.text));
      const label = ownLabel(el) || contextLabel(el, options);
      const sel = el.options[el.selectedIndex];
      const filled = !!sel && el.selectedIndex > 0 && !!sel.value && !/^(select|choose|--|please)/i.test(clean(sel.text));
      out.push({ id, kind: "select", type: "select", label, required: isRequired(el, label), filled,
        options, optionIds: [], typeable: false });
      continue;
    }

    const popup = el.getAttribute("aria-haspopup");
    const twin = tag === "button" && (popup === "true" || popup === "menu") ? twinSelect(el) : null;
    // Any other menu button (a nav menu, "More actions") isn't a question.
    if (tag === "button" && (popup === "true" || popup === "menu") && !twin) continue;
    if (twin) {
      const label = ownLabel(twin) || clean(el.getAttribute("aria-label")).replace(/\s*[–-]+\s*select\s*[–-]+\s*$/i, "") || contextLabel(el);
      const shown = clean(el.innerText);
      const filled = !!twin.value || (!!shown && !/^[–-]*\s*(select|choose)/i.test(shown));
      out.push({ id, kind: "combobox", type: "combobox", label, required: twin.required || isRequired(el, label), filled,
        options: [], optionIds: [], typeable: false });
      continue;
    }
    const isCombo = el.getAttribute("role") === "combobox" || popup === "listbox";
    if (isCombo) {
      const typeable = tag === "input";
      const label = ownLabel(el) || contextLabel(el);
      const shownValue = typeable ? el.value : clean(el.innerText);
      // react-select and friends render the chosen value in a sibling, not in the input.
      let chosen = null;
      for (let node = el.parentElement, i = 0; node && !chosen && i < 5; node = node.parentElement, i++) {
        chosen = node.querySelector("[class*=single-value], [class*=singleValue], [class*=multi-value], [class*=multiValue]");
      }
      const filled = !!(chosen && clean(chosen.innerText)) || (!!shownValue && !/^(select|choose|search)/i.test(shownValue));
      out.push({ id, kind: "combobox", type: "combobox", label, required: isRequired(el, label), filled,
        options: [], optionIds: [], typeable });
      continue;
    }

    if (tag === "textarea" || tag === "input") {
      const label = ownLabel(el) || clean(el.placeholder) || contextLabel(el) || el.name;
      const kind = tag === "textarea" ? "textarea" : type === "date" ? "date" : "text";
      out.push({ id, kind, type: type || "text", label, required: isRequired(el, label), filled: !!el.value,
        options: [], optionIds: [], typeable: false });
    }
  }

  // Button choices (Ashby's Yes/No, "pill" pickers): 2 to 6 pressable buttons sharing a parent,
  // with no form input of their own. Treated as a radio question; filling clicks the button.
  const seenParents = new Set();
  for (const btn of scope.querySelectorAll("button[aria-pressed]")) {
    const parent = btn.parentElement;
    if (!parent || seenParents.has(parent) || !visible(btn)) continue;
    seenParents.add(parent);
    const buttons = [...parent.querySelectorAll(":scope > button[aria-pressed]")].filter(visible);
    if (buttons.length < 2 || buttons.length > 6) continue;
    const field = parent.closest("[data-field-path], fieldset, [role=group]") || parent.parentElement;
    const heading = field && field.querySelector("label, legend, [class*=title], [class*=label]");
    const options = buttons.map((b) => clean(b.innerText));
    const label = clean(heading && heading.innerText) || textUp(parent.parentElement, options);
    const optionIds = buttons.map(tagOf);
    out.push({ id: "g" + optionIds[0], kind: "radio", type: "buttons", label,
      required: /\*\s*$/.test(label) || !!(heading && /required/i.test(heading.className)),
      filled: buttons.some((b) => b.getAttribute("aria-pressed") === "true"), options, optionIds, typeable: false });
  }
  // The nearest heading above each field, so "Start date year" under Education can be told apart
  // from the same label under Work experience.
  const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6, legend, [role=heading]"))
    .filter((h) => h.innerText && h.innerText.trim().length < 80);
  for (const f of out) {
    const el = document.querySelector('[data-jh="' + f.id + '"]') || document.querySelector('[data-jh="' + f.id.replace(/^g/, "") + '"]');
    let section = "";
    if (el) for (const h of headings) if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) section = h.innerText.trim();
    f.section = section;
    // The question's help text: what aria-describedby points at, else a hint/description element
    // in the field's own container (format examples like "e.g. 80% backend, 20% frontend").
    let hint = "";
    if (el) {
      const ids = (el.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
      hint = ids.map((i) => { const d = document.getElementById(i); return d ? d.innerText : ""; }).join(" ");
      if (!hint.trim()) {
        const box = el.closest("[class*=field], [class*=question], fieldset, li") || el.parentElement;
        const d = box && box.querySelector("[class*=description], [class*=hint], [class*=help], [class*=instruction], [class*=subtitle], small");
        hint = d && !d.contains(el) ? d.innerText : "";
      }
      // A placeholder that isn't the label is a format hint ("mm/dd/yyyy" on BambooHR's date picker).
      if (!hint.trim() && el.placeholder && clean(el.placeholder) !== f.label) hint = el.placeholder;
    }
    f.hint = clean(hint).slice(0, 400);
  }
  return out;
})`;

/** `(rootSelector) => string[]`: visible validation errors inside the root. */
export const ERRORS = String.raw`((rootSelector) => {
  const scope = (rootSelector && document.querySelector(rootSelector)) || document.body;
  const els = scope.querySelectorAll("[role=alert], [aria-invalid=true], [class*=error], [class*=Error], [class*=invalid]");
  const texts = new Set();
  for (const el of els) {
    const r = el.getBoundingClientRect();
    const t = (el.innerText || "").replace(/\s+/g, " ").trim();
    if (r.width > 0 && r.height > 0 && t && t.length < 200) texts.add(t);
  }
  return [...texts];
})`;

/** `([rootSelector, pattern]) => string | null`: tags the best visible button/link matching the regex and returns its text. */
export const FIND_BUTTON = String.raw`(([rootSelector, source, flags, tag]) => {
  const scope = (rootSelector && document.querySelector(rootSelector)) || document.body;
  const re = new RegExp(source, flags);
  const clean = (t) => (t || "").replace(/\s+/g, " ").trim();
  const candidates = scope.querySelectorAll("button, a, [role=button], input[type=submit], input[type=button]");
  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0) || el.disabled || el.getAttribute("aria-disabled") === "true") continue;
    const text = clean(el.innerText || el.value || el.getAttribute("aria-label") || "");
    const aria = clean(el.getAttribute("aria-label") || "");
    if ((text && re.test(text)) || (aria && re.test(aria))) {
      document.querySelectorAll("[data-jh-btn='" + tag + "']").forEach((x) => x.removeAttribute("data-jh-btn"));
      el.setAttribute("data-jh-btn", tag);
      return text || aria;
    }
  }
  return null;
})`;

/**
 * `() => boolean`: true when the page is a login or signup wall, not an application form that
 * happens to have a password box. The first visible password's form (or the page) must have no
 * file upload or textarea and at most four other visible text-like inputs or selects.
 */
export const LOGIN_PAGE = String.raw`(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  const password = [...document.querySelectorAll("input[type=password]")].find(visible);
  if (!password) return false;
  const scope = password.closest("form") || document.body;
  if ([...scope.querySelectorAll("input[type=file], textarea")].some(visible)) return false;
  const skip = ["hidden", "password", "checkbox", "radio", "submit", "button", "image", "reset", "file"];
  const others = [...scope.querySelectorAll("input, select")]
    .filter((el) => !skip.includes((el.getAttribute("type") || "").toLowerCase()) && visible(el));
  return others.length <= 4;
})()`;

import { mkdirSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { chromium as patchright } from "patchright-core";
import { chromium, type BrowserContext, type Page } from "playwright";
import { paths } from "./config.ts";
import { onShutdown } from "./shutdown.ts";

export type BrowserOpts = {
  /** No window. Anything that needs a human fails instead of pausing. */
  headless: boolean;
  /** Attach to a Chrome already running with --remote-debugging-port, e.g. http://127.0.0.1:9222. */
  cdp?: string;
};

/**
 * Opens the harness's own persistent Chrome profile, so logins survive between runs.
 * Uses installed Chrome when present (fewer bot checks than bundled Chromium).
 */
export async function openBrowser(opts: BrowserOpts): Promise<{ context: BrowserContext; page: Page; close: () => Promise<void> }> {
  if (opts.cdp) return attach(opts.cdp);
  mkdirSync(paths.browserProfile, { recursive: true });
  const launch = (channel?: string) =>
    chromium.launchPersistentContext(paths.browserProfile, {
      headless: opts.headless,
      channel,
      viewport: null,
      args: ["--disable-blink-features=AutomationControlled", "--window-size=1400,1000"],
    });
  // Bundled Chromium only when Chrome itself isn't installed; any other Chrome failure (the
  // profile still held by another run) is the real error, so it surfaces as-is.
  const context = await launch("chrome").catch((error: unknown) => {
    if (/chrome.*(not found|is not installed)|Executable doesn't exist/i.test(String(error))) return launch();
    throw error;
  });
  const page = context.pages()[0] ?? (await context.newPage());
  let done: Promise<void> | undefined;
  const close = () =>
    (done ??= context.close().catch(() => {}).finally(() => forget()));
  const forget = onShutdown(close);
  return { context, page, close };
}

/**
 * Someone else's Chrome: a tab of our own in its default context (a new context would have none
 * of its cookies), closing only that tab and the popups it opened. Other tabs, including ones
 * opened by other agents while we run, are never touched, and closing just disconnects.
 * patchright-core, not playwright: it skips the CDP Runtime.enable call bot checks look for.
 */
async function attach(endpoint: string): Promise<{ context: BrowserContext; page: Page; close: () => Promise<void> }> {
  const browser = await patchright.connectOverCDP(endpoint);
  // Same client API as playwright, declared in its own copy of the types, which TypeScript can't
  // match up (overloaded generics). This is the one place the two meet.
  const context = browser.contexts()[0] as unknown as BrowserContext | undefined;
  if (!context) {
    await browser.close();
    throw new Error(`The Chrome at ${endpoint} has no browser context to open a tab in`);
  }
  const page = await context.newPage();
  const ours = new Set<Page>([page]);
  const adopt = async (p: Page) => {
    const opener = await p.opener().catch(() => null);
    if (opener && ours.has(opener)) ours.add(p);
  };
  context.on("page", adopt);
  let done: Promise<void> | undefined;
  const close = () =>
    (done ??= (async () => {
      forget();
      context.off("page", adopt);
      for (const p of ours) await p.close().catch(() => {});
      await browser.close();
    })());
  // A stopping runner closes its tabs, not the Chrome it attached to.
  const forget = onShutdown(close);
  return { context, page, close };
}

let headless = false;
export const setHeadless = (value: boolean) => (headless = value);
/** Off for auto-submit runs: nobody is watching, so a question fails the job instead of waiting. */
let interactive = true;
export const setInteractive = (value: boolean) => (interactive = value);

/** Asks you something in the terminal. Headless, auto mode or no TTY: nobody to ask, so it throws. */
export async function ask(question: string): Promise<string> {
  if (!interactive) throw new Error(`Needs a human (auto mode): ${question}`);
  if (headless || !process.stdin.isTTY) {
    throw new Error(`Needs a human: ${question}. Rerun with a visible browser.`);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(`\n${question} `)).trim();
  } finally {
    rl.close();
  }
}

/** Reads a line without echoing it, for passwords. */
export async function askHidden(question: string): Promise<string> {
  process.stdout.write(question);
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const muted = rl as unknown as { _writeToOutput: (s: string) => void };
  muted._writeToOutput = () => {};
  try {
    return (await rl.question("")).trim();
  } finally {
    rl.close();
    process.stdout.write("\n");
  }
}

import { guardClick } from "./drylock.ts";
import type { Locator, Page } from "playwright";
import { FIND_BUTTON } from "./dom.ts";

// Button text patterns shared by every flow, and helpers to find or click them.

export const NEXT = /^(next|continue|save (and|&) continue|save and next|review|review (your )?application|proceed|next step|continue to next step)$/i;
/** Gem's form offers "Apply and save" (makes a Gem profile) and "Apply without saving": only the second matches. */
export const SUBMIT = /^(submit|submit application|submit your application|send application|finish|complete application|submit & apply|apply without saving)$/i;
/** SUBMIT plus a bare "Apply". Only used once this run filled something, since "Apply" is also how a posting opens its form. */
export const SUBMIT_OR_APPLY = /^(submit|submit application|submit your application|send application|apply|apply now|finish|complete application|submit & apply|apply without saving)$/i;
/** Ordered: "Apply Manually" beats Workday's resume autofill, plain "Apply" comes last. */
export const START = [
  /^apply manually$/i,
  /^(apply|apply now|apply here|apply for this (job|position|role)|start (your )?application|i'?m interested|easy apply)$/i,
  /\bapply\b/i,
];

/**
 * The first visible button or link matching `pattern`, as a locator. Looks in the page first,
 * then in embedded frames (Stripe and other company sites put the Greenhouse form in an iframe,
 * Submit included). `root` scopes the search to a modal in the page itself.
 */
export async function findButton(page: Page, pattern: RegExp, root?: string): Promise<Locator | undefined> {
  const tag = `b${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const frames = root ? [page.mainFrame()] : page.frames();
  for (const frame of frames) {
    const hit = await frame.evaluate(`${FIND_BUTTON}(${JSON.stringify([root ?? null, pattern.source, pattern.flags, tag])})`).catch(() => null);
    if (hit) return frame.locator(`[data-jh-btn="${tag}"]`);
  }
  return undefined;
}

/** Clicks the first visible button whose text or aria-label matches. False if there is none. */
export async function clickButton(page: Page, pattern: RegExp, root?: string): Promise<boolean> {
  const button = await findButton(page, pattern, root);
  if (!button) return false;
  await guardClick(button);
  // Workday lays a transparent click catcher over its buttons; a forced click lands on it.
  await button.click({ timeout: 3000 }).catch(() => button.click({ force: true }));
  return true;
}

/** Waits for the page to calm down after a click or navigation. */
export async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);
}

import { AsyncLocalStorage } from "node:async_hooks";
import type { Locator } from "playwright";

// The hard rule for drafts: a dry run never submits anything. Every button click goes through
// guardClick(); inside a dry run it refuses a button labelled submit/send/apply/finish/complete/
// confirm that is a submit button or sits in a form the run has typed into.
// "Apply" that opens a form (a link, or a button outside any filled form) still works.

const dry = new AsyncLocalStorage<boolean>();

/** Runs `fn` as a dry run (or not): clicks inside it are checked by guardClick. */
export const withDryLock = <T>(isDry: boolean, fn: () => Promise<T>): Promise<T> => dry.run(isDry, fn);

const SENDS = /submit|send|apply|finish|complete|confirm/i;

/** Throws instead of clicking when a dry run is about to press a form's submit button. */
export async function guardClick(button: Locator): Promise<void> {
  if (!dry.getStore()) return;
  const risky = await button.evaluate((el, sends) => {
    const b = el as HTMLButtonElement;
    const text = `${b.innerText || ""} ${b.value || ""} ${b.getAttribute("aria-label") || ""}`;
    const form = b.closest("form");
    const typed = form && Array.from(form.querySelectorAll("input:not([type=hidden]):not([type=file]), textarea, select"))
      .some((i) => (i as HTMLInputElement).value && (i as HTMLInputElement).type !== "checkbox" && (i as HTMLInputElement).type !== "radio");
    // A Next/Continue that's type=submit only changes page; the text is what tells a real send.
    return new RegExp(sends, "i").test(text) && (b.type === "submit" || !!typed);
  }, SENDS.source).catch(() => true);
  if (risky) throw new Error("dry run refused to click a button that would submit the form");
}

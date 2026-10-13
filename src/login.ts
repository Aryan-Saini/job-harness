import type { Page } from "playwright";
import { ask } from "./browser.ts";
import { clickButton } from "./buttons.ts";
import { LOGIN_PAGE } from "./dom.ts";
import { credFor, setCred } from "./secrets.ts";
import { siteKey } from "./sites.ts";

// Login walls. Sign in with the saved login (or the default identity), create an account
// when the site wants one. Email verification, captchas and 2FA go to you.

const visiblePasswords = (page: Page) => page.locator("input[type=password]:visible").count();
/** A login or signup wall, as opposed to an application form with an optional "create a password" box. */
export const onLoginPage = async (page: Page) => (await page.evaluate(LOGIN_PAGE).catch(() => false)) === true;

/**
 * A captcha challenge on screen: reCAPTCHA's image grid, Cloudflare's check, or hCaptcha's
 * full-screen challenge (its small checkbox widget alone doesn't count).
 */
export async function hasCaptcha(page: Page): Promise<boolean> {
  const frames = page.locator('iframe[src*="recaptcha"][src*="bframe"], iframe[src*="challenges.cloudflare"], iframe[src*="hcaptcha"]');
  for (let i = 0; i < (await frames.count().catch(() => 0)); i++) {
    const frame = frames.nth(i);
    if (!(await frame.isVisible().catch(() => false))) continue;
    const box = await frame.boundingBox().catch(() => null);
    if (box && box.width > 300 && box.height > 300) return true;
  }
  return false;
}

/**
 * Gets past a login or signup wall if the page shows one. Returns true when it did something,
 * so the caller re-scans the page. Drafts create accounts too (every Workday tenant needs its
 * own, and an account isn't an application). Only explicit sign-in / create-account buttons get
 * clicked (or Enter in the password box), never a generic Continue or Submit, so it can't
 * send an application form by mistake.
 */
export async function handleAuth(page: Page): Promise<boolean> {
  const passwords = await visiblePasswords(page);
  if (!passwords || !(await onLoginPage(page))) {
    // Sign-in choosers (Workday): pick plain email over Google / LinkedIn SSO.
    return clickButton(page, /^(sign in|log in|continue|apply) with (email|e-mail)$/i);
  }
  const host = new URL(page.url()).hostname;
  const cred = credFor(host);
  if (!cred) {
    await ask(`Login wall on ${host} and no default login saved (run \`jh login default\`). Log in by hand, then press enter.`);
    return true;
  }
  // First visit with no account here yet: switch the sign-in form to account creation.
  if (passwords === 1 && !cred.saved && (await clickButton(page, /^(create account|create an account|sign up|register)$/i))) {
    await page.waitForTimeout(1500);
    if ((await visiblePasswords(page)) >= 2) return true;
  }

  const signup = passwords >= 2;
  const email = page.locator(
    "input[type=email]:visible, input[autocomplete=email]:visible, input[autocomplete=username]:visible, input[name*=email i]:visible, input[id*=email i]:visible, input[data-automation-id*=email i]:visible, input[name*=user i]:visible",
  ).first();
  if (await email.count()) await email.fill(cred.email);
  else await page.getByLabel(/e-?mail/i).first().fill(cred.email).catch(() => {});
  const pw = page.locator("input[type=password]:visible");
  const send = async (password: string) => {
    for (let i = 0; i < passwords; i++) await pw.nth(i).fill(password);
    const clicked = signup
      ? await clickButton(page, /^(create account|create an account|create my account|sign up|register)$/i)
      : await clickButton(page, /^(sign in|log in|login)$/i);
    if (!clicked) await pw.last().press("Enter");
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(3000);
  };

  if (signup) {
    // Terms / privacy boxes on account creation forms.
    const boxes = page.locator("input[type=checkbox]:visible");
    for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check({ force: true }).catch(() => {});
  }
  await send(cred.password);
  // A site that rejects the plain password on signup gets the stronger one, which is then saved.
  if (signup && cred.stronger && (await onLoginPage(page)) && (await visiblePasswords(page)) >= 2) {
    await send(cred.stronger);
    cred.password = cred.stronger;
  }

  if (await hasCaptcha(page)) await ask("Captcha on screen. Solve it in the browser, then press enter.");
  if (await onLoginPage(page)) {
    await ask(`Still on the ${signup ? "signup" : "login"} page for ${host} (account exists, wrong password, 2FA, or a checkpoint). Finish it in the browser, then press enter.`);
    return true;
  }
  if (!cred.saved) setCred(host, cred.email, cred.password, signup ? "created by jh" : undefined);
  if (signup) {
    console.log(`  created account on ${host} as ${cred.email}`);
    const body = await page.innerText("body").catch(() => "");
    if (/verif|confirm your (email|account)|check your (email|inbox)|sent (you )?an? (email|code|link)|activate/i.test(body)) {
      await ask(`${host} wants you to verify ${cred.email}. Open the email, verify, then press enter.`);
    }
  }
  return true;
}

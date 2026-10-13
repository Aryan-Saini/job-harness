import { all, exec, kvGet, kvSet } from "./db.ts";

// Site logins live in the database, in plain text, so keep ~/.jh private. One row per host in
// `logins` (every Workday tenant is its own host, so its own account), and the identity used
// for new accounts in kv `login-default`.

export type Cred = { email: string; password: string };
/** The identity for new accounts. `stronger` is for sites that reject the plain password. */
export type DefaultLogin = Cred & { stronger?: string };

export const defaultLogin = () => kvGet<DefaultLogin>("login-default");

/** The site's own login if one is saved, else the default identity. */
export function credFor(host: string): (Cred & { saved: boolean; stronger?: string }) | undefined {
  const site = all<Cred>("SELECT email, password FROM logins WHERE site = ?", host)[0];
  if (site) return { ...site, saved: true };
  const fallback = defaultLogin();
  return fallback && { ...fallback, saved: false };
}

export function setCred(host: string | "default", email: string, password: string, note?: string) {
  if (host === "default") return kvSet("login-default", { ...defaultLogin(), email, password });
  exec([
    "INSERT INTO logins (site, email, password, created_at, note) VALUES (?, ?, ?, ?, ?) ON CONFLICT(site) DO UPDATE SET email = excluded.email, password = excluded.password, note = excluded.note",
    [host, email, password, new Date().toISOString(), note ?? null],
  ]);
}

/** Saved logins without passwords, for `jh login list`. */
export const listLogins = () => all<{ site: string; email: string; created_at: string }>("SELECT site, email, created_at FROM logins ORDER BY created_at");

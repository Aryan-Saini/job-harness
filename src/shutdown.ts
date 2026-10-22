import type { ChildProcess } from "node:child_process";

// Quick exit for the long-running `jh run` on SIGTERM/SIGINT (Ctrl-C, a service stop or restart).
// Without it Playwright's own SIGTERM handler swallows the signal: it closes the browsers but
// leaves the loop running until something kills it harder. A claim the dead process held expires
// and goes back in the queue (runner.ts requeueStale), so nothing here touches the DB.

const children = new Set<ChildProcess>();
const closers = new Set<() => Promise<void>>();
/** How long browsers get to close before the process exits anyway. */
const GRACE_MS = 4000;

/** Kills `child` on shutdown (a model CLI mid-call). Forgets it once it exits. */
export function trackChild(child: ChildProcess) {
  children.add(child);
  child.once("exit", () => children.delete(child));
}

/** Runs `close` on shutdown (a browser). Returns the unregister function, for a normal close. */
export function onShutdown(close: () => Promise<void>): () => void {
  closers.add(close);
  return () => closers.delete(close);
}

/** Installs the handlers. Only `jh run` uses it; interactive commands keep the default behavior. */
export function exitOnSignals() {
  let stopping = false;
  const stop = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: closing ${closers.size} browser${closers.size === 1 ? "" : "s"}, killing ${children.size} agent${children.size === 1 ? "" : "s"}`);
    for (const child of children) child.kill("SIGKILL");
    const code = signal === "SIGINT" ? 130 : 143;
    setTimeout(() => process.exit(code), GRACE_MS).unref();
    void Promise.allSettled([...closers].map((close) => close())).then(() => process.exit(code));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

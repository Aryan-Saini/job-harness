import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// A runner stand-in: a browser whose close hangs, a model CLI mid-call, and a loop that never ends.
const runner = `
import { spawn } from "node:child_process";
import { exitOnSignals, onShutdown, trackChild } from ${JSON.stringify(resolve(import.meta.dirname, "../src/shutdown.ts"))};
exitOnSignals();
onShutdown(() => new Promise(() => {}));
const child = spawn("sleep", ["300"]);
trackChild(child);
console.log(child.pid);
setInterval(() => {}, 1000);
`;

describe("jh run shutdown", () => {
  it("exits within the grace period on SIGTERM and kills child agents", async () => {
    const proc = spawn(resolve(import.meta.dirname, "../node_modules/.bin/tsx"), ["--input-type=module", "-e", runner], { stdio: ["ignore", "pipe", "inherit"] });
    const childPid = await new Promise<number>((done) => proc.stdout.once("data", (d) => done(Number(String(d).trim()))));
    const started = Date.now();
    proc.kill("SIGTERM");
    const code = await new Promise<number | null>((done) => proc.once("exit", (c) => done(c)));
    expect(code).toBe(143);
    expect(Date.now() - started).toBeLessThan(6000);
    expect(() => process.kill(childPid, 0)).toThrow();
  }, 15_000);
});

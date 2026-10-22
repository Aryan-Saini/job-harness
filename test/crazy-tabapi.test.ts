import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

type Status = { Self?: { TailscaleIPs: string[] }; Peer?: Record<string, { DNSName: string; TailscaleIPs: string[] }> };
const { allowlist, binds, refuse } = createRequire(import.meta.url)("../crazy/tabapi.cjs") as {
  allowlist: (status: Status | undefined, allow?: string) => Set<string>;
  binds: (status: Status | undefined, bind?: string) => string[];
  refuse: (what: { action: string; text?: string; key?: string; value?: string; tag?: string; js?: string; armed?: boolean }) => string | undefined;
};

describe("crazy tab API network", () => {
  it("is loopback only unless the tailnet is asked for", () => {
    expect(binds(undefined)).toEqual(["127.0.0.1", "::1"]);
    expect([...allowlist(undefined)].sort()).toEqual(["127.0.0.1", "::1"]);
    expect(binds(undefined, "0.0.0.0,::,127.0.0.1")).toEqual(["127.0.0.1"]);
  });

  it("answers only the named tailnet machine, not everyone on the tailnet", () => {
    const status: Status = { Self: { TailscaleIPs: ["100.1.1.1"] }, Peer: { a: { DNSName: "laptop.tail.ts.net.", TailscaleIPs: ["100.2.2.2"] }, b: { DNSName: "other.tail.ts.net.", TailscaleIPs: ["100.3.3.3"] } } };
    const allowed = allowlist(status, "laptop");
    expect(allowed.has("100.2.2.2")).toBe(true);
    expect(allowed.has("100.3.3.3")).toBe(false);
  });
});

describe("crazy tab API submit guard", () => {
  it("refuses whatever could submit a form while it is being filled", () => {
    expect(refuse({ action: "click", text: " Submit application " })).toMatch(/final submit/);
    expect(refuse({ action: "click", text: "Send" })).toMatch(/final submit/);
    expect(refuse({ action: "press", key: "Enter", tag: "INPUT" })).toMatch(/Enter/);
    expect(refuse({ action: "type", value: "Canada\n", tag: "INPUT" })).toMatch(/newline/);
    expect(refuse({ action: "eval", js: "document.querySelector('button').click()" })).toMatch(/only read/);
  });

  it("lets filling and the armed submit step through", () => {
    for (const text of ["Next", "Save and Continue", "Apply"]) expect(refuse({ action: "click", text })).toBeUndefined();
    expect(refuse({ action: "press", key: "Enter", tag: "TEXTAREA" })).toBeUndefined();
    expect(refuse({ action: "eval", js: "[...document.querySelectorAll('a')].map((a) => a.href)" })).toBeUndefined();
    expect(refuse({ action: "click", text: "Submit", armed: true })).toBeUndefined();
  });
});

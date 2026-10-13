import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Tests run against a temp copy of test/home (a fake profile, context.md and resume), so the
// database, browser profile and run logs never touch ~/.jh or the repo.
const home = mkdtempSync(join(tmpdir(), "jh-test-"));
cpSync(resolve(import.meta.dirname, "test/home"), home, { recursive: true });

export default defineConfig({ test: { env: { JH_HOME: home, JH_TZ: "America/Vancouver" } } });

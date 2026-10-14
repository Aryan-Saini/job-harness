#!/usr/bin/env node
// Entry point for `jh`. The CLI ships as TypeScript; tsx compiles it on load.
import { register } from "tsx/esm/api";

register();
await import("../src/cli.ts");

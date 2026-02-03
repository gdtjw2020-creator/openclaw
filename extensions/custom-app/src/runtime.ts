import type { RuntimeEnv } from "openclaw/plugin-sdk";

let customAppRuntime: RuntimeEnv | null = null;

export function setCustomAppRuntime(runtime: RuntimeEnv): void {
  customAppRuntime = runtime;
}

export function getCustomAppRuntime(): RuntimeEnv {
  if (!customAppRuntime) {
    throw new Error("Custom App runtime not initialized");
  }
  return customAppRuntime;
}

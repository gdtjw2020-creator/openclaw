import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setCustomAppRuntime(next: PluginRuntime): void {
  runtime = next;
}

export function getCustomAppRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("Custom App runtime not initialized");
  }
  return runtime;
}

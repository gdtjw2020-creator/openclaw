import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { customAppPlugin } from "./src/channel.js";
import { setCustomAppRuntime } from "./src/runtime.js";

const plugin = {
  id: "custom-app",
  name: "Custom App",
  description: "Custom mobile app channel with WebSocket communication",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setCustomAppRuntime(api.runtime);
    api.registerChannel({ plugin: customAppPlugin });
  },
};

export default plugin;

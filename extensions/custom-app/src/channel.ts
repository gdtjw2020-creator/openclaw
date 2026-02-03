import type { ChannelPlugin } from "openclaw/plugin-sdk";
import { getChatChannelMeta } from "openclaw/plugin-sdk";
import { CustomAppWebSocketServer } from "./server.js";
import { createMessageStore, type MessageStore } from "./message-store.js";
import { startHttpServer } from "./http-server.js";
import { getCustomAppRuntime } from "./runtime.js";
import type { CustomAppConfig } from "./types.js";
import path from "node:path";
import os from "node:os";

const meta = getChatChannelMeta("custom-app");

let wsServer: CustomAppWebSocketServer | null = null;
let messageStore: MessageStore | null = null;

export const customAppPlugin: ChannelPlugin = {
  id: "custom-app",
  meta: {
    ...meta,
    label: "Custom App",
    icon: "📱",
    showConfigured: true,
  },

  capabilities: {
    chatTypes: ["direct"],
    media: true,
    reactions: false,
    polls: false,
  },

  config: {
    listAccountIds: () => ["default"],
    resolveAccount: () => ({ accountId: "default", enabled: true }),
    defaultAccountId: () => "default",
    isEnabled: () => true,
    isConfigured: () => true,
  },

  outbound: {
    deliveryMode: "gateway",
    textChunkLimit: 4000,

    sendText: async ({ to, text }) => {
      if (!wsServer) {
        throw new Error("Custom App server not started");
      }

      await wsServer.sendToClient(to, {
        type: "text",
        text,
        timestamp: Date.now(),
      });

      return {
        channel: "custom-app",
        messageId: `${Date.now()}`,
      };
    },

    sendMedia: async ({ to, text, mediaUrl }) => {
      if (!wsServer) {
        throw new Error("Custom App server not started");
      }

      await wsServer.sendToClient(to, {
        type: "media",
        text: text || "",
        mediaUrl,
        timestamp: Date.now(),
      });

      return {
        channel: "custom-app",
        messageId: `${Date.now()}`,
      };
    },
  },

  gateway: {
    startAccount: async (ctx) => {
      const cfg = ctx.cfg as { channels?: { "custom-app"?: CustomAppConfig } };
      const config = cfg.channels?.["custom-app"] || {};
      const port = config.port || 18800;
      const httpPort = config.httpPort || 18801;

      // Get data directory
      const dataDir = process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");

      // Initialize message store
      messageStore = createMessageStore(dataDir);

      // Start WebSocket server
      wsServer = new CustomAppWebSocketServer(port, messageStore);

      // Set inbound message handler
      wsServer.setInboundMessageHandler(async (message) => {
        // Forward to OpenClaw's auto-reply system
        ctx.log?.info(`Inbound message from ${message.from}: ${message.body}`);

        // Here you would integrate with OpenClaw's message routing
        // For now, just log it
        getCustomAppRuntime().log?.info(
          `Received message from ${message.from}: ${message.body}`
        );
      });

      // Start HTTP registration server
      const hostname = process.env.HOSTNAME || "localhost";
      startHttpServer(httpPort, wsServer, hostname);

      ctx.log?.info("Custom App channel started");

      // Cleanup old messages every hour
      const cleanupInterval = setInterval(() => {
        messageStore?.cleanup();
      }, 60 * 60 * 1000);

      // Wait for stop signal
      await new Promise<void>((resolve) => {
        ctx.abortSignal.addEventListener("abort", () => {
          clearInterval(cleanupInterval);
          resolve();
        });
      });

      // Cleanup
      wsServer?.close();
      messageStore?.close();
      wsServer = null;
      messageStore = null;

      ctx.log?.info("Custom App channel stopped");
    },
  },

  status: {
    defaultRuntime: {
      accountId: "default",
      running: false,
      connected: false,
    },

    buildChannelSummary: async () => ({
      configured: true,
      running: wsServer !== null,
    }),
  },
};

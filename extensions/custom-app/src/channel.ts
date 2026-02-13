import type { ChannelPlugin } from "openclaw/plugin-sdk";
import { getChatChannelMeta, createTypingCallbacks, logTypingFailure } from "openclaw/plugin-sdk";
import { CustomAppWebSocketServer } from "./server.js";
import { createMessageStore, type MessageStore } from "./message-store.js";
import { startHttpServer } from "./http-server.js";
import { getCustomAppRuntime } from "./runtime.js";
import type { CustomAppConfig } from "./types.js";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import http from "node:http";
import process from "node:process";
import crypto from "node:crypto";
import { checkAgentAccess } from "./auth.js";

const meta = getChatChannelMeta("custom-app");

let wsServer: CustomAppWebSocketServer | null = null;
let messageStore: MessageStore | null = null;
let httpHostname: string = "localhost";
let httpPort: number = 18803;
let mediaDir: string = "";

// Copy a local file to the media directory and return the HTTP URL
function copyToMediaDir(localPath: string): string | null {
  if (!fs.existsSync(localPath)) {
    return null;
  }

  const ext = path.extname(localPath) || ".bin";
  const uniqueName = `${Date.now()}_${crypto.randomBytes(8).toString("hex")}${ext}`;
  const destPath = path.join(mediaDir, uniqueName);

  fs.copyFileSync(localPath, destPath);

  return `http://${httpHostname}:${httpPort}/media/${uniqueName}`;
}

export const customAppPlugin: ChannelPlugin = {
  id: "custom-app",
  meta: {
    ...meta,
    label: "Custom App",
    icon: "??",
    showConfigured: true,
  },

  capabilities: {
    chatTypes: ["direct"],
    media: true,
    reactions: false,
    polls: false,
  },

  messaging: {
    targetResolver: {
      hint: "Use device ID (UUID format) or custom-app:device-id",
      looksLikeId: (raw: string) => {
        // Accept custom-app: prefix or raw UUID
        const trimmed = raw.trim();
        if (trimmed.startsWith("custom-app:")) return true;
        // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        return uuidRegex.test(trimmed);
      },
    },
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

    resolveTarget: ({ to, allowFrom }) => {
      const trimmed = to?.trim() ?? "";
      if (!trimmed) {
        return {
          ok: false,
          error: new Error("Custom App target is required (device ID)"),
        };
      }

      // Remove "custom-app:" prefix if present
      const deviceId = trimmed.startsWith("custom-app:")
        ? trimmed.slice("custom-app:".length)
        : trimmed;

      // Validate device ID format (UUID)
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(deviceId)) {
        return {
          ok: false,
          error: new Error(`Invalid device ID format: ${deviceId}`),
        };
      }

      return { ok: true, to: deviceId };
    },

    sendText: async ({ to, text, agentId }) => {
      if (!wsServer) {
        throw new Error("Custom App server not started");
      }

      await wsServer.sendToClient(to, {
        type: "text",
        text,
        timestamp: Date.now(),
        agentId,
      });

      return {
        channel: "custom-app",
        messageId: `${Date.now()}`,
      };
    },

    sendMedia: async ({ to, text, mediaUrl, agentId }) => {
      if (!wsServer) {
        throw new Error("Custom App server not started");
      }

      // Check if mediaUrl is a local file path
      let finalMediaUrl = mediaUrl;
      if (mediaUrl && !mediaUrl.startsWith("http://") && !mediaUrl.startsWith("https://")) {
        // It's a local file path, copy to media dir and get HTTP URL
        const httpUrl = copyToMediaDir(mediaUrl);
        if (httpUrl) {
          finalMediaUrl = httpUrl;
        } else {
          // File doesn't exist, send as text message with error
          await wsServer.sendToClient(to, {
            type: "text",
            text: `${text || ""}\n[??????????? ${mediaUrl}]`,
            timestamp: Date.now(),
            agentId,
          });
          return {
            channel: "custom-app",
            messageId: `${Date.now()}`,
          };
        }
      }

      await wsServer.sendToClient(to, {
        type: "media",
        text: text || "",
        mediaUrl: finalMediaUrl,
        timestamp: Date.now(),
        agentId,
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
      const port = config.port || 18802;
      const configHttpPort = config.httpPort || 18803;

      // Get data directory
      const dataDir = process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");

      // Initialize media directory for file serving
      mediaDir = path.join(dataDir, "custom-app", "media");
      if (!fs.existsSync(mediaDir)) {
        fs.mkdirSync(mediaDir, { recursive: true });
      }

      // Initialize message store
      messageStore = createMessageStore(dataDir, ctx.log);

      // Start WebSocket server
      wsServer = new CustomAppWebSocketServer(port, messageStore, ctx.log);

      let httpServer: http.Server | undefined;

      // Set inbound message handler
      wsServer.setInboundMessageHandler(async (message) => {
        ctx.log?.info(`Inbound message from ${message.from}: ${message.body}`);
        ctx.log?.info(`Inbound message from ${message.from}: ${message.body}`);
        ctx.log?.debug(`[Channel] 解析后的入站消息对象: ${JSON.stringify(message, null, 2)}`);

        // Save inbound message
        if (messageStore) {
          try {
            messageStore.saveMessage(message.from, {
              type: message.mediaUrl ? "media" : "text",
              text: message.body,
              mediaUrl: message.mediaUrl,
              timestamp: message.timestamp || Date.now(),
            });
            ctx.log?.info(`Saved inbound message from ${message.from}`);
          } catch (err) {
            ctx.log?.error(`Failed to save inbound message: ${err}`);
          }
        }

        try {
          const runtime = getCustomAppRuntime();
          const config = await runtime.config.loadConfig();

          // Determine target agent ID
          let targetAgentId = message.agentId;

          if (!targetAgentId) {
            ctx.log?.warn(`[Security] Dropping message from ${message.from}: No agentId specified`);
            return;
          }

          // Check if client has access to this agent
          if (!checkAgentAccess(message.from, targetAgentId)) {
            ctx.log?.warn(`[Security] Dropping message from ${message.from}: Access denied for agent ${targetAgentId}`);
            return;
          }

          /* Fallback logic removed in strict mode
          if (!targetAgentId) {
            // Fallback to routing from bindings
            ...
          }
          */

          ctx.log?.info(`Routing to agent: ${targetAgentId}`);

          // Build session key with agent prefix for proper session storage
          // Format: agent:{agentId}:custom-app:{userId}
          const sessionKey = `agent:${targetAgentId}:custom-app:${message.from}`;

          // Build message context
          // If there's a media URL, append it to the body so the agent can see it
          let bodyWithMedia = message.body;
          if (message.mediaUrl) {
            let mediaLabel = "Media";
            if (message.mediaType?.startsWith("image/")) {
              mediaLabel = "Image";
            } else if (message.mediaType?.startsWith("audio/")) {
              mediaLabel = "Audio";
            } else if (message.mediaType?.startsWith("video/")) {
              mediaLabel = "Video";
            }

            const mediaNote = `\n\n[${mediaLabel}: ${message.mediaUrl}]`;
            bodyWithMedia = message.body ? `${message.body}${mediaNote}` : mediaNote.trim();
          }

          const ctxPayload = runtime.channel.reply.finalizeInboundContext({
            Body: bodyWithMedia,
            RawBody: message.body,
            CommandBody: message.body,
            From: `custom-app:${message.from}`,
            To: `custom-app:${message.from}`,
            SessionKey: sessionKey,
            AccountId: "default",
            ChatType: "direct",
            SenderId: message.from,
            Provider: "custom-app",
            Surface: "custom-app",
            MessageSid: message.id,
            Timestamp: message.timestamp,
            MediaUrl: message.mediaUrl,
            MediaPath: message.mediaPath,
            MediaType: message.mediaType,
            OriginatingChannel: "custom-app" as const,
            OriginatingTo: `custom-app:${message.from}`,
            AgentId: targetAgentId,
          });

          // Get effective messages config for response prefix
          const messagesConfig = runtime.channel.reply.resolveEffectiveMessagesConfig(config, targetAgentId);

          // Create typing indicator function
          const sendTyping = async () => {
            if (wsServer) {
              await wsServer.sendToClient(message.from, {
                type: "typing",
                isTyping: true,
                timestamp: Date.now(),
                agentId: targetAgentId,
              });
            }
          };

          const stopTyping = async () => {
            if (wsServer) {
              await wsServer.sendToClient(message.from, {
                type: "typing",
                isTyping: false,
                timestamp: Date.now(),
                agentId: targetAgentId,
              });
            }
          };

          // Dispatch to agent
          await runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
            ctx: ctxPayload,
            cfg: config,
            dispatcherOptions: {
              responsePrefix: messagesConfig.responsePrefix,
              deliver: async (payload, _info) => {
                if (!wsServer) return;

                // Collect media URLs from payload
                const mediaList = payload.mediaUrls?.length
                  ? payload.mediaUrls
                  : payload.mediaUrl
                    ? [payload.mediaUrl]
                    : [];

                // Send media items first (with caption on the first one)
                let captionSent = false;
                for (const url of mediaList) {
                  const caption: string = !captionSent ? (payload.text || "") : "";
                  captionSent = captionSent || Boolean(caption);

                  // Convert local file paths to HTTP URLs
                  let finalUrl = url;
                  if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
                    const httpUrl = copyToMediaDir(url);
                    if (httpUrl) {
                      finalUrl = httpUrl;
                    } else {
                      ctx.log?.warn(`Media file not found: ${url}`);
                      continue;
                    }
                  }

                  await wsServer.sendToClient(message.from, {
                    type: "media",
                    text: caption,
                    mediaUrl: finalUrl,
                    timestamp: Date.now(),
                    agentId: targetAgentId,
                  });
                  ctx.log?.info(`Sent media to ${message.from}: ${finalUrl}`);
                }

                // Send remaining text (if no media consumed the caption, or text-only reply)
                const textToSend = captionSent ? "" : (payload.text || "");
                if (textToSend) {
                  await wsServer.sendToClient(message.from, {
                    type: "text",
                    text: textToSend,
                    timestamp: Date.now(),
                    agentId: targetAgentId,
                  });
                  ctx.log?.info(`Sent reply to ${message.from}: ${textToSend.slice(0, 50)}...`);
                }
              },
              onError: (err, info) => {
                ctx.log?.error(`custom-app ${info.kind} reply failed: ${String(err)}`);
                // Stop typing on error
                void stopTyping().catch(() => { });
              },
              onReplyStart: createTypingCallbacks({
                start: sendTyping,
                stop: stopTyping,
                onStartError: (err) => {
                  logTypingFailure({
                    log: (msg) => ctx.log?.debug?.(msg),
                    channel: "custom-app",
                    target: message.from,
                    error: err,
                  });
                },
                onStopError: (err) => {
                  logTypingFailure({
                    log: (msg) => ctx.log?.debug?.(msg),
                    channel: "custom-app",
                    action: "stop",
                    target: message.from,
                    error: err,
                  });
                },
              }).onReplyStart,
              onIdle: createTypingCallbacks({
                start: sendTyping,
                stop: stopTyping,
                onStartError: (err) => {
                  logTypingFailure({
                    log: (msg) => ctx.log?.debug?.(msg),
                    channel: "custom-app",
                    target: message.from,
                    error: err,
                  });
                },
                onStopError: (err) => {
                  logTypingFailure({
                    log: (msg) => ctx.log?.debug?.(msg),
                    channel: "custom-app",
                    action: "stop",
                    target: message.from,
                    error: err,
                  });
                },
              }).onIdle,
            },
            replyOptions: {},
          });
        } catch (error) {
          const err = error as Error;
          ctx.log?.error(`Failed to handle inbound message: ${err.message}`);
          ctx.log?.error(`[DEBUG] HOME=${process.env.HOME}, os.homedir()=${os.homedir()}, OPENCLAW_STATE_DIR=${process.env.OPENCLAW_STATE_DIR}`);
          ctx.log?.error(`[DEBUG] Stack trace: ${err.stack}`);
          // Send error message to client
          if (wsServer) {
            await wsServer.sendToClient(message.from, {
              type: "text",
              text: `消息处理失败: ${err.message}`,
              timestamp: Date.now(),
            });
          }
        }
      });

      // Start HTTP registration server
      // Priority: config > env > auto-detect
      let hostname = config.hostname || process.env.CUSTOM_APP_HOSTNAME || process.env.HOSTNAME;

      if (!hostname || hostname === "localhost") {
        // Auto-detect network IP
        const networkInterfaces = os.networkInterfaces();
        for (const iface of Object.values(networkInterfaces)) {
          if (!iface) continue;
          for (const addr of iface) {
            // Skip internal and IPv6 addresses
            if (!addr.internal && addr.family === "IPv4") {
              hostname = addr.address;
              break;
            }
          }
          if (hostname && hostname !== "localhost") break;
        }
      }

      hostname = hostname || "localhost";

      // Update module-level variables for media URL generation
      httpHostname = hostname;
      httpPort = configHttpPort;

      ctx.log?.info(`Using hostname: ${hostname}`);
      httpServer = startHttpServer(configHttpPort, wsServer, hostname, ctx.log);

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
      httpServer?.close(() => {
        ctx.log?.info("Custom App HTTP server stopped");
      });
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

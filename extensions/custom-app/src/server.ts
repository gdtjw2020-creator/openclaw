import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "node:http";
import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";
import { getCustomAppRuntime } from "./runtime.js";
import type { MessagePayload, PendingRegistration, InboundMessage } from "./types.js";
import type { MessageStore } from "./message-store.js";

export class CustomAppWebSocketServer {
  private wss: WebSocketServer;
  private clients = new Map<string, WebSocket>();
  private pendingRegistrations = new Map<string, PendingRegistration>();
  private messageStore: MessageStore;
  private onInboundMessage?: (message: InboundMessage) => Promise<void>;

  constructor(port: number, messageStore: MessageStore) {
    this.messageStore = messageStore;
    this.wss = new WebSocketServer({ port });

    this.wss.on("connection", (ws, req) => {
      this.handleConnection(ws, req);
    });

    getCustomAppRuntime().log?.info(`Custom App WebSocket server started on port ${port}`);
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url!, `ws://${req.headers.host}`);
    const tempToken = url.searchParams.get("tempToken");
    const deviceId = url.searchParams.get("deviceId");
    const authToken = url.searchParams.get("token");

    if (tempToken && deviceId) {
      // First-time registration
      this.handleRegistration(ws, tempToken, deviceId, url);
    } else if (deviceId && authToken) {
      // Existing device connection
      this.handleExistingDevice(ws, deviceId, authToken);
    } else {
      ws.close(4003, "Missing credentials");
    }
  }

  private handleRegistration(
    ws: WebSocket,
    tempToken: string,
    deviceId: string,
    url: URL
  ): void {
    const registration = this.pendingRegistrations.get(tempToken);

    if (!registration) {
      ws.close(4001, "Invalid or expired token");
      return;
    }

    if (Date.now() > registration.expires) {
      ws.close(4002, "Token expired");
      this.pendingRegistrations.delete(tempToken);
      return;
    }

    // Generate permanent token
    const permanentToken = crypto.randomBytes(32).toString("hex");
    const deviceName = url.searchParams.get("deviceName") || "Unknown Device";

    // Save device info
    this.messageStore.registerDevice(deviceId, deviceName, permanentToken);

    // Update registration status
    registration.deviceId = deviceId;

    // Send permanent token to app
    ws.send(
      JSON.stringify({
        type: "registered",
        token: permanentToken,
      })
    );

    getCustomAppRuntime().log?.info(
      `Device registered: ${deviceId} (${deviceName})`
    );

    // Clean up temp token after 1 minute
    setTimeout(() => {
      this.pendingRegistrations.delete(tempToken);
    }, 60000);

    // Register client
    this.registerClient(deviceId, ws);
  }

  private handleExistingDevice(ws: WebSocket, deviceId: string, authToken: string): void {
    if (!this.messageStore.verifyToken(deviceId, authToken)) {
      ws.close(4004, "Invalid token");
      return;
    }

    this.messageStore.updateLastConnected(deviceId);
    this.registerClient(deviceId, ws);

    getCustomAppRuntime().log?.info(`Device reconnected: ${deviceId}`);
  }

  private registerClient(deviceId: string, ws: WebSocket): void {
    this.clients.set(deviceId, ws);

    // Send undelivered messages
    this.syncUndeliveredMessages(deviceId, ws);

    // Handle incoming messages
    ws.on("message", (data) => {
      this.handleIncomingMessage(deviceId, data.toString());
    });

    // Handle disconnection
    ws.on("close", () => {
      this.clients.delete(deviceId);
      getCustomAppRuntime().log?.info(`Device disconnected: ${deviceId}`);
    });

    ws.on("error", (error) => {
      getCustomAppRuntime().log?.error(`WebSocket error for ${deviceId}: ${error.message}`);
    });
  }

  private syncUndeliveredMessages(deviceId: string, ws: WebSocket): void {
    const undelivered = this.messageStore.getUndeliveredMessages(deviceId);

    if (undelivered.length > 0) {
      const messages = undelivered.map((row) => JSON.parse(row.payload));
      ws.send(
        JSON.stringify({
          type: "sync",
          messages,
        })
      );

      getCustomAppRuntime().log?.info(
        `Synced ${undelivered.length} undelivered messages to ${deviceId}`
      );
    }
  }

  private async handleIncomingMessage(deviceId: string, data: string): Promise<void> {
    try {
      const message = JSON.parse(data);

      if (message.type === "ack") {
        // Client acknowledged receipt
        if (message.messageIds && Array.isArray(message.messageIds)) {
          const ids = message.messageIds.map((id: string) => parseInt(id, 10));
          this.messageStore.markDelivered(ids);
        }
      } else if (message.type === "sync_request") {
        // Client requesting sync
        const ws = this.clients.get(deviceId);
        if (ws) {
          this.syncUndeliveredMessages(deviceId, ws);
        }
      } else if (message.type === "typing") {
        // Typing status - ignore, don't send to agent
        getCustomAppRuntime().log?.debug(`Typing status from ${deviceId}: ${message.isTyping}`);
      } else {
        // Regular message from app - validate content
        const hasContent = message.text?.trim() || message.mediaUrl;
        if (!hasContent) {
          getCustomAppRuntime().log?.debug(`Ignoring empty message from ${deviceId}`);
          return;
        }

        if (this.onInboundMessage) {
          const inboundMessage: InboundMessage = {
            from: deviceId,
            to: "agent",
            body: message.text || "",
            accountId: "default",
            chatType: "direct",
            timestamp: message.timestamp || Date.now(),
            mediaPath: message.mediaPath,
            mediaType: message.mediaType,
            mediaUrl: message.mediaUrl,
            replyToId: message.replyToId,
          };

          await this.onInboundMessage(inboundMessage);
        }
      }
    } catch (error) {
      getCustomAppRuntime().log?.error(
        `Failed to handle message from ${deviceId}: ${error}`
      );
    }
  }

  async sendToClient(clientId: string, payload: MessagePayload): Promise<void> {
    // Save to database first
    const messageId = this.messageStore.saveMessage(clientId, payload);
    payload.messageId = messageId.toString();

    const ws = this.clients.get(clientId);

    if (ws && ws.readyState === WebSocket.OPEN) {
      // Client is online, send immediately
      ws.send(JSON.stringify(payload));
    } else {
      // Client is offline, message is already saved
      getCustomAppRuntime().log?.info(
        `Client ${clientId} offline, message queued (id: ${messageId})`
      );
    }
  }

  createTempToken(): { tempToken: string; expires: number } {
    const tempToken = crypto.randomBytes(16).toString("hex");
    const expires = Date.now() + 5 * 60 * 1000; // 5 minutes

    this.pendingRegistrations.set(tempToken, {
      tempToken,
      expires,
      deviceId: null,
    });

    return { tempToken, expires };
  }

  isDeviceConnected(tempToken: string): boolean {
    const registration = this.pendingRegistrations.get(tempToken);
    return registration?.deviceId !== null;
  }

  setInboundMessageHandler(handler: (message: InboundMessage) => Promise<void>): void {
    this.onInboundMessage = handler;
  }

  close(): void {
    this.wss.close();
    getCustomAppRuntime().log?.info("Custom App WebSocket server closed");
  }
}

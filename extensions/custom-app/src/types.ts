export type CustomAppConfig = {
  port?: number;
  httpPort?: number;
  hostname?: string;
  enabled?: boolean;
};

export type DeviceInfo = {
  deviceId: string;
  deviceName: string;
  token: string;
  registeredAt: number;
  lastConnectedAt?: number;
};

export type PendingRegistration = {
  tempToken: string;
  expires: number;
  deviceId: string | null;
};

export type MessagePayload = {
  type: "text" | "media" | "sync" | "registered" | "ack" | "typing";
  messageId?: string;
  text?: string;
  mediaUrl?: string;
  timestamp?: number;
  messages?: MessagePayload[];
  token?: string;
  messageIds?: string[];
  isTyping?: boolean;
};

export type InboundMessage = {
  from: string;
  to: string;
  body: string;
  accountId: string;
  chatType: "direct";
  timestamp: number;
  mediaPath?: string;
  mediaType?: string;
  mediaUrl?: string;
  replyToId?: string;
  agentId?: string;  // Client-specified target agent
};

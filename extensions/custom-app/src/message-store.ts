import Database from "better-sqlite3";
import path from "node:path";
import type { MessagePayload } from "./types.js";
import type { ChannelLogSink } from "openclaw/plugin-sdk";

export class MessageStore {
  private db: Database.Database;
  private log?: ChannelLogSink;

  constructor(dbPath: string, log?: ChannelLogSink) {
    this.db = new Database(dbPath);
    this.log = log;
    this.initDatabase();
  }

  private initDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        delivered INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_client_delivered 
      ON messages (client_id, delivered)
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        device_name TEXT NOT NULL,
        token TEXT NOT NULL,
        registered_at INTEGER NOT NULL,
        last_connected_at INTEGER
      )
    `);
  }

  saveMessage(clientId: string, payload: MessagePayload): number {
    const stmt = this.db.prepare(`
      INSERT INTO messages (client_id, payload, created_at)
      VALUES (?, ?, ?)
    `);

    const result = stmt.run(clientId, JSON.stringify(payload), Date.now());
    return result.lastInsertRowid as number;
  }

  getUndeliveredMessages(clientId: string): Array<{ id: number; payload: string }> {
    const stmt = this.db.prepare(`
      SELECT id, payload FROM messages 
      WHERE client_id = ? AND delivered = 0
      ORDER BY created_at ASC
      LIMIT 100
    `);

    return stmt.all(clientId) as Array<{ id: number; payload: string }>;
  }

  markDelivered(messageIds: number[]): void {
    if (messageIds.length === 0) return;

    const placeholders = messageIds.map(() => "?").join(",");
    const stmt = this.db.prepare(`
      UPDATE messages SET delivered = 1 
      WHERE id IN (${placeholders})
    `);

    stmt.run(...messageIds);
  }

  cleanup(): void {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const stmt = this.db.prepare(`
      DELETE FROM messages 
      WHERE delivered = 1 AND created_at < ?
    `);

    const result = stmt.run(sevenDaysAgo);
    if (result.changes > 0) {
      getCustomAppLogger()?.info(
        `Cleaned up ${result.changes} old delivered messages`
      );
    }
  }

  registerDevice(deviceId: string, deviceName: string, token: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO devices (device_id, device_name, token, registered_at, last_connected_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(deviceId, deviceName, token, Date.now(), Date.now());
  }

  verifyToken(deviceId: string, token: string): boolean {
    const stmt = this.db.prepare(`
      SELECT token FROM devices WHERE device_id = ?
    `);

    const row = stmt.get(deviceId) as { token: string } | undefined;
    return row?.token === token;
  }

  updateLastConnected(deviceId: string): void {
    const stmt = this.db.prepare(`
      UPDATE devices SET last_connected_at = ? WHERE device_id = ?
    `);

    stmt.run(Date.now(), deviceId);
  }

  close(): void {
    this.db.close();
  }
}

export function createMessageStore(dataDir: string, log?: ChannelLogSink): MessageStore {
  const dbPath = path.join(dataDir, "custom-app.db");
  return new MessageStore(dbPath, log);
}

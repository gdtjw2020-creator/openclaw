/**
 * Authentication data store for Custom App
 * Manages registration codes and client permissions
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface RegistrationCode {
    agents: string[];
    maxUses: number;
    usedCount: number;
    label?: string;
    createdAt: string;
}

export interface ClientInfo {
    token: string;
    agents: string[];
    registrationCode: string;
    registeredAt: string;
    lastSeenAt?: string;
}

export interface AuthData {
    registrationCodes: Record<string, RegistrationCode>;
    clients: Record<string, ClientInfo>;
}

const DEFAULT_AUTH_DATA: AuthData = {
    registrationCodes: {},
    clients: {},
};

function getAuthFilePath(): string {
    const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");
    return path.join(stateDir, "custom-app-auth.json");
}

export function loadAuthData(): AuthData {
    const filePath = getAuthFilePath();
    try {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, "utf-8");
            return JSON.parse(content) as AuthData;
        }
    } catch (err) {
        console.error(`[auth-store] Failed to load auth data: ${err}`);
    }
    return { ...DEFAULT_AUTH_DATA };
}

export function saveAuthData(data: AuthData): void {
    const filePath = getAuthFilePath();
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
        console.error(`[auth-store] Failed to save auth data: ${err}`);
    }
}

export function getRegistrationCode(code: string): RegistrationCode | null {
    const data = loadAuthData();
    return data.registrationCodes[code] || null;
}

export function useRegistrationCode(code: string): { success: boolean; agents: string[] } {
    const data = loadAuthData();
    const regCode = data.registrationCodes[code];

    if (!regCode) {
        return { success: false, agents: [] };
    }

    if (regCode.maxUses > 0 && regCode.usedCount >= regCode.maxUses) {
        return { success: false, agents: [] };
    }

    regCode.usedCount++;
    saveAuthData(data);

    return { success: true, agents: regCode.agents };
}

export function registerClient(
    clientId: string,
    token: string,
    agents: string[],
    registrationCode: string
): void {
    const data = loadAuthData();
    data.clients[clientId] = {
        token,
        agents,
        registrationCode,
        registeredAt: new Date().toISOString(),
    };
    saveAuthData(data);
}

export function getClient(clientId: string): ClientInfo | null {
    const data = loadAuthData();
    return data.clients[clientId] || null;
}

export function getClientByToken(token: string): { clientId: string; info: ClientInfo } | null {
    const data = loadAuthData();
    for (const [clientId, info] of Object.entries(data.clients)) {
        if (info.token === token) {
            return { clientId, info };
        }
    }
    return null;
}

export function updateClientLastSeen(clientId: string): void {
    const data = loadAuthData();
    if (data.clients[clientId]) {
        data.clients[clientId].lastSeenAt = new Date().toISOString();
        saveAuthData(data);
    }
}

export function hasAgentAccess(clientId: string, agentId: string): boolean {
    const client = getClient(clientId);
    if (!client) return false;
    return client.agents.includes(agentId);
}

export function createRegistrationCode(
    code: string,
    agents: string[],
    maxUses: number = 1,
    label?: string
): void {
    const data = loadAuthData();
    data.registrationCodes[code] = {
        agents,
        maxUses,
        usedCount: 0,
        label,
        createdAt: new Date().toISOString(),
    };
    saveAuthData(data);
}

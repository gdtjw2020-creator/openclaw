/**
 * Authentication utilities for Custom App
 * Token generation, verification, and permission checks
 */

import crypto from "node:crypto";
import {
    getClient,
    getClientByToken,
    hasAgentAccess,
    registerClient,
    useRegistrationCode,
    updateClientLastSeen,
} from "./auth-store.js";

const TOKEN_PREFIX = "cap_"; // Custom App Token prefix

export interface AuthResult {
    success: boolean;
    error?: string;
    token?: string;
    clientId?: string;
    agents?: Array<{ id: string; name: string; emoji: string }>;
}

export interface TokenVerifyResult {
    valid: boolean;
    clientId?: string;
    agents?: string[];
    error?: string;
}

/**
 * Generate a secure token for a client
 */
export function generateToken(): string {
    const randomBytes = crypto.randomBytes(32).toString("hex");
    return `${TOKEN_PREFIX}${randomBytes}`;
}

/**
 * Register a new client with a registration code
 */
export function authenticateWithCode(
    registrationCode: string,
    clientId: string,
    agentConfig: Array<{ id: string; name: string; emoji?: string }>
): AuthResult {
    // Validate registration code
    const result = useRegistrationCode(registrationCode);

    if (!result.success) {
        return {
            success: false,
            error: "Invalid or expired registration code",
        };
    }

    // Generate token
    const token = generateToken();

    // Register the client
    registerClient(clientId, token, result.agents, registrationCode);

    // Build agent list with names
    const agents = result.agents
        .map((agentId) => {
            const config = agentConfig.find((a) => a.id === agentId);
            return config
                ? { id: agentId, name: config.name, emoji: config.emoji || "🤖" }
                : null;
        })
        .filter((a): a is { id: string; name: string; emoji: string } => a !== null);

    return {
        success: true,
        token,
        clientId,
        agents,
    };
}

/**
 * Verify a token and return client info
 */
export function verifyToken(token: string): TokenVerifyResult {
    if (!token || !token.startsWith(TOKEN_PREFIX)) {
        return { valid: false, error: "Invalid token format" };
    }

    const clientData = getClientByToken(token);
    if (!clientData) {
        return { valid: false, error: "Token not found" };
    }

    // Update last seen
    updateClientLastSeen(clientData.clientId);

    return {
        valid: true,
        clientId: clientData.clientId,
        agents: clientData.info.agents,
    };
}

/**
 * Check if a client has access to a specific agent
 */
export function checkAgentAccess(clientId: string, agentId: string): boolean {
    return hasAgentAccess(clientId, agentId);
}

/**
 * Get list of agents for a client
 */
export function getClientAgents(
    clientId: string,
    agentConfig: Array<{ id: string; name: string; emoji?: string }>
): Array<{ id: string; name: string; emoji: string }> {
    const client = getClient(clientId);
    if (!client) return [];

    return client.agents
        .map((agentId) => {
            const config = agentConfig.find((a) => a.id === agentId);
            return config
                ? { id: agentId, name: config.name, emoji: config.emoji || "🤖" }
                : null;
        })
        .filter((a): a is { id: string; name: string; emoji: string } => a !== null);
}

/**
 * Extract token from Authorization header
 */
export function extractTokenFromHeader(authHeader: string | undefined): string | null {
    if (!authHeader) return null;

    // Support "Bearer <token>" format
    if (authHeader.startsWith("Bearer ")) {
        return authHeader.slice(7);
    }

    // Also support raw token
    if (authHeader.startsWith(TOKEN_PREFIX)) {
        return authHeader;
    }

    return null;
}

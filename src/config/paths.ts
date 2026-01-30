import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MoltbotConfig } from "./types.js";

/**
 * Nix mode detection: When CLAWDBOT_NIX_MODE=1, the gateway is running under Nix.
 * In this mode:
 * - No auto-install flows should be attempted
 * - Missing dependencies should produce actionable Nix-specific error messages
 * - Config is managed externally (read-only from Nix perspective)
 */
export function resolveIsNixMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CLAWDBOT_NIX_MODE === "1";
}

export const isNixMode = resolveIsNixMode();

const LEGACY_STATE_DIRNAME = ".clawdbot";
const MID_STATE_DIRNAME = ".moltbot";
const NEW_STATE_DIRNAME = ".openclaw";
const CONFIG_FILENAME = "openclaw.json";
const MID_CONFIG_FILENAME = "moltbot.json";
const LEGACY_CONFIG_FILENAME = "clawdbot.json";

function legacyStateDir(homedir: () => string = os.homedir): string {
  return path.join(homedir(), LEGACY_STATE_DIRNAME);
}

function midStateDir(homedir: () => string = os.homedir): string {
  return path.join(homedir(), MID_STATE_DIRNAME);
}

function newStateDir(homedir: () => string = os.homedir): string {
  return path.join(homedir(), NEW_STATE_DIRNAME);
}

export function resolveLegacyStateDir(homedir: () => string = os.homedir): string {
  return legacyStateDir(homedir);
}

export function resolveNewStateDir(homedir: () => string = os.homedir): string {
  return newStateDir(homedir);
}

/**
 * State directory for mutable data (sessions, logs, caches).
 * Can be overridden via OPENCLAW_STATE_DIR (preferred), MOLTBOT_STATE_DIR, or CLAWDBOT_STATE_DIR.
 * Default: ~/.openclaw (falls back to ~/.moltbot or ~/.clawdbot if they exist and new one doesn't)
 */
export function resolveStateDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  const override =
    env.OPENCLAW_STATE_DIR?.trim() ||
    env.MOLTBOT_STATE_DIR?.trim() ||
    env.CLAWDBOT_STATE_DIR?.trim();
  if (override) return resolveUserPath(override);

  const newDir = newStateDir(homedir);
  const midDir = midStateDir(homedir);
  const legacyDir = legacyStateDir(homedir);

  if (fs.existsSync(newDir)) return newDir;
  if (fs.existsSync(midDir)) return midDir;
  if (fs.existsSync(legacyDir)) return legacyDir;

  return newDir;
}

function resolveUserPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("~")) {
    const expanded = trimmed.replace(/^~(?=$|[\\/])/, os.homedir());
    return path.resolve(expanded);
  }
  return path.resolve(trimmed);
}

export const STATE_DIR = resolveStateDir();

/**
 * Config file path (JSON5).
 * Can be overridden via MOLTBOT_CONFIG_PATH (preferred) or CLAWDBOT_CONFIG_PATH (legacy).
 * Default: ~/.clawdbot/moltbot.json (or $*_STATE_DIR/moltbot.json)
 */
export function resolveCanonicalConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  stateDir: string = resolveStateDir(env, os.homedir),
): string {
  const override =
    env.OPENCLAW_CONFIG_PATH?.trim() ||
    env.MOLTBOT_CONFIG_PATH?.trim() ||
    env.CLAWDBOT_CONFIG_PATH?.trim();
  if (override) return resolveUserPath(override);
  return path.join(stateDir, CONFIG_FILENAME);
}

/**
 * Resolve the active config path by preferring existing config candidates
 * (new/legacy filenames) before falling back to the canonical path.
 */
export function resolveConfigPathCandidate(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  const candidates = resolveDefaultConfigCandidates(env, homedir);
  const existing = candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
  if (existing) return existing;
  return resolveCanonicalConfigPath(env, resolveStateDir(env, homedir));
}

/**
 * Active config path (prefers existing legacy/new config files).
 */
export function resolveConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  stateDir: string = resolveStateDir(env, os.homedir),
  homedir: () => string = os.homedir,
): string {
  const override =
    env.OPENCLAW_CONFIG_PATH?.trim() ||
    env.MOLTBOT_CONFIG_PATH?.trim() ||
    env.CLAWDBOT_CONFIG_PATH?.trim();
  if (override) return resolveUserPath(override);
  const stateOverride =
    env.OPENCLAW_STATE_DIR?.trim() ||
    env.MOLTBOT_STATE_DIR?.trim() ||
    env.CLAWDBOT_STATE_DIR?.trim();
  const candidates = [
    path.join(stateDir, CONFIG_FILENAME),
    path.join(stateDir, MID_CONFIG_FILENAME),
    path.join(stateDir, LEGACY_CONFIG_FILENAME),
  ];
  const existing = candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
  if (existing) return existing;
  if (stateOverride) return path.join(stateDir, CONFIG_FILENAME);
  const defaultStateDir = resolveStateDir(env, homedir);
  if (path.resolve(stateDir) === path.resolve(defaultStateDir)) {
    return resolveConfigPathCandidate(env, homedir);
  }
  return path.join(stateDir, CONFIG_FILENAME);
}

export const CONFIG_PATH = resolveConfigPathCandidate();

/**
 * Resolve default config path candidates across new + legacy locations.
 * Order: explicit config path → state-dir-derived paths → new default → legacy default.
 */
export function resolveDefaultConfigCandidates(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string[] {
  const explicit =
    env.OPENCLAW_CONFIG_PATH?.trim() ||
    env.MOLTBOT_CONFIG_PATH?.trim() ||
    env.CLAWDBOT_CONFIG_PATH?.trim();
  if (explicit) return [resolveUserPath(explicit)];

  const candidates: string[] = [];
  const openclawStateDir = env.OPENCLAW_STATE_DIR?.trim();
  if (openclawStateDir) {
    candidates.push(path.join(resolveUserPath(openclawStateDir), CONFIG_FILENAME));
    candidates.push(path.join(resolveUserPath(openclawStateDir), MID_CONFIG_FILENAME));
    candidates.push(path.join(resolveUserPath(openclawStateDir), LEGACY_CONFIG_FILENAME));
  }
  const moltbotStateDir = env.MOLTBOT_STATE_DIR?.trim();
  if (moltbotStateDir) {
    candidates.push(path.join(resolveUserPath(moltbotStateDir), CONFIG_FILENAME));
    candidates.push(path.join(resolveUserPath(moltbotStateDir), MID_CONFIG_FILENAME));
    candidates.push(path.join(resolveUserPath(moltbotStateDir), LEGACY_CONFIG_FILENAME));
  }
  const legacyStateDirOverride = env.CLAWDBOT_STATE_DIR?.trim();
  if (legacyStateDirOverride) {
    candidates.push(path.join(resolveUserPath(legacyStateDirOverride), CONFIG_FILENAME));
    candidates.push(path.join(resolveUserPath(legacyStateDirOverride), MID_CONFIG_FILENAME));
    candidates.push(path.join(resolveUserPath(legacyStateDirOverride), LEGACY_CONFIG_FILENAME));
  }

  candidates.push(path.join(newStateDir(homedir), CONFIG_FILENAME));
  candidates.push(path.join(newStateDir(homedir), MID_CONFIG_FILENAME));
  candidates.push(path.join(newStateDir(homedir), LEGACY_CONFIG_FILENAME));
  candidates.push(path.join(midStateDir(homedir), CONFIG_FILENAME));
  candidates.push(path.join(midStateDir(homedir), MID_CONFIG_FILENAME));
  candidates.push(path.join(midStateDir(homedir), LEGACY_CONFIG_FILENAME));
  candidates.push(path.join(legacyStateDir(homedir), CONFIG_FILENAME));
  candidates.push(path.join(legacyStateDir(homedir), MID_CONFIG_FILENAME));
  candidates.push(path.join(legacyStateDir(homedir), LEGACY_CONFIG_FILENAME));
  return candidates;
}

export const DEFAULT_GATEWAY_PORT = 18789;

/**
 * Gateway lock directory (ephemeral).
 * Default: os.tmpdir()/moltbot-<uid> (uid suffix when available).
 */
export function resolveGatewayLockDir(tmpdir: () => string = os.tmpdir): string {
  const base = tmpdir();
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  const suffix = uid != null ? `openclaw-${uid}` : "openclaw";
  return path.join(base, suffix);
}

const OAUTH_FILENAME = "oauth.json";

/**
 * OAuth credentials storage directory.
 *
 * Precedence:
 * - `CLAWDBOT_OAUTH_DIR` (explicit override)
 * - `$*_STATE_DIR/credentials` (canonical server/default)
 * - `~/.clawdbot/credentials` (legacy default)
 */
export function resolveOAuthDir(
  env: NodeJS.ProcessEnv = process.env,
  stateDir: string = resolveStateDir(env, os.homedir),
): string {
  const override = env.CLAWDBOT_OAUTH_DIR?.trim();
  if (override) return resolveUserPath(override);
  return path.join(stateDir, "credentials");
}

export function resolveOAuthPath(
  env: NodeJS.ProcessEnv = process.env,
  stateDir: string = resolveStateDir(env, os.homedir),
): string {
  return path.join(resolveOAuthDir(env, stateDir), OAUTH_FILENAME);
}

export function resolveGatewayPort(
  cfg?: MoltbotConfig,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const envRaw = env.CLAWDBOT_GATEWAY_PORT?.trim();
  if (envRaw) {
    const parsed = Number.parseInt(envRaw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const configPort = cfg?.gateway?.port;
  if (typeof configPort === "number" && Number.isFinite(configPort)) {
    if (configPort > 0) return configPort;
  }
  return DEFAULT_GATEWAY_PORT;
}

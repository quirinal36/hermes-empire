import type { Express } from "express";
import type { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";

const DEFAULT_HERMES_URL = "http://127.0.0.1:8642";
const DEFAULT_HERMES_PORT = 8642;
const HERMES_HOME = process.env.HERMES_HOME || path.join(process.env.HOME || "~", ".hermes");
const GATEWAY_STATE_PATH = path.join(HERMES_HOME, "gateway_state.json");
const HERMES_CONFIG_PATH = path.join(HERMES_HOME, "config.yaml");

interface HermesGatewayState {
  pid?: number;
  kind?: string;
  gateway_state?: string;
  active_agents?: number;
  platforms?: Record<string, { state: string; error_code?: string | null; error_message?: string | null; updated_at?: string }>;
  updated_at?: string;
}

interface HermesDetectedConfig {
  api_key: string | null;
  api_url: string;
  enabled: boolean;
}

function readHermesConfig(): HermesDetectedConfig {
  const result: HermesDetectedConfig = { api_key: null, api_url: DEFAULT_HERMES_URL, enabled: false };
  try {
    const raw = fs.readFileSync(HERMES_CONFIG_PATH, "utf8");

    const keyMatch = raw.match(/^API_SERVER_KEY:\s*(.+)$/m);
    if (keyMatch?.[1]) result.api_key = keyMatch[1].trim();

    const enabledMatch = raw.match(/^API_SERVER_ENABLED:\s*(.+)$/m);
    if (enabledMatch?.[1]) result.enabled = enabledMatch[1].trim().toLowerCase() === "true";

    const portMatch = raw.match(/^API_SERVER_PORT:\s*(\d+)$/m);
    const port = portMatch?.[1] ? Number(portMatch[1]) : DEFAULT_HERMES_PORT;
    const hostMatch = raw.match(/^API_SERVER_HOST:\s*(.+)$/m);
    const host = hostMatch?.[1]?.trim() || "127.0.0.1";
    result.api_url = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`;
  } catch {
    // config not readable — return defaults
  }
  return result;
}

function readGatewayState(): HermesGatewayState | null {
  try {
    const raw = fs.readFileSync(GATEWAY_STATE_PATH, "utf8");
    return JSON.parse(raw) as HermesGatewayState;
  } catch {
    return null;
  }
}

function readSettingFromDb(db: DatabaseSync, key: string): string | null {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = ? LIMIT 1").get(key) as { value?: string } | undefined;
    if (!row?.value) return null;
    try {
      const parsed = JSON.parse(row.value);
      return typeof parsed === "string" ? parsed : null;
    } catch {
      return row.value;
    }
  } catch {
    return null;
  }
}

function fetchHermesHealth(url: string, apiKey: string, timeoutMs = 4000): Promise<{ ok: boolean; status?: string; platform?: string; error?: string }> {
  return new Promise((resolve) => {
    const target = new URL("/health", url);
    const lib = target.protocol === "https:" ? https : http;
    const req = lib.request(
      { hostname: target.hostname, port: target.port || (target.protocol === "https:" ? 443 : 80), path: target.pathname, method: "GET", headers: { Authorization: `Bearer ${apiKey}` }, timeout: timeoutMs },
      (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          try {
            const data = JSON.parse(body) as Record<string, unknown>;
            resolve({ ok: res.statusCode === 200, status: String(data.status ?? ""), platform: String(data.platform ?? "") });
          } catch {
            resolve({ ok: res.statusCode === 200 });
          }
        });
      },
    );
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "timeout" }); });
    req.on("error", (err) => { resolve({ ok: false, error: err.message }); });
    req.end();
  });
}

export function registerHermesRoutes({ app, db }: { app: Express; db: DatabaseSync }): void {
  app.get("/api/hermes/detect-config", (_req, res) => {
    const detected = readHermesConfig();
    res.json({
      api_key_found: detected.api_key !== null,
      api_url: detected.api_url,
      enabled: detected.enabled,
      // return masked key for display only — client should use /apply-detected-config to write
      api_key_preview: detected.api_key ? `${detected.api_key.slice(0, 8)}…` : null,
    });
  });

  app.post("/api/hermes/apply-detected-config", (req, res) => {
    const detected = readHermesConfig();
    if (!detected.api_key) {
      return res.status(404).json({ ok: false, error: "API_SERVER_KEY not found in ~/.hermes/config.yaml" });
    }

    const upsert = db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );

    const overwriteUrl = (req.body as Record<string, unknown>)?.overwrite_url === true;

    upsert.run("hermesApiKey", JSON.stringify(detected.api_key));
    if (overwriteUrl) {
      upsert.run("hermesApiUrl", JSON.stringify(detected.api_url));
    }

    res.json({ ok: true, api_url: detected.api_url });
  });

  app.get("/api/hermes/status", async (_req, res) => {
    const apiUrl = readSettingFromDb(db, "hermesApiUrl") || DEFAULT_HERMES_URL;
    const apiKey = readSettingFromDb(db, "hermesApiKey") || "";

    const [health, gatewayState] = await Promise.all([
      fetchHermesHealth(apiUrl, apiKey),
      Promise.resolve(readGatewayState()),
    ]);

    res.json({
      connected: health.ok,
      api: {
        url: apiUrl,
        status: health.ok ? "connected" : "disconnected",
        error: health.error ?? null,
        platform: health.platform ?? null,
      },
      gateway: gatewayState
        ? {
            state: gatewayState.gateway_state ?? null,
            active_agents: gatewayState.active_agents ?? 0,
            platforms: gatewayState.platforms ?? {},
            updated_at: gatewayState.updated_at ?? null,
          }
        : null,
    });
  });
}

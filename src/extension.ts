/**
 * MuninnDB status + MCP registration for Pi and OMP — the only runtime
 * behavior of this plugin. It never installs, starts, or mutates anything
 * on the system.
 *
 * Host behavior at session start:
 *   Pi >=0.99  — MCP registered via pi.registerMcpServer (Pi's native MCP;
 *                no adapter needed); health probe only.
 *   Pi <0.99   — no native MCP: if pi-mcp-adapter is not declared in
 *                ~/.pi/agent/settings.json, notify with the install
 *                command. Health probe as well.
 *   OMP        — MCP comes from the package's .mcp.json (native discovery);
 *                this module only runs the health probe.
 *
 * The type import uses the upstream Pi scope; OMP's legacy-Pi loader rewrites
 * it onto its own bundled copy, so one module runs unchanged on both hosts.
 *
 * Env overrides (for testing/odd setups):
 *   MUNINN_REST_PORT   — REST port for the health probe (default 8475)
 *   MUNINN_HEALTH_PATH — health endpoint path (default /api/health)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { accessSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_REST_PORT = 8475;
const DEFAULT_HEALTH_PATH = "/api/health";
const HEALTH_TIMEOUT_MS = 2000;

// Keep in sync with the package-root .mcp.json; Pi needs the same entry
// programmatically because Pi core does not read package-root .mcp.json.
const MCP_SERVER_CONFIG = {
  type: "http",
  url: "http://127.0.0.1:8750/mcp",
  headers: {
    Authorization:
      "!tok=$(grep -hoP 'MUNINN_MCP_TOKEN=\\K\\S+' ~/.config/systemd/user/muninndb.service.d/override.conf ~/.muninn/muninn.env 2>/dev/null | head -1); [ -n \"$tok\" ] || tok=$(head -1 ~/.muninn/mcp.token); printf 'Bearer %s' \"$tok\"",
  },
};

/** True when MuninnDB answers on its REST health endpoint. */
export async function muninnHealthOk(
  port = Number(process.env.MUNINN_REST_PORT ?? DEFAULT_REST_PORT),
  path = process.env.MUNINN_HEALTH_PATH ?? DEFAULT_HEALTH_PATH,
): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** True when a `muninn` binary exists in a well-known location or on PATH. */
export function muninnBinaryFound(): boolean {
  const home = homedir();
  const candidates = [
    join(home, ".local", "bin", "muninn"),
    "/usr/local/bin/muninn",
    "/usr/bin/muninn",
  ];
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir) candidates.push(join(dir, "muninn"));
  }
  for (const candidate of candidates) {
    try {
      accessSync(candidate);
      return true;
    } catch {
      // keep probing
    }
  }
  return false;
}

/**
 * Notification text when MuninnDB is unreachable, or null when it is up.
 * Pure function of the two probes — unit-testable without a session.
 */
export async function muninnStatusWarning(): Promise<string | null> {
  if (await muninnHealthOk()) return null;
  return muninnBinaryFound()
    ? "⚠️ MuninnDB is installed but not running — muninn_* MCP tools are unavailable. Start it yourself (e.g. `muninn start` or `systemctl --user start muninndb`); this plugin never starts it."
    : "⚠️ MuninnDB is not installed — muninn_* MCP tools are unavailable. This plugin only registers the MCP server config; install MuninnDB yourself: https://github.com/scrypster/muninndb";
}

/**
 * Classify the host that loaded the extension from its API surface.
 * OMP exposes OMP-only members (pi, runEphemeralTurn, …) and lacks
 * registerMcpServer; Pi >=0.99 exposes registerMcpServer; older Pi has
 * neither.
 */
export function hostKind(api: Record<string, unknown>): "omp" | "pi-native" | "pi-legacy" {
  const ompMarkers = ["pi", "runEphemeralTurn", "registerComposerShape", "getServiceTiers", "setServiceTier"];
  if (ompMarkers.some((member) => api[member] !== undefined)) return "omp";
  if (typeof api.registerMcpServer === "function") return "pi-native";
  return "pi-legacy";
}

/**
 * True when pi-mcp-adapter is absent from a Pi settings.json `packages`
 * declaration list (the same existence check upstream pi-muninndb uses).
 */
export function piMcpAdapterMissing(
  settingsPath = join(homedir(), ".pi", "agent", "settings.json"),
): boolean {
  try {
    const data = JSON.parse(readFileSync(settingsPath, "utf8"));
    const packages = Array.isArray(data.packages) ? data.packages : [];
    return !packages.some(
      (entry: unknown) => typeof entry === "string" && entry.includes("pi-mcp-adapter"),
    );
  } catch {
    return true;
  }
}

export default function (pi: ExtensionAPI) {
  const api = pi as unknown as Record<string, unknown>;
  const host = hostKind(api);

  if (host === "pi-native") {
    // Pi with built-in MCP: register the server for this session. No config
    // mutation, no adapter.
    const register = api.registerMcpServer as (name: string, config: Record<string, unknown>) => void;
    register("muninndb", MCP_SERVER_CONFIG);
  }

  if (host === "pi-legacy") {
    // Pre-0.99 Pi has no MCP at all; tell the user what to install. We never
    // install it ourselves.
    pi.on("session_start", async (_event, ctx) => {
      if (piMcpAdapterMissing()) {
        ctx.ui.notify(
          "⚠️ This Pi build has no native MCP support and pi-mcp-adapter is not installed — muninn_* tools will be unavailable. Install it with `pi install npm:pi-mcp-adapter`, then copy this package's .mcp.json entry into ~/.config/mcp/mcp.json.",
          "warning",
        );
      }
    });
  }

  // Health warning on every host; subagent sessions stay quiet (OMP only —
  // ctx.agent is an OMP surface, absent on Pi).
  pi.on("session_start", async (_event, ctx) => {
    const agent = (ctx as unknown as Record<string, unknown>).agent;
    if (agent && typeof agent === "object" && (agent as Record<string, unknown>).kind === "sub") return;
    const warning = await muninnStatusWarning();
    if (warning) ctx.ui.notify(warning, "warning");
  });
}

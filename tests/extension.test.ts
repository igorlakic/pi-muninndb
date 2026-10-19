import { createServer } from "node:http";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { muninnHealthOk, muninnBinaryFound, muninnStatusWarning, hostKind, piMcpAdapterMissing } from "../src/extension.ts";

await test("health probe follows MUNINN_REST_PORT", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/api/health") {
      res.statusCode = 200;
      res.end("ok");
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  server.listen(4575);
  try {
    process.env.MUNINN_REST_PORT = "4575";
    const ok = await muninnHealthOk();
    if (ok !== true) throw new Error(`expected healthy probe on :4575, got ${ok}`);
  } finally {
    delete process.env.MUNINN_REST_PORT;
    server.close();
  }
});

await test("dead port reports unhealthy", async () => {
  const ok = await muninnHealthOk(1);
  if (ok !== false) throw new Error(`expected unhealthy probe on :1, got ${ok}`);
});

await test("binary detection scans PATH and ~/.local/bin", async () => {
  const dir = mkdtempSync(join(tmpdir(), "muninn-bin-"));
  try {
    writeFileSync(join(dir, "muninn"), "#!/bin/sh\n");
    chmodSync(join(dir, "muninn"), 0o755);
    process.env.PATH = dir;
    process.env.HOME = dir;
    if (!muninnBinaryFound()) throw new Error("expected binary found via PATH");
  } finally {
    rmSync(dir, { recursive: true });
  }
});

await test("missing binary and dead server report not-installed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "muninn-none-"));
  try {
    process.env.PATH = dir;
    process.env.HOME = dir;
    process.env.MUNINN_REST_PORT = "1";
    const warning = await muninnStatusWarning();
    if (warning === null || !warning.includes("not installed")) {
      throw new Error(`expected not-installed warning, got ${JSON.stringify(warning)}`);
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});

await test("hostKind classifies OMP, Pi-native, and legacy Pi", async () => {
  if (hostKind({ pi: {}, registerMcpServer: () => {} }) !== "omp") {
    throw new Error("OMP markers must win over registerMcpServer");
  }
  if (hostKind({ registerMcpServer: () => {} }) !== "pi-native") {
    throw new Error("registerMcpServer must classify as pi-native");
  }
  if (hostKind({}) !== "pi-legacy") {
    throw new Error("bare API surface must classify as pi-legacy");
  }
});

await test("pi-mcp-adapter detection reads settings.json packages", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-settings-"));
  try {
    const settings = join(dir, "settings.json");
    writeFileSync(settings, JSON.stringify({ packages: ["npm:@gaodes/pi-muninndb@1.0.0"] }));
    if (!piMcpAdapterMissing(settings)) throw new Error("expected adapter reported missing");
    writeFileSync(settings, JSON.stringify({ packages: ["npm:pi-mcp-adapter@5.0.0"] }));
    if (piMcpAdapterMissing(settings)) throw new Error("expected adapter reported present");
  } finally {
    rmSync(dir, { recursive: true });
  }
});

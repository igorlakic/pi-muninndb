# @iggy-lakic/pi-muninndb

MuninnDB MCP plugin for [Pi](https://github.com/earendil-works/pi) and
[OMP](https://omp.sh) — one package, works equally well on both hosts. It
registers the MuninnDB MCP server and nothing else. If MuninnDB is not
running, you get a single warning at session start. The plugin **never
installs, starts, stops, or mutates anything** on your system.

## What it does

| Piece | Behavior |
| --- | --- |
| `src/extension.ts` | Loads on both hosts. On Pi ≥0.99 it registers the `muninndb` MCP server via `pi.registerMcpServer` (native, no adapter). On OMP, MCP comes from the package-root `.mcp.json` (native discovery). On older Pi it warns with the exact `pi install npm:pi-mcp-adapter` command. On every host it probes `http://127.0.0.1:8475/api/health` at `session_start` and warns once if MuninnDB is down ("installed but not running" vs "not installed"). |
| `.mcp.json` (package root) | Declares the `muninndb` MCP server (`http://127.0.0.1:8750/mcp`) with token indirection — consumed by OMP natively and by `pi-mcp-adapter` on legacy Pi. |

## What it does not do

Compared to [`@gaodes/pi-muninndb`](https://github.com/gaodes/pi-muninndb)
(the Pi extension this project was modeled on), this package deliberately
drops:

- MuninnDB installation (no `install.sh` download; only a read-only `PATH` scan to classify the warning)
- starting/stopping the MuninnDB service
- AGENTS.md generation
- SSE subscriptions, vault auto-injection, batch nudges, dream/backup/import/upgrade/test commands

## Install

On Pi:

```bash
pi install npm:@iggy-lakic/pi-muninndb
# development checkout:
pi install /home/iggy/Projects/pi-muninndb
```

On OMP:

```bash
omp plugin install @iggy-lakic/pi-muninndb
# development checkout:
omp plugin link /home/iggy/Projects/pi-muninndb

Either host then mounts the `muninn_*` MCP tools; on OMP they show in `/mcp list`
with source: the plugin package.

> If you previously added MuninnDB to `~/.omp/agent/mcp.json` (OMP) or
> `~/.config/mcp/mcp.json` (Pi/adapter) by hand, remove that entry — this
> package's declaration replaces it. A stale hand-written entry shadows the
> plugin's (user config has higher precedence on both hosts).

## Token handling

The MCP server definition never contains a token. The `Authorization`
header uses the hosts' `!command` indirection (supported identically by
Pi and OMP), resolving the token MuninnDB's running service actually
expects, in order:

1. `MUNINN_MCP_TOKEN` from the systemd user-service override or
   `~/.muninn/muninn.env` (whichever defines it first)
2. fallback: `~/.muninn/mcp.token` (MuninnDB's default token file)

If none exist (MuninnDB not installed), the header is empty and the
connection simply fails — the extension's warning tells you why.

## Host matrix

| Host | MCP wiring |
| --- | --- |
| Pi ≥0.99 | `pi.registerMcpServer` at load — native, no adapter |
| Pi <0.99 | no native MCP: warning tells you to `pi install npm:pi-mcp-adapter` and copy the `.mcp.json` entry to `~/.config/mcp/mcp.json`; the plugin never installs it |
| OMP | package-root `.mcp.json` (native plugin discovery) |

One module serves both: the import scope is `@earendil-works/pi-coding-agent`
(Pi's own scope), and OMP's legacy-Pi loader rewrites it onto its bundled
copy. Both hosts read the `pi` manifest key. Host detection is feature-based
(OMP-only API members vs `registerMcpServer`), so a future host that adds
either surface still lands in the right branch.

## New machine / fresh MuninnDB install

Nothing to configure. A fresh MuninnDB install writes a full-access token to
`~/.muninn/mcp.token`, which the fallback chain above picks up
automatically. The only per-machine steps are MuninnDB's own (install the
binary, start the service) — deliberately out of scope for this plugin.

Pitfall: never set `MUNINN_MCP_TOKEN` (in a service override or `muninn.env`)
to an `mk_` API key — those are scoped to a single vault and reject
cross-vault calls. If you pin a token at all, pin the full-access one from
`~/.muninn/mcp.token`.

Ports: the plugin assumes MuninnDB defaults (MCP `8750`, REST `8475`). If a
machine's service uses different ports, edit the URL in `.mcp.json`; the
health probe also honors `MUNINN_REST_PORT`.

## Development

```bash
npm test         # status-detection + host-classification unit tests (tsx)
npm run check    # tsc --noEmit (needs @earendil-works/pi-coding-agent installed for the type import)
```

## Credits

- Maintainer: Igor Lakić
- Modeled on [`@gaodes/pi-muninndb`](https://github.com/gaodes/pi-muninndb) (MIT), itself a fork of `@kuyavinny/pi-muninn-mem` — the shared lineage is the MuninnDB MCP tool surface; the implementation here is independent and intentionally minimal.
- [MuninnDB](https://github.com/scrypster/muninndb) by scrypster.

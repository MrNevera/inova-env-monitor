# EnvMonitor — AGENTS.md

Project instructions for autonomous agents working on the env-monitor project.

## Project purpose

Real-time environmental monitoring dashboard (WorldSkills HR demo): mock IoT sensors stream readings via REST + WebSocket, data lands in SQLite, a processing stage detects anomalies/spikes/trends, and the dashboard surfaces KPIs, alerts, and sensor status live.

Data flow: `sensors → ingest (REST + WS) → SQLite → processing (anomaly/spike/trend) → dashboard + alerts`.

## Stack & versions

- Node.js 24 (ESM, `"type": "module"`)
- Express (REST server)
- ws (WebSocket server)
- better-sqlite3 (SQLite, native module)
- Chart.js (frontend dashboard, CDN in index.html)
- Docker / docker-compose (Node 24 alpine)

## How to run

| Task | Command |
|------|---------|
| Install deps | `npm install` |
| Run dev (server) | `npm dev` (alias of `start`) |
| Run prod | `npm start` → `node server.js` |
| Seed DB | `npm run seed` → `node scripts/seed.js` (idempotent; 12 sensors + 240 historical readings) |
| Run tests | `npm test` → `node --test tests/*.test.js` |
| Docker | `docker compose up --build` (port 3000, DB at `/data/envmonitor.db`) |

Env vars: `PORT` (default 3000), `DB_PATH` (default: `envmonitor.db` next to server.js).

Open `http://localhost:3000/index.html` for the dashboard. The simulator seeds 12 sensors and emits a reading every 2s.

Live curl checks:

```bash
curl http://localhost:3000/api/sensors
curl http://localhost:3000/api/kpi
curl http://localhost:3000/api/process-all
```

## Project structure (top-level files & roles)

| File | Role |
|------|------|
| `server.js` | Entry. Express REST API + WebSocket server, simulator tick (2s), broadcast logic |
| `db.js` | better-sqlite3 schema (`initSchema`), prepared statements, queries (readings, alerts, sensors, KPI, aggregates) |
| `processing.js` | Pure processing functions: `aggregate`, `detectAnomalies`, `detectSpikes`, `trend`, `processSensor` |
| `simulator.js` | Mock sensor definitions (12 sensors), deterministic random-walk `nextReading`, `seedSensors` |
| `index.html` | Dashboard frontend (Chart.js, WebSocket client) |
| `openapi.yaml` | Source of truth for the REST API contract |
| `scripts/seed.js` | Idempotent DB seed (12 sensors + 240 historical readings, fixed timestamps) |
| `scripts/export-report.js` | CSV report generation for one sensor over a time window |
| `Dockerfile` | Multi-stage Node 24 alpine image, rebuilds better-sqlite3 for target arch |
| `docker-compose.yml` | One `env-monitor` service, port 3000, named `data` volume |
| `package.json` | Scripts: start / dev / seed / test; ESM module |
| `tests/` | Unit tests using Node built-in `node:test` runner |

## Coding conventions

- ESM modules only (`import`/`export`), no `require`.
- `processing.js`: pure functions — no side effects, deterministic output for fixed input, easy to unit test.
- `db.js`: all writes/reads via prepared statements (`db.prepare(...)`), never raw concatenated SQL.
- No `Date.now()` in tests — use fixed timestamps (e.g. `1735689600000`) so tests are deterministic.
- Threshold breach → insert alert + WebSocket broadcast (`{type:'alert'}`).
- Keep functions small and single-purpose; prefer composition over large procedural blocks.

## How the processing pipeline works

1. **Ingest**: simulator tick (every 2s) or `POST /api/readings` calls `insertReading` → SQLite `readings` table; threshold check inserts into `alerts` and broadcasts `{type:'alert'}` over WS; every reading broadcasts `{type:'reading'}`.
2. **SQLite**: `envmonitor.db` (WAL mode) holds `sensors`, `readings`, `alerts`, `aggregates`, `audit_log`.
3. **Processing**: `GET /api/process/:sensorId` (or `/api/process-all`) pulls a readings window via `readingsWindow`, then `processSensor(sensor, readings, opts)` combines `aggregate`, `detectAnomalies` (z-score), `detectSpikes`, `trend`, and threshold breach count into one structured result with `severity` (`ok`/`warn`).
4. **Dashboard / alerts**: `index.html` consumes WS broadcasts and polls `/api/kpi`, `/api/alerts`; KPI snapshot marks sensors above threshold as `warn`.

## Where to add new tests

- Put tests in `tests/*.test.js`.
- Runner: Node built-in `node:test` (`import { test } from 'node:test'`, `import assert from 'node:assert/strict'`).
- Run with `npm test` (`node --test tests/*.test.js`).
- Use fixed timestamps; never `Date.now()` in assertions. For DB tests use a temp DB path (do not write to the real `envmonitor.db`).

## Env vars

- `PORT` — HTTP server port (default `3000`).
- `DB_PATH` — SQLite file path (default: `envmonitor.db` next to `server.js`; Docker uses `/data/envmonitor.db`).

## ponytail

Ceiling: docs only, no code change. Upgrade path: add a `docs/` folder if the project grows beyond two instruction files; keep AGENTS.md and CLAUDE.md in sync when conventions change.
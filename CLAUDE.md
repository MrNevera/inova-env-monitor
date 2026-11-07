# EnvMonitor — CLAUDE.md

Coding context for Claude sessions on the env-monitor project.

## Stack summary

Node.js 24, ESM (`"type": "module"`), Express REST API, `ws` WebSocket server, better-sqlite3 (SQLite), Chart.js frontend (CDN). Entry: `server.js`. Port 3000 (`PORT` env). DB via `DB_PATH` env (default `envmonitor.db` next to `server.js`).

## Key files map

| File | Responsibility |
|------|----------------|
| `server.js` | Express + ws server; REST routes; WebSocket broadcast; simulator tick every 2s |
| `db.js` | Schema (`initSchema`) + prepared statements: sensors, readings, alerts, aggregates, audit_log |
| `processing.js` | Pure functions: `aggregate`, `detectAnomalies`, `detectSpikes`, `trend`, `processSensor` |
| `simulator.js` | 12 mock sensors, deterministic random-walk `nextReading`, `seedSensors` |
| `index.html` | Dashboard (Chart.js + WebSocket client) |
| `openapi.yaml` | REST API contract (source of truth) |
| `scripts/seed.js` | Idempotent seed: 12 sensors + 240 historical readings (fixed timestamps) |
| `scripts/export-report.js` | CSV report per sensor over a time window |
| `tests/processing.test.js` | Unit tests (node:test) for processing functions |

## Coding conventions

- ESM `import`/`export` only; no `require`/`module.exports`.
- `db.js`: all SQL via prepared statements (`db.prepare(...)`); no string-concatenated queries.
- Pure functions preferred (especially in `processing.js`); no side effects, deterministic output.
- Threshold breach → insert alert row + WebSocket broadcast `{type:'alert', sensorId, value, threshold}`.
- Every ingested reading also broadcasts `{type:'reading', sensorId, value, at}`.
- Simulator uses deterministic PRNG (no `Math.random`) so demo is reproducible.

## Test conventions

- Runner: Node built-in `node:test` (`import { test } from 'node:test'`, `import assert from 'node:assert/strict'`).
- Tests live in `tests/*.test.js`; run with `npm test`.
- Temp DB path for any DB tests — never write to the real `envmonitor.db`.
- Deterministic data only: no `Date.now()` in assertions; use fixed timestamps.
- Keep tests small and focused on one function/behavior.

## API contract reference

`openapi.yaml` is the source of truth for REST routes:

- `GET /api/sensors` — list sensors
- `GET /api/kpi` — latest reading + threshold status per sensor
- `POST /api/readings` — ingest `{sensorId, value, recordedAt?}`
- `GET /api/readings/:sensorId` — readings window (`?from=&to=` unix ms)
- `GET /api/alerts` — recent alerts
- `GET /api/process/:sensorId` — anomaly/spike/trend analysis for one sensor
- `GET /api/process-all` — analysis for all sensors (last 1h)
- `GET /api/report/:sensorId` — CSV report
- `POST /api/import/csv` — bulk import

WebSocket (not in OpenAPI): broadcasts `{type:'hello'}` on connect, `{type:'reading'}` per reading, `{type:'alert'}` on threshold breach.

## How to verify changes

1. `npm test` must pass (all `tests/*.test.js`).
2. `npm start` must boot and log `EnvMonitor running on http://localhost:3000`.
3. Curl endpoints:
   ```bash
   curl http://localhost:3000/api/sensors
   curl http://localhost:3000/api/kpi
   curl http://localhost:3000/api/process-all
   curl http://localhost:3000/api/alerts
   ```
4. Open `http://localhost:3000/index.html` and confirm WS connects and readings flow.
5. Docker: `docker compose up --build` then hit `localhost:3000`.

## ponytail

Ceiling: context doc only, no runtime behavior changed. Upgrade path: add a `CLAUDE.md` section for new conventions when they are introduced; keep it aligned with `AGENTS.md`.
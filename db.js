import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'envmonitor.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sensors (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      zone        TEXT NOT NULL,
      type        TEXT NOT NULL,        -- pm25 | co2 | temp | humidity | noise
      unit        TEXT NOT NULL,
      online      INTEGER NOT NULL DEFAULT 1,
      threshold   REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS readings (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      sensor_id  TEXT NOT NULL,
      value      REAL NOT NULL,
      recorded_at INTEGER NOT NULL,        -- unix ms
      FOREIGN KEY (sensor_id) REFERENCES sensors(id)
    );
    CREATE INDEX IF NOT EXISTS idx_readings_sensor ON readings(sensor_id, recorded_at DESC);

    CREATE TABLE IF NOT EXISTS aggregates (
      sensor_id   TEXT NOT NULL,
      window      TEXT NOT NULL,            -- 1h | 24h
      bucket_start INTEGER NOT NULL,
      bucket_end   INTEGER NOT NULL,
      avg         REAL NOT NULL,
      min         REAL NOT NULL,
      max         REAL NOT NULL,
      count       INTEGER NOT NULL,
      PRIMARY KEY (sensor_id, window, bucket_start)
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      sensor_id  TEXT NOT NULL,
      type      TEXT NOT NULL,               -- threshold | anomaly | spike
      severity  TEXT NOT NULL,               -- warn | critical
      message   TEXT NOT NULL,
      value     REAL NOT NULL,
      threshold REAL NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at DESC);

    CREATE TABLE IF NOT EXISTS audit_log (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      entity    TEXT NOT NULL,
      entity_id TEXT,
      action    TEXT NOT NULL,
      detail    TEXT,
      at        INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version   TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
}

// Runs SQL migration files from migrations/ (relative to db.js) in filename order.
// Applies each not-yet-applied migration inside a transaction and records the version.
// Idempotent: re-running applies nothing new. Called at module load.
export function migrate() {
  const ensureMigrationsTable = db.prepare(
    `CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`
  );
  ensureMigrationsTable.run();

  const applied = new Set(db.prepare(`SELECT version FROM schema_migrations`).all().map(r => r.version));

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const insertVersion = db.prepare(`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`);

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const runMigration = db.transaction(() => {
      db.exec(sql);
      insertVersion.run(file, Date.now());
    });
    runMigration();
  }
}

export function upsertSensor(s) {
  const ins = db.prepare(`
    INSERT INTO sensors (id,name,zone,type,unit,online,threshold)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, zone=excluded.zone, type=excluded.type,
      unit=excluded.unit, online=excluded.online, threshold=excluded.threshold
  `);
  return ins.run(s.id, s.name, s.zone, s.type, s.unit, s.online ? 1 : 0, s.threshold ?? 0);
}

export function insertReading(sensorId, value, recordedAt) {
  return db.prepare(
    `INSERT INTO readings (sensor_id, value, recorded_at) VALUES (?,?,?)`
  ).run(sensorId, value, recordedAt);
}

export function insertAlert(a) {
  return db.prepare(
    `INSERT INTO alerts (sensor_id,type,severity,message,value,threshold,created_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run(a.sensorId, a.type, a.severity, a.message, a.value, a.threshold, a.created_at);
}

export function audit(entity, entityId, action, detail) {
  return db.prepare(
    `INSERT INTO audit_log (entity,entity_id,action,detail,at) VALUES (?,?,?,?,?)`
  ).run(entity, entityId, action, detail, Date.now());
}

export function transaction(fn) {
  return db.transaction(fn);
}

// Apply pending migrations at module load.
migrate();

export function latestReading(sensorId) {
  return db.prepare(
    `SELECT value, recorded_at FROM readings WHERE sensor_id=? ORDER BY recorded_at DESC LIMIT 1`
  ).get(sensorId);
}

export function readingsWindow(sensorId, from, to) {
  return db.prepare(
    `SELECT value, recorded_at FROM readings WHERE sensor_id=? AND recorded_at>=? AND recorded_at<=? ORDER BY recorded_at`
  ).all(sensorId, from, to);
}

export function aggregateWindow(sensorId, window, bucketStart, bucketEnd) {
  const row = db.prepare(
    `SELECT AVG(value) as avg, MIN(value) as min, MAX(value) as max, COUNT(*) as count
     FROM readings WHERE sensor_id=? AND recorded_at>=? AND recorded_at<=?`
  ).get(sensorId, bucketStart, bucketEnd);
  const upsert = db.prepare(`
    INSERT INTO aggregates (sensor_id,window,bucket_start,bucket_end,avg,min,max,count)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(sensor_id,window,bucket_start) DO UPDATE SET
      avg=excluded.avg, min=excluded.min, max=excluded.max, count=excluded.count
  `);
  upsert.run(sensorId, window, bucketStart, bucketEnd, row.avg, row.min, row.max, row.count);
  return row;
}

export function recentAlerts(limit = 20) {
  return db.prepare(
    `SELECT a.*, s.name as sensor_name, s.zone FROM alerts a
     JOIN sensors s ON s.id=a.sensor_id
     ORDER BY a.created_at DESC LIMIT ?`
  ).all(limit);
}

export function allSensors() {
  return db.prepare(`SELECT * FROM sensors ORDER BY id`).all();
}

export function sensorById(id) {
  return db.prepare(`SELECT * FROM sensors WHERE id=?`).get(id);
}

export function kpiSnapshot() {
  // current snapshot per sensor: latest reading + whether above threshold
  const sensors = allSensors();
  const out = [];
  for (const s of sensors) {
    const r = latestReading(s.id);
    if (!r) continue;
    out.push({ sensor: s, value: r.value, at: r.recorded_at, above: s.threshold > 0 && r.value > s.threshold });
  }
  return out;
}
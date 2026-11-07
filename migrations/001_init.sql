-- Migration 001: initial schema
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

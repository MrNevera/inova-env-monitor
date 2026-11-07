// scripts/seed.js — idempotent seed: 12 sensors + deterministic historical readings.
// Safe to import as a module; auto-run only when executed directly.
import { fileURLToPath } from 'node:url';
import { initSchema, upsertSensor, insertReading, audit, db } from '../db.js';
const BASE = {
  pm25:     { base: 42, amp: 14, noise: 3, unit: 'µg/m³', threshold: 50 },
  co2:      { base: 780, amp: 120, noise: 20, unit: 'ppm',  threshold: 1000 },
  temp:     { base: 23, amp: 3, noise: 0.6, unit: '°C', threshold: 28 },
  humidity: { base: 56, amp: 10, noise: 2, unit: '%', threshold: 80 },
  noise:    { base: 60, amp: 12, noise: 3, unit: 'dB', threshold: 75 }
};

function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return Math.abs(h); }
function rng(seed) { let s = seed % 2147483647; if (s <= 0) s += 2147483646; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

const SENSORS = [
  ['S-01', 'Lobby', 'Lobby', 'pm25'], ['S-02', 'Office A', 'Office A', 'pm25'], ['S-03', 'Office B', 'Office B', 'pm25'],
  ['S-04', 'Server room', 'Server room', 'co2'], ['S-05', 'Lab', 'Lab', 'co2'], ['S-06', 'Cafeteria', 'Cafeteria', 'co2'],
  ['S-07', 'Meeting room', 'Meeting room', 'temp'], ['S-08', 'Open plan', 'Open plan', 'humidity'],
  ['S-09', 'Archive', 'Archive', 'noise'], ['S-10', 'Entrance', 'Entrance', 'noise'],
  ['S-11', 'Lab 2', 'Lab', 'temp'], ['S-12', 'Office A 2', 'Office A', 'humidity']
];

// Fixed base timestamp so re-runs are reproducible (no Date.now()).
const BASE_TS = 1735689600000; // 2025-01-01T00:00:00Z
const READINGS_PER_SENSOR = 20;

function makeSensor(id, name, zone, type) {
  const cfg = BASE[type];
  return { id, name, zone, type, unit: cfg.unit, online: 1, threshold: cfg.threshold };
}

function historicalReadings(sensor) {
  const cfg = BASE[sensor.type];
  const r = rng(hashStr(sensor.id));
  const out = [];
  let v = cfg.base;
  for (let i = READINGS_PER_SENSOR - 1; i >= 0; i--) {
    const spike = r() < 0.04;
    v = cfg.base + (r() - 0.5) * cfg.noise * 2;
    if (spike) v += cfg.amp * 1.8;
    v = Math.max(0, v);
    out.push({ sensorId: sensor.id, value: +v.toFixed(2), recordedAt: BASE_TS - i * 300000 });
  }
  return out;
}

export function seed() {
  initSchema();
  const from = BASE_TS - READINGS_PER_SENSOR * 300000;
  const to = BASE_TS;
  db.prepare('DELETE FROM readings WHERE recorded_at>=? AND recorded_at<=?').run(from, to);
  let sensors = 0, readings = 0;
  for (const def of SENSORS) {
    const [id, name, zone, type] = def;
    upsertSensor(makeSensor(id, name, zone, type));
    sensors++;
    for (const row of historicalReadings(makeSensor(id, name, zone, type))) {
      insertReading(row.sensorId, row.value, row.recordedAt);
      readings++;
    }
  }
  audit('sensors', null, 'seed', `${sensors} sensors seeded`);
  return { sensors, readings };
}

function main() {
  const { sensors, readings } = seed();
  console.log(`Seed complete: ${sensors} sensors, ${readings} historical readings (BASE_TS=${BASE_TS}).`);
}

const IS_MAIN = process.argv[1] === fileURLToPath(import.meta.url);
if (IS_MAIN) main();

// simulator.js — prikupljanje podataka (mock IoT senzori koji emitiraju uživo)
// Each tick: generate a reading per sensor, inject via REST, broadcast via WebSocket.

import { allSensors, insertReading, audit, latestReading, upsertSensor } from './db.js';

const BASE = {
  pm25:     { base: 42, amp: 14, noise: 3, unit: 'µg/m³', threshold: 50 },
  co2:      { base: 780, amp: 120, noise: 20, unit: 'ppm',  threshold: 1000 },
  temp:     { base: 23, amp: 3, noise: 0.6, unit: '°C', threshold: 28 },
  humidity: { base: 56, amp: 10, noise: 2, unit: '%', threshold: 80 },
  noise:    { base: 60, amp: 12, noise: 3, unit: 'dB', threshold: 75 }
};

function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return Math.abs(h); }

// Deterministic pseudo-random walk so demo is reproducible.
function rng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export function makeSensor(id, name, zone, type) {
  const cfg = BASE[type];
  return {
    id, name, zone, type, unit: cfg.unit, online: 1, threshold: cfg.threshold,
    _cfg: cfg, _rng: rng(hashStr(id)), _value: cfg.base
  };
}

// Generate next reading with a random walk + occasional spike (simulating real events).
export function nextReading(sensor) {
  const cfg = sensor._cfg;
  const r1 = sensor._rng();
  const r2 = sensor._rng();
  // 4% chance of a spike event (anomaly demo)
  const spike = r1 < 0.04;
  // value stays around base + small noise, no persistent drift
  let v = cfg.base + (r2 - 0.5) * cfg.noise * 2;
  if (spike) v += cfg.amp * 1.8;
  v = Math.max(0, v);
  sensor._value = v;
  return { sensorId: sensor.id, value: +v.toFixed(2), recordedAt: Date.now() };
}

export function seedSensors() {
  const defs = [
    ['S-01', 'Lobby', 'Lobby', 'pm25'], ['S-02', 'Office A', 'Office A', 'pm25'], ['S-03', 'Office B', 'Office B', 'pm25'],
    ['S-04', 'Server room', 'Server room', 'co2'], ['S-05', 'Lab', 'Lab', 'co2'], ['S-06', 'Cafeteria', 'Cafeteria', 'co2'],
    ['S-07', 'Meeting room', 'Meeting room', 'temp'], ['S-08', 'Open plan', 'Open plan', 'humidity'],
    ['S-09', 'Archive', 'Archive', 'noise'], ['S-10', 'Entrance', 'Entrance', 'noise'],
    ['S-11', 'Lab 2', 'Lab', 'temp'], ['S-12', 'Office A 2', 'Office A', 'humidity']
  ];
  const sensors = defs.map(([id, name, zone, type]) => makeSensor(id, name, zone, type));
  for (const s of sensors) {
    upsertSensor({ id: s.id, name: s.name, zone: s.zone, type: s.type, unit: s._cfg.unit, online: 1, threshold: s._cfg.threshold });
  }
  audit('sensors', null, 'seed', `${sensors.length} sensors seeded`);
  return sensors;
}
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point db.js at a temp SQLite file BEFORE importing any module that imports db.js.
process.env.DB_PATH = path.join(os.tmpdir(), `env-monitor-test-${process.pid}.db`);

import { db, initSchema, upsertSensor, insertReading } from '../db.js';
import { exportReportCsv } from '../scripts/export-report.js';

const SENSOR = 'sensor-1';
const FROM = 1735689600000;
const TO = 1735776000000;

function clean() {
  db.exec('DELETE FROM aggregates');
  db.exec('DELETE FROM readings');
  db.exec('DELETE FROM sensors');
}

function seed() {
  clean();
  initSchema();
  upsertSensor({ id: SENSOR, name: 'Temp', zone: 'A', type: 'temp', unit: 'C', online: 1, threshold: 0 });
  insertReading(SENSOR, 20, FROM);
  insertReading(SENSOR, 25, FROM + 60000);
  insertReading(SENSOR, 30, TO);
}

test('exportReportCsv header row is exactly sensorId,value,recordedAt,rowType', () => {
  seed();
  const csv = exportReportCsv(SENSOR, FROM, TO);
  const header = csv.split('\n')[0];
  assert.equal(header, 'sensorId,value,recordedAt,rowType');
});

test('exportReportCsv includes reading rows with correct columns and rowType=reading', () => {
  seed();
  const csv = exportReportCsv(SENSOR, FROM, TO);
  const lines = csv.split('\n');
  const readings = lines.filter((line) => line.endsWith(',reading'));
  assert.equal(readings.length, 3);
  assert.equal(readings[0], `${SENSOR},20,${FROM},reading`);
  assert.equal(readings[1], `${SENSOR},25,${FROM + 60000},reading`);
  assert.equal(readings[2], `${SENSOR},30,${TO},reading`);
});

test('exportReportCsv appends one aggregate row with rowType=aggregate at the end', () => {
  seed();
  const csv = exportReportCsv(SENSOR, FROM, TO);
  const lines = csv.split('\n');
  const last = lines[lines.length - 2]; // skip trailing empty from split after final \n
  assert.ok(last.endsWith(',aggregate'));
  assert.equal(last.split(',')[0], SENSOR);
  assert.equal(last.split(',')[3], 'aggregate');
  const aggregates = lines.filter((line) => line.endsWith(',aggregate'));
  assert.equal(aggregates.length, 1);
});

test('exportReportCsv returns header-only CSV for empty window', () => {
  clean();
  initSchema();
  upsertSensor({ id: SENSOR, name: 'Temp', zone: 'A', type: 'temp', unit: 'C', online: 1, threshold: 0 });
  const csv = exportReportCsv(SENSOR, FROM, TO);
  assert.equal(csv, 'sensorId,value,recordedAt,rowType\n');
  assert.equal(csv.split('\n').length, 2);
});

test('exportReportCsv uses \\n line endings only', () => {
  seed();
  const csv = exportReportCsv(SENSOR, FROM, TO);
  assert.ok(!csv.includes('\r\n'));
  assert.ok(!csv.includes('\r'));
});

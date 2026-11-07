import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

process.env.DB_PATH = join(tmpdir(), `env-monitor-test-${process.pid}-${Date.now()}.db`);

let db, initSchema, upsertSensor, insertReading, insertAlert, audit,
  latestReading, readingsWindow, aggregateWindow, recentAlerts, allSensors,
  sensorById, kpiSnapshot, transaction;

const mod = await import('../db.js');
({ db, initSchema, upsertSensor, insertReading, insertAlert, audit,
  latestReading, readingsWindow, aggregateWindow, recentAlerts, allSensors,
  sensorById, kpiSnapshot, transaction } = mod);

const T0 = 1700000000000;
const T1 = T0 + 60000;
const T2 = T0 + 120000;

describe('db', () => {
  test.before(async () => initSchema());

  test.after(() => {
    try { db.close(); } catch (_) { /* noop */ }
    try { rmSync(process.env.DB_PATH, { force: true }); } catch (_) { /* noop */ }
    try { rmSync(process.env.DB_PATH + '-wal', { force: true }); } catch (_) { /* noop */ }
    try { rmSync(process.env.DB_PATH + '-shm', { force: true }); } catch (_) { /* noop */ }
  });

  test('upsertSensor inserts + updates a sensor (idempotent on conflict)', () => {
    const s = { id: 's1', name: 'CO2', zone: 'A', type: 'co2', unit: 'ppm', online: 1, threshold: 1000 };
    const r1 = upsertSensor(s);
    assert.equal(r1.changes, 1);

    const got = sensorById('s1');
    assert.equal(got.id, 's1');
    assert.equal(got.name, 'CO2');
    assert.equal(got.zone, 'A');
    assert.equal(got.type, 'co2');
    assert.equal(got.unit, 'ppm');
    assert.equal(got.online, 1);
    assert.equal(got.threshold, 1000);

    const s2 = { ...s, name: 'CO2-updated', threshold: 2000 };
    const r2 = upsertSensor(s2);
    assert.equal(r2.changes, 1);
    const got2 = sensorById('s1');
    assert.equal(got2.name, 'CO2-updated');
    assert.equal(got2.threshold, 2000);

    const count = db.prepare('SELECT COUNT(*) AS n FROM sensors WHERE id=?').get('s1').n;
    assert.equal(count, 1);
  });

  test('insertReading + latestReading returns the reading', () => {
    upsertSensor({ id: 's2', name: 'T1', zone: 'B', type: 'temp', unit: 'c', online: 1, threshold: 30 });

    insertReading('s2', 22.5, T0);
    insertReading('s2', 23.0, T1);

    const latest = latestReading('s2');
    assert.equal(latest.value, 23.0);
    assert.equal(latest.recorded_at, T1);
  });

  test('readingsWindow returns readings in [from, to] range ordered by recorded_at', () => {
    upsertSensor({ id: 's3', name: 'T2', zone: 'C', type: 'temp', unit: 'c', online: 1, threshold: 30 });

    insertReading('s3', 1, T0 - 1000);
    insertReading('s3', 2, T0);
    insertReading('s3', 3, T1);
    insertReading('s3', 4, T2 + 1000);

    const rows = readingsWindow('s3', T0, T2);
    assert.deepEqual(rows.map(r => r.value), [2, 3]);
    assert.deepEqual(rows.map(r => r.recorded_at), [T0, T1]);
  });

  test('sensorById returns sensor or undefined for missing id', () => {
    assert.equal(sensorById('does-not-exist'), undefined);
    const got = sensorById('s1');
    assert.equal(got.id, 's1');
  });

  test('allSensors returns all sensors ordered by id', () => {
    const rows = allSensors();
    const ids = rows.map(r => r.id);
    assert.deepEqual(ids, ids.slice().sort());
    assert.ok(ids.includes('s1'));
    assert.ok(ids.includes('s2'));
    assert.ok(ids.includes('s3'));
  });

  test('kpiSnapshot returns entries with above flag vs threshold', () => {
    upsertSensor({ id: 's4', name: 'PM', zone: 'D', type: 'pm25', unit: 'ug/m3', online: 1, threshold: 50 });
    insertReading('s4', 10, T0);
    upsertSensor({ id: 's5', name: 'PM2', zone: 'D', type: 'pm25', unit: 'ug/m3', online: 1, threshold: 5 });
    insertReading('s5', 100, T0);

    const snap = kpiSnapshot();
    const byId = Object.fromEntries(snap.map(e => [e.sensor.id, e]));
    assert.equal(byId.s4.value, 10);
    assert.equal(byId.s4.above, false);
    assert.equal(byId.s5.value, 100);
    assert.equal(byId.s5.above, true);
  });

  test('insertAlert + recentAlerts returns alerts ordered desc, limited', () => {
    upsertSensor({ id: 's1', name: 'CO2-updated', zone: 'A', type: 'co2', unit: 'ppm', online: 1, threshold: 1000 });
    upsertSensor({ id: 's2', name: 'T1', zone: 'B', type: 'temp', unit: 'c', online: 1, threshold: 30 });
    insertAlert({ sensorId: 's1', type: 'threshold', severity: 'warn', message: 'high', value: 101, threshold: 1000, created_at: T0 });
    insertAlert({ sensorId: 's2', type: 'critical', severity: 'critical', message: 'hot', value: 99, threshold: 30, created_at: T1 });
    insertAlert({ sensorId: 's1', type: 'spike', severity: 'warn', message: 'spike', value: 5, threshold: 1, created_at: T2 });

    const all = recentAlerts();
    assert.equal(all.length, 3);
    assert.deepEqual(all.map(a => a.created_at), [T2, T1, T0]);
    assert.equal(all[0].sensor_name, 'CO2-updated');

    const limited = recentAlerts(2);
    assert.equal(limited.length, 2);
    assert.deepEqual(limited.map(a => a.created_at), [T2, T1]);
  });

  test('audit writes to audit_log', () => {
    audit('sensor', 's1', 'upsert', 'created sensor s1');
    const row = db.prepare('SELECT * FROM audit_log WHERE entity=? AND action=?').get('sensor', 'upsert');
    assert.equal(row.entity_id, 's1');
    assert.equal(row.detail, 'created sensor s1');
    assert.equal(typeof row.at, 'number');
  });

  test('transaction runs multiple statements atomically', () => {
    const tx = transaction(() => {
      insertReading('s3', 42, T0);
      audit('reading', null, 'insert', 'tx test reading');
    });
    tx();

    const n = db.prepare('SELECT COUNT(*) AS n FROM readings WHERE sensor_id=? AND value=?').get('s3', 42).n;
    assert.equal(n, 1);
    const auditRow = db.prepare('SELECT * FROM audit_log WHERE detail=?').get('tx test reading');
    assert.equal(auditRow.entity, 'reading');
  });

  test('transaction rolls back on error', () => {
    const tx = transaction(() => {
      insertReading('s3', 43, T0);
      throw new Error('boom');
    });
    assert.throws(() => tx(), /boom/);

    const n = db.prepare('SELECT COUNT(*) AS n FROM readings WHERE sensor_id=? AND value=?').get('s3', 43).n;
    assert.equal(n, 0);
  });
});

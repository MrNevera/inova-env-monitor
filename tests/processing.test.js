import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectAnomalies,
  detectSpikes,
  aggregate,
  trend,
  processSensor,
} from '../processing.js';

test('detectAnomalies flags a clear outlier', () => {
  const flagged = detectAnomalies([10, 10, 10, 10, 10, 10, 10, 100]);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].index, 7);
  assert.equal(flagged[0].value, 100);
});

test('detectAnomalies flags nothing on uniform data', () => {
  const flagged = detectAnomalies([10, 10, 10, 10, 10]);
  assert.equal(flagged.length, 0);
});

test('detectAnomalies returns empty for fewer than 5 points', () => {
  assert.equal(detectAnomalies([1, 2, 3, 4]).length, 0);
  assert.equal(detectAnomalies([]).length, 0);
});

test('detectSpikes flags a +50% jump after 10 stable points', () => {
  const values = [...Array(10).fill(10), 15];
  const flagged = detectSpikes(values, 10, 0.35);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].index, 10);
  assert.equal(flagged[0].value, 15);
  assert.equal(flagged[0].median, 10);
});

test('detectSpikes does not flag below-threshold pct', () => {
  const values = [...Array(10).fill(10), 13];
  const flagged = detectSpikes(values, 10, 0.35);
  assert.equal(flagged.length, 0);
});

test('aggregate returns avg/min/max/count on a small array', () => {
  const a = aggregate([1, 2, 3, 4, 5]);
  assert.deepEqual(a, { avg: 3, min: 1, max: 5, count: 5 });
});

test('aggregate returns null on empty array', () => {
  assert.equal(aggregate([]), null);
});

test('trend returns up/down/stable on constructed sequences', () => {
  assert.equal(trend([1, 2, 3, 4, 5, 6]), 'up');
  assert.equal(trend([6, 5, 4, 3, 2, 1]), 'down');
  assert.equal(trend([10, 10, 10, 10, 10, 10]), 'stable');
});

test('processSensor returns documented shape', () => {
  const readings = [
    { value: 10, recorded_at: '2026-01-01T00:00:00Z' },
    { value: 20, recorded_at: '2026-01-01T00:01:00Z' },
    { value: 30, recorded_at: '2026-01-01T00:02:00Z' },
    { value: 40, recorded_at: '2026-01-01T00:03:00Z' },
    { value: 50, recorded_at: '2026-01-01T00:04:00Z' },
  ];
  const sensor = { id: 's1', name: 'CO2', zone: 'A', type: 'air', unit: 'ppm', threshold: 45 };
  const res = processSensor(sensor, readings);

  assert.equal(res.sensorId, 's1');
  assert.equal(res.sensorName, 'CO2');
  assert.equal(res.zone, 'A');
  assert.equal(res.type, 'air');
  assert.equal(res.unit, 'ppm');
  assert.deepEqual(res.window, { from: '2026-01-01T00:00:00Z', to: '2026-01-01T00:04:00Z', count: 5 });
  assert.deepEqual(res.aggregate, { avg: 30, min: 10, max: 50, count: 5 });
  assert.equal(typeof res.trend, 'string');
  assert.ok(Array.isArray(res.anomalies));
  assert.ok(Array.isArray(res.spikes));
  assert.equal(typeof res.thresholdBreaches, 'number');
  assert.equal(typeof res.severity, 'string');
  assert.equal(typeof res.processedAt, 'number');
});

test('processSensor severity=warn when thresholdBreaches>0', () => {
  const readings = [...Array(5).fill(0)].map((_, i) => ({ value: 50 + i * 10, recorded_at: `2026-01-01T00:0${i}:00Z` }));
  const sensor = { id: 's1', name: 'CO2', zone: 'A', type: 'air', unit: 'ppm', threshold: 45 };
  const res = processSensor(sensor, readings);
  assert.ok(res.thresholdBreaches > 0);
  assert.equal(res.severity, 'warn');
});

test('processSensor severity=ok when nothing breaches', () => {
  const readings = [...Array(6).fill(0)].map((_, i) => ({ value: 10 + i, recorded_at: `2026-01-01T00:0${i}:00Z` }));
  const sensor = { id: 's1', name: 'CO2', zone: 'A', type: 'air', unit: 'ppm', threshold: 1000 };
  const res = processSensor(sensor, readings);
  assert.equal(res.thresholdBreaches, 0);
  assert.equal(res.severity, 'ok');
});

// processing.js — OBRADA PODATAKA (akcent projekta)
// Runs on every reading batch: aggregates, anomaly detection, threshold alerts.
// Pure functions — easy to unit test.

/**
 * Rolling z-score anomaly detection on a window of values.
 * Returns array of {index, value, z} for points flagged |z| > threshold.
 */
export function detectAnomalies(values, threshold = 2.5) {
  const n = values.length;
  if (n < 5) return [];
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 1;
  const flagged = [];
  for (let i = 0; i < n; i++) {
    const z = (values[i] - mean) / sd;
    if (Math.abs(z) > threshold) flagged.push({ index: i, value: values[i], z: +z.toFixed(2) });
  }
  return flagged;
}

/**
 * Spike detection: a point jumps > pct% above the running median of the last k points.
 */
export function detectSpikes(values, k = 10, pct = 0.35) {
  const flagged = [];
  for (let i = k; i < values.length; i++) {
    const window = values.slice(i - k, i);
    const sorted = [...window].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median > 0 && (values[i] - median) / median > pct) {
      flagged.push({ index: i, value: values[i], median, pct: +(((values[i] - median) / median) * 100).toFixed(1) });
    }
  }
  return flagged;
}

/**
 * Aggregate a window of readings into {avg,min,max,count}.
 */
export function aggregate(values) {
  if (!values.length) return null;
  let min = Infinity, max = -Infinity, sum = 0;
  for (const v of values) { if (v < min) min = v; if (v > max) max = v; sum += v; }
  return { avg: +(sum / values.length).toFixed(3), min: +min.toFixed(3), max: +max.toFixed(3), count: values.length };
}

/**
 * Trend direction over last N points: 'up' | 'down' | 'stable'.
 */
export function trend(values, stableBand = 0.02) {
  if (values.length < 3) return 'stable';
  const n = values.length;
  const first = values.slice(0, Math.floor(n / 2)).reduce((a, b) => a + b, 0) / Math.floor(n / 2);
  const last = values.slice(Math.floor(n / 2)).reduce((a, b) => a + b, 0) / (n - Math.floor(n / 2));
  const delta = (last - first) / (first || 1);
  if (delta > stableBand) return 'up';
  if (delta < -stableBand) return 'down';
  return 'stable';
}

/**
 * Full processing run for a sensor over a time window.
 * Returns structured result — the "obrada podataka" the professor wants to see.
 */
export function processSensor(sensor, readings, opts = {}) {
  const values = readings.map(r => r.value);
  const agg = aggregate(values);
  const anomalies = detectAnomalies(values, opts.zThreshold ?? 2.5);
  const spikes = detectSpikes(values, opts.spikeK ?? 10, opts.spikePct ?? 0.35);
  const tr = trend(values);
  const thresholdBreaches = sensor.threshold > 0
    ? values.filter(v => v > sensor.threshold).length
    : 0;

  return {
    sensorId: sensor.id,
    sensorName: sensor.name,
    zone: sensor.zone,
    type: sensor.type,
    unit: sensor.unit,
    window: { from: readings[0]?.recorded_at ?? null, to: readings[readings.length - 1]?.recorded_at ?? null, count: readings.length },
    aggregate: agg,
    trend: tr,
    anomalies: anomalies.map(a => ({ value: a.value, z: a.z, at: readings[a.index]?.recorded_at ?? null })),
    spikes: spikes.map(s => ({ value: s.value, median: s.median, pct: s.pct, at: readings[s.index]?.recorded_at ?? null })),
    thresholdBreaches,
    severity: thresholdBreaches > 0 || anomalies.length > 0 || spikes.length > 0 ? 'warn' : 'ok',
    processedAt: Date.now()
  };
}
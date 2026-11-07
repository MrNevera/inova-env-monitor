import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { initSchema, upsertSensor, insertReading, insertAlert, audit, kpiSnapshot, allSensors, recentAlerts, readingsWindow, sensorById, transaction } from './db.js';
import { seedSensors, nextReading } from './simulator.js';
import { processSensor } from './processing.js';
import { exportReportCsv } from './scripts/export-report.js';

initSchema();
const sensors = seedSensors();

const app = express();

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use(express.json());
app.use(express.static('.')); // serves dashboard.html

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === 1) c.send(data);
}

// --- REST API ---
app.get('/api/sensors', (_req, res) => res.json(allSensors()));

app.get('/api/kpi', (_req, res) => {
  const snap = kpiSnapshot();
  res.json(snap.map(s => ({
    id: s.sensor.id, name: s.sensor.name, zone: s.sensor.zone, type: s.sensor.type,
    unit: s.sensor.unit, value: s.value, at: s.at, threshold: s.sensor.threshold,
    above: s.above, severity: s.above ? 'warn' : 'ok'
  })));
});

app.post('/api/readings', (req, res) => {
  const { sensorId, value, recordedAt } = req.body || {};
  if (!sensorId || typeof value !== 'number') return res.status(400).json({ error: 'sensorId + numeric value required' });
  const s = allSensors().find(x => x.id === sensorId);
  if (!s) return res.status(404).json({ error: 'sensor not found' });
  const at = recordedAt ?? Date.now();
  insertReading(sensorId, value, at);
  audit('reading', sensorId, 'ingest', `value=${value}`);
  // threshold check
  if (s.threshold > 0 && value > s.threshold) {
    insertAlert({ sensorId, type: 'threshold', severity: value > s.threshold * 1.2 ? 'critical' : 'warn',
      message: `${s.name} ${s.type} above threshold (${value} > ${s.threshold})`,
      value, threshold: s.threshold, created_at: Date.now() });
    broadcast({ type: 'alert', sensorId, value, threshold: s.threshold });
  }
  broadcast({ type: 'reading', sensorId, value, at });
  res.json({ ok: true });
});

app.post('/api/import/csv', (req, res) => {
  const { csv } = req.body || {};
  if (typeof csv !== 'string') return res.status(400).json({ error: 'csv string required' });

  const lines = csv.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return res.status(400).json({ error: 'csv must have header + rows' });

  const header = lines[0].split(',').map(h => h.trim());
  const si = header.indexOf('sensor_id');
  const vi = header.indexOf('value');
  const ri = header.indexOf('recorded_at');
  if (si < 0 || vi < 0) return res.status(400).json({ error: 'csv header must include sensor_id,value' });

  let inserted = 0, skipped = 0;
  const errors = [];

  const insert = transaction(() => {
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      try {
        const sensorId = cols[si];
        if (!sensorId) throw new Error('missing sensor_id');
        if (!sensorById(sensorId)) throw new Error(`sensor ${sensorId} not found`);
        const value = Number(cols[vi]);
        if (!Number.isFinite(value)) throw new Error('invalid value');
        const recordedAt = ri >= 0 ? Number(cols[ri]) : Date.now();
        if (!Number.isFinite(recordedAt)) throw new Error('invalid recorded_at');
        insertReading(sensorId, value, recordedAt);
        audit('reading', sensorId, 'csv-import', `value=${value}`);
        inserted++;
      } catch (e) {
        skipped++;
        errors.push({ row: i, error: e.message });
      }
    }
  });
  insert();

  res.json({ ok: true, inserted, skipped, errors });
});

app.get('/api/readings/:sensorId', (req, res) => {
  const from = Number(req.query.from) || Date.now() - 86400000;
  const to = Number(req.query.to) || Date.now();
  res.json(readingsWindow(req.params.sensorId, from, to));
});

app.get('/api/alerts', (_req, res) => res.json(recentAlerts()));

app.get('/api/process/:sensorId', (req, res) => {
  const s = allSensors().find(x => x.id === req.params.sensorId);
  if (!s) return res.status(404).json({ error: 'sensor not found' });
  const from = Number(req.query.from) || Date.now() - 3600000;
  const to = Number(req.query.to) || Date.now();
  const rows = readingsWindow(req.params.sensorId, from, to);
  res.json(processSensor(s, rows, { zThreshold: 2.5, spikePct: 0.35 }));
});

app.get('/api/process-all', (_req, res) => {
  const from = Date.now() - 3600000;
  const to = Date.now();
  const out = allSensors().map(s => processSensor(s, readingsWindow(s.id, from, to)));
  res.json(out);
});

app.get('/api/report/:sensorId', (req, res) => {
  const sensor = allSensors().find(s => s.id === req.params.sensorId);
  if (!sensor) return res.status(404).json({ error: 'sensor not found' });
  const from = Number(req.query.from) || Date.now() - 86400000;
  const to = Number(req.query.to) || Date.now();
  const csv = exportReportCsv(req.params.sensorId, from, to);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="report_${req.params.sensorId}_${from}_${to}.csv"`);
  res.status(200).send(csv);
});

// --- WebSocket: live broadcast + simulator tick ---
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'hello', sensors: allSensors().length }));
});

setInterval(() => {
  for (const s of sensors) {
    const r = nextReading(s);
    insertReading(s.id, r.value, r.recordedAt);
    // threshold check
    const cfg = s._cfg;
    if (cfg.threshold > 0 && r.value > cfg.threshold) {
      insertAlert({ sensorId: s.id, type: 'threshold', severity: r.value > cfg.threshold * 1.2 ? 'critical' : 'warn',
        message: `${s.name} ${s.type} above threshold (${r.value} > ${cfg.threshold})`,
        value: r.value, threshold: cfg.threshold, created_at: Date.now() });
      broadcast({ type: 'alert', sensorId: s.id, value: r.value, threshold: cfg.threshold });
    }
    broadcast({ type: 'reading', sensorId: s.id, value: r.value, at: r.recordedAt });
  }
}, 2000);

const PORT = Number(process.env.PORT ?? 3000);
httpServer.listen(PORT, () => {
  console.log(`EnvMonitor running on http://localhost:${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/index.html`);
});
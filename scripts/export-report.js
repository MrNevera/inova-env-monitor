import { readingsWindow, aggregateWindow } from '../db.js';

// Generate a CSV report for one sensor over [from, to].
// Columns: sensorId,value,recordedAt,rowType  (rowType = reading | aggregate)
export function exportReportCsv(sensorId, from, to) {
  const rows = readingsWindow(sensorId, from, to);

  const lines = ['sensorId,value,recordedAt,rowType'];
  for (const r of rows) {
    lines.push(`${sensorId},${r.value},${r.recorded_at},reading`);
  }
  if (rows.length) {
    const agg = aggregateWindow(sensorId, 'custom', from, to);
    lines.push(`${sensorId},${agg.avg},${from},aggregate`);
  }
  return lines.join('\n') + '\n';
}

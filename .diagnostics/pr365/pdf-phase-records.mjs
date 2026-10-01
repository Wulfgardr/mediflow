// Closed, bounded diagnostic data. Never forward child-controlled unknown fields.
const fields = ['cpuSystemUs', 'cpuUserUs', 'elapsedMs', 'phase', 'probe', 'rssBytes'];
const approvedPhases = new Set(['preload-enter', 'stdout-write', 'process-exit']);
for (const prefix of ['worker-source', 'pdfjs-source', 'canvas-source', 'canvas-native-init',
  ...['readFileSync', 'realpathSync', 'lstatSync'].flatMap((key) => [`native-file-${key}`, `profiles-${key}`])]) {
  for (const suffix of ['enter', 'exit', 'throw']) approvedPhases.add(`${prefix}-${suffix}`);
}
for (const prefix of ['system-fonts', 'user-fonts', 'canvas-context', 'png-encode']) {
  for (const suffix of ['enter', 'exit', 'throw', 'instrumentation-unavailable']) approvedPhases.add(`${prefix}-${suffix}`);
}
const integerWithin = (value, maximum) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;
export function parsePhaseStderr(stderr) {
  const reject = () => ({ phases: [], nonProbeStderr: true });
  if (!Buffer.isBuffer(stderr) || stderr.byteLength > 64 * 1024) return reject();
  if (stderr.byteLength === 0) return { phases: [], nonProbeStderr: false };
  const text = stderr.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(stderr)) return reject();
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
  if (lines.length > 48) return reject();
  const phases = [];
  for (const line of lines) {
    if (Buffer.byteLength(line) > 512 || !line) return reject();
    let value;
    try { value = JSON.parse(line); } catch { return reject(); }
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== fields.join(',')
      || value.probe !== 'pdf-phase-v1' || !approvedPhases.has(value.phase)
      || !integerWithin(value.elapsedMs, 60_000)
      || !integerWithin(value.cpuUserUs, 4_000_000_000)
      || !integerWithin(value.cpuSystemUs, 4_000_000_000)
      || !integerWithin(value.rssBytes, 64 * 1024 ** 3)) return reject();
    phases.push({ probe: 'pdf-phase-v1', phase: value.phase, elapsedMs: value.elapsedMs,
      cpuUserUs: value.cpuUserUs, cpuSystemUs: value.cpuSystemUs, rssBytes: value.rssBytes });
  }
  return { phases, nonProbeStderr: false };
}
export function probeExitCode(baselineFailure, diagnosticSucceeded) {
  return baselineFailure !== null || diagnosticSucceeded !== true ? 1 : 0;
}

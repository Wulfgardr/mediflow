// External, synthetic-only diagnostic probe. Never used by a smoke acceptance gate.
import fs, { writeSync } from 'node:fs';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { performance } from 'node:perf_hooks';

function observe(callback) {
  try { return callback(); } catch { return undefined; }
}
const started = observe(() => performance.now()) ?? 0;
const cpuStarted = observe(() => process.cpuUsage());
let count = 0;
const seen = new Set();
function mark(phase) {
  observe(() => {
  if (count >= 48) return;
  count += 1;
  const cpu = process.cpuUsage(cpuStarted);
  writeSync(2, JSON.stringify({ probe: 'pdf-phase-v1', phase,
    elapsedMs: Math.round(performance.now() - started),
    cpuUserUs: cpu.user, cpuSystemUs: cpu.system,
    rssBytes: process.memoryUsage.rss() }) + '\n');
  });
}
function once(phase) {
  observe(() => {
  if (seen.has(phase)) return;
  seen.add(phase);
  mark(phase);
  });
}
function wrap(target, key, phase) {
  observe(() => {
  const descriptor = target && Object.getOwnPropertyDescriptor(target, key);
  if (!descriptor || typeof descriptor.value !== 'function' || !descriptor.writable) {
    once(`${phase}-instrumentation-unavailable`);
    return;
  }
  const original = descriptor.value;
  Object.defineProperty(target, key, { ...descriptor, value: function (...args) {
    once(`${phase}-enter`);
    try {
      const result = Reflect.apply(original, this, args);
      once(`${phase}-exit`);
      return result;
    } catch (error) {
      once(`${phase}-throw`);
      throw error;
    }
  } });
  });
}

mark('preload-enter');
for (const key of ['readFileSync', 'realpathSync', 'lstatSync']) {
  observe(() => {
  const original = fs[key];
  fs[key] = function (...args) {
    const phase = observe(() => {
    const input = args[0];
    const value = typeof input === 'string' ? input : input instanceof URL ? input.pathname : '';
    return /[\\/]skia\.[^\\/]+\.node$/.test(value) ? `native-file-${key}`
      : value.endsWith('/anydoc-pdf-renderer-profiles.json')
        || value.endsWith('\\anydoc-pdf-renderer-profiles.json') ? `profiles-${key}` : null;
    });
    if (phase) once(`${phase}-enter`);
    try {
      const result = Reflect.apply(original, this, args);
      if (phase) once(`${phase}-exit`);
      return result;
    } catch (error) {
      if (phase) once(`${phase}-throw`);
      throw error;
    }
  };
  });
}
observe(() => syncBuiltinESMExports());
observe(() => registerHooks({
  load(url, context, nextLoad) {
    const phase = observe(() => url.endsWith('/anydoc-pdf-page-worker.mjs') ? 'worker-source'
      : url.endsWith('/pdfjs-dist/legacy/build/pdf.mjs') ? 'pdfjs-source'
        : url.endsWith('/@napi-rs/canvas/index.js') ? 'canvas-source' : null);
    if (phase) once(`${phase}-enter`);
    const result = nextLoad(url, context);
    if (phase) once(`${phase}-exit`);
    return result;
  },
}));
observe(() => {
const originalDlopen = process.dlopen;
process.dlopen = function (...args) {
  const isCanvas = typeof args[1] === 'string' && /[\\/]skia\.[^\\/]+\.node$/.test(args[1]);
  if (isCanvas) once('canvas-native-init-enter');
  let result;
  try { result = Reflect.apply(originalDlopen, this, args); }
  catch (error) {
    if (isCanvas) once('canvas-native-init-throw');
    throw error;
  }
  if (isCanvas) {
    once('canvas-native-init-exit');
    observe(() => {
    const exports = args[0]?.exports;
    wrap(exports?.GlobalFonts, 'loadSystemFonts', 'system-fonts');
    wrap(exports?.GlobalFonts, 'loadFontsFromDir', 'user-fonts');
    wrap(exports?.CanvasElement?.prototype, 'getContext', 'canvas-context');
    wrap(exports?.CanvasElement?.prototype, 'toBuffer', 'png-encode');
    });
  }
  return result;
};
});
observe(() => {
const originalWrite = process.stdout.write;
process.stdout.write = function (...args) {
  once('stdout-write');
  return Reflect.apply(originalWrite, this, args);
};
});
observe(() => process.once('exit', () => once('process-exit')));

const { AsyncLocalStorage } = require('node:async_hooks');
const { Server } = require('node:http');
const { createRequire } = require('node:module');
const path = require('node:path');

const context = new AsyncLocalStorage();
const Database = createRequire(path.resolve('server.js'))('better-sqlite3');
const calibration = new Database(':memory:');
const statement = Object.getPrototypeOf(calibration.prepare('SELECT 1'));
calibration.close();
for (const method of ['all', 'get']) {
  const original = statement[method];
  statement[method] = function (...args) {
    const sample = context.getStore();
    if (!sample) return original.apply(this, args);
    const start = performance.now();
    try {
      return original.apply(this, args);
    } finally {
      sample.sqliteCalls++;
      sample.sqliteMs += performance.now() - start;
    }
  };
}

const emit = Server.prototype.emit;
Server.prototype.emit = function (event, ...args) {
  if (event !== 'request') return emit.call(this, event, ...args);
  const [request, response] = args;
  const url = new URL(request.url, 'http://127.0.0.1');
  const isRsc = url.searchParams.has('_rsc') || request.headers.rsc === '1';
  if (request.method !== 'GET' || !(isRsc || url.pathname.startsWith('/api/'))) return emit.call(this, event, ...args);
  const start = performance.now();
  const sample = {
    path: url.pathname.replace(/\/patients\/[^/]+/, '/patients/:id'),
    isRsc,
    prefetch: Boolean(request.headers['next-router-prefetch'] || request.headers['next-router-segment-prefetch']),
    timestamp: performance.timeOrigin + start,
    sqliteMs: 0,
    sqliteCalls: 0,
  };
  response.once('finish', () => {
    process.send?.({ ...sample, status: response.statusCode, ms: performance.now() - start });
  });
  return context.run(sample, () => emit.call(this, event, ...args));
};

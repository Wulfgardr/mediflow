const { AsyncLocalStorage } = require('node:async_hooks');
const { readdirSync } = require('node:fs');
const { Server } = require('node:http');
const { createRequire } = require('node:module');
const path = require('node:path');

const context = new AsyncLocalStorage();
const loadBundleModule = createRequire(path.resolve('server.js'));
const aliasDir = path.resolve(process.env.MEDIFLOW_NEXT_DIST_DIR, 'node_modules');
let aliases = [];
try {
  aliases = readdirSync(aliasDir)
    .filter(name => /^better-sqlite3-[a-f0-9]{16}$/u.test(name))
    .map(name => path.join(aliasDir, name));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const packages = ['better-sqlite3', ...aliases];
const statementPrototypes = new Set();
for (const name of packages) {
  const Database = loadBundleModule(name);
  const calibration = new Database(':memory:');
  statementPrototypes.add(Object.getPrototypeOf(calibration.prepare('SELECT 1')));
  calibration.close();
}
for (const statement of statementPrototypes) for (const method of ['all', 'get']) {
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

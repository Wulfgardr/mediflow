import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

try {
  if (!process.connected || typeof process.send !== 'function' || process.argv.length !== 3) {
    throw new Error('headless_web_parent_required');
  }
  process.once('disconnect', () => process.exit(1));
  const target = process.argv[2];
  if (!path.isAbsolute(target) || fs.realpathSync(target) !== target || path.basename(target) !== 'server.js') {
    throw new Error('headless_web_target_invalid');
  }
  const dir = path.dirname(target);
  const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const { distDir } = readJson(path.join(dir, 'mediflow-runtime-contract.json'));
  if (typeof distDir !== 'string' || (!/^[a-zA-Z0-9_.-]+$/u.test(distDir) || distDir === '.' || distDir === '..')) {
    throw new Error('headless_web_dist_invalid');
  }
  const { config } = readJson(path.join(dir, distDir, 'required-server-files.json'));
  const nextConfig = { ...config, distDir: `./${distDir}` };
  process.env.NODE_ENV = 'production';
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig);
  process.chdir(dir);
  const require = createRequire(target);
  require('next');
  const { startServer } = require('next/dist/server/lib/start-server');
  await startServer({ dir, isDev: false, config: nextConfig,
    hostname: '127.0.0.1', port: 0, allowRetry: false });
  const port = Number(process.env.PORT);
  if (!process.connected || !Number.isSafeInteger(port) || port < 1 || port > 65535
    || process.env.__NEXT_PRIVATE_ORIGIN !== `http://127.0.0.1:${port}`) {
    throw new Error('headless_web_address_invalid');
  }
  process.stderr.write(`MEDIFLOW_HEADLESS_WEB_READY ${JSON.stringify({ url: process.env.__NEXT_PRIVATE_ORIGIN })}\n`);
} catch {
  process.stderr.write('MediFlow headless Web failed closed.\n');
  process.exit(1);
}

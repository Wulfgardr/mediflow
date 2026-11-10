import fs from 'node:fs';
import path from 'node:path';

// Turbopack's route traces can omit a generated SSR chunk. Check the packaged
// closure against the build output before accepting a standalone distribution.
export function assertStandaloneSsrChunks(buildDirectory, packagedBuildDirectory) {
  const source = path.join(buildDirectory, 'server', 'chunks', 'ssr');
  if (!fs.existsSync(source)) return; // Webpack does not use this directory.
  const target = path.join(packagedBuildDirectory, 'server', 'chunks', 'ssr');
  for (const relative of fs.readdirSync(source, { recursive: true })) {
    if (!relative.endsWith('.js')) continue;
    const original = path.join(source, relative);
    if (!fs.statSync(original).isFile()) continue;
    const packaged = path.join(target, relative);
    if (!fs.existsSync(packaged) || !fs.statSync(packaged).isFile()) {
      throw new Error(`Standalone SSR chunk missing: ${relative}`);
    }
    if (!fs.readFileSync(original).equals(fs.readFileSync(packaged))) {
      throw new Error(`Standalone SSR chunk differs from build: ${relative}`);
    }
  }
}

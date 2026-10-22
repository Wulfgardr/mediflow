import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { referenceDirectory } from './reference-location.mjs';
await build({ entryPoints: [new URL('../test/card-reference-entry.mjs', import.meta.url).pathname], bundle: true,
  format: 'esm', target: 'es2022', outfile: path.join(referenceDirectory, 'dist/card-entry.js'),
  alias: { 'ext-apps-reference-implementation': path.join(referenceDirectory, 'src/implementation.ts') } });
await writeFile(path.join(referenceDirectory, 'dist/card.html'), '<!doctype html><html><head><title>MCP Apps reference · explicit app entrypoint</title><style>body{margin:0}iframe{display:block;width:100%;height:720px;border:0}</style></head><body><iframe title="Scheda sintetica"></iframe><script type="module" src="card-entry.js"></script></body></html>');

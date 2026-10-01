import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const result = await build({ entryPoints: [new URL('src/app.mjs', root).pathname],
  bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', minify: true });
const source = await readFile(new URL('src/app.html', root), 'utf8');
const script = result.outputFiles[0].text.replace(/<\/script/giu, '<\\/script');
await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/app.html', root), source.replace('<!-- APP_SCRIPT -->', () => `<script>${script}</script>`));

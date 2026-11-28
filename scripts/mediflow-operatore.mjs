#!/usr/bin/env node
import { mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export async function bundleOperatore(outfile) {
    await build({
        entryPoints: [path.join(ROOT, 'tools/operatore/main.ts')], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node24',
        tsconfig: path.join(ROOT, 'tsconfig.json'), logLevel: 'error', sourcemap: false,
        banner: { js: "import { createRequire as __mfRequire } from 'node:module'; const require = __mfRequire(import.meta.url);" },
    });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const cartella = path.join(os.tmpdir(), `mediflow-operatore-${process.getuid?.() ?? 'utente'}`);
    mkdirSync(cartella, { recursive: true, mode: 0o700 });
    const outfile = path.join(cartella, `operatore-${process.pid}.mjs`);
    process.env.MEDIFLOW_OPERATORE_INSTALLAZIONE ||= ROOT;
    try {
        await bundleOperatore(outfile);
        await import(pathToFileURL(outfile).href);
    } finally {
        rmSync(outfile, { force: true });
    }
}

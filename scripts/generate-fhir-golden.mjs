#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const runner = join(here, 'run-strip-types.mjs');
const worker = join(here, 'generate-fhir-golden-worker.ts');

const result = spawnSync(process.execPath, [runner, worker], {
    cwd: join(here, '..'),
    stdio: 'inherit',
    env: process.env,
});

process.exit(result.status ?? 1);

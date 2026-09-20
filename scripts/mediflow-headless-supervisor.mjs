#!/usr/bin/env node
/* @Codex */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertNodeRuntime,
  readNodeContract,
  verifyNativeBinding,
} from './node-runtime-contract.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

function prepareDataDirectory() {
  const fallback = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'MediFlow')
    : path.join(os.homedir(), '.mediflow');
  const configured = process.env.MEDIFLOW_DATA_DIR || fallback;
  if (!path.isAbsolute(configured)) throw new Error('MEDIFLOW_DATA_DIR must be absolute.');
  if (fs.existsSync(configured)) {
    const stat = fs.lstatSync(configured);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('MEDIFLOW_DATA_DIR is not canonical.');
  } else fs.mkdirSync(configured, { recursive: true });
  const canonical = fs.realpathSync(configured);
  process.env.MEDIFLOW_DATA_DIR = canonical;
}

// @Codex: trusted bundle composition supplies only its physical Web layout; no CLI/env override.
export async function runHeadlessSupervisorV1(childOptions = {}) {
  const args = process.argv.slice(2);
  if (args.length > 0 && !(args.length === 1 && args[0] === '--mini')) {
    throw new Error('supervisor_arguments_invalid');
  }
  const agentKind = args[0] === '--mini' ? 'mini' : 'mcp';
  assertNodeRuntime(readNodeContract(root));
  verifyNativeBinding(root);
  prepareDataDirectory();

  // Any parent-process diagnostics must share stderr; stdout belongs exclusively to the selected agent protocol.
  console.log = console.error.bind(console);
  console.info = console.error.bind(console);
  const { createPortableSupervisorProductionV1 } =
    await import('../lib/security/portable-supervisor-production.ts');
  const supervisor = createPortableSupervisorProductionV1(agentKind, childOptions);
  const onSignal = () => { supervisor.terminate('restart'); };
  for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) process.once(signal, onSignal);
  try { await supervisor.closed; }
  finally {
    for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) process.off(signal, onSignal);
  }
}

if (process.argv[1] && fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runHeadlessSupervisorV1(); }
  catch {
    process.stderr.write('MediFlow production Supervisor failed closed.\n');
    process.exitCode = 1;
  }
}

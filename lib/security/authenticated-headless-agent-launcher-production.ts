/* @Codex */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { types } from 'node:util';

import type { SemanticQueryOperationTerminalAuditCommitV1 } from
  '../../packages/aip/src/semantic-query-operation-contract.ts';
import {
  AuthenticatedAgentLauncherV1Error, createAuthenticatedAgentLauncherV1,
} from '../headless/authenticated-agent-launcher.ts';
import { createLateBoundMcpChildPortV1 } from './authenticated-headless-agent-pre-spawned-mcp-child.ts';
import { createPatientOpenLoopsReadInternalCandidateV1 } from './patient-open-loops-read-production.ts';

export { createLateBoundMcpChildPortV1 } from './authenticated-headless-agent-pre-spawned-mcp-child.ts';

const REQUIRED_SOURCE_KEYS = ['readHostContext', 'writeAudit', 'commitTerminalAudit'] as const;
const OPTIONAL_SOURCE_KEY = 'previewCheckupStatus' as const;
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const LOADER = `${ROOT}/scripts/register-strip-types-loader.mjs`;
const TARGETS = Object.freeze({
  mcp: `${ROOT}/scripts/intelligent-host-mcp-stdio.mjs`,
  mini: `${ROOT}/packages/mini/src/cli.ts`,
});

type Sources = Readonly<{ readHostContext: () => unknown; writeAudit: (value: unknown) => unknown;
  commitTerminalAudit: SemanticQueryOperationTerminalAuditCommitV1;
  previewCheckupStatus?: (value: unknown, signal: AbortSignal) => Promise<unknown> }>;
type SpawnChild = (environment: Readonly<Record<string, string>>) => unknown;

function sources(value: unknown): Sources {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) throw new Error('input_invalid');
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
  const ownKeys = Reflect.ownKeys(value);
  if ((ownKeys.length !== REQUIRED_SOURCE_KEYS.length && ownKeys.length !== REQUIRED_SOURCE_KEYS.length + 1)
    || ownKeys.some((key) => typeof key !== 'string'
      || !([...REQUIRED_SOURCE_KEYS, OPTIONAL_SOURCE_KEY] as string[]).includes(key))
    || REQUIRED_SOURCE_KEYS.some((key) =>
    !descriptors[key]?.enumerable || !('value' in descriptors[key]) || typeof descriptors[key].value !== 'function'
    || types.isProxy(descriptors[key].value)
    || (key === 'commitTerminalAudit' && types.isAsyncFunction(descriptors[key].value)))
    || (descriptors[OPTIONAL_SOURCE_KEY]
      && (typeof descriptors[OPTIONAL_SOURCE_KEY].value !== 'function'
        || types.isProxy(descriptors[OPTIONAL_SOURCE_KEY].value)))) throw new Error('input_invalid');
  return value as Sources;
}

function childPort(target: string, environment: Readonly<Record<string, string>>) {
  const child: ChildProcess = spawn(process.execPath,
    ['--experimental-strip-types', '--import', LOADER, target], {
      cwd: ROOT, env: { ...environment } as NodeJS.ProcessEnv, stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });
  const connection = Object.freeze(Object.create(null)) as object;
  return {
    connection,
    subscribe: (listener: (frame: unknown) => void) => {
      child.on('message', listener); return () => child.off('message', listener);
    },
    publish: (frame: string) => {
      if (!child.connected) throw new Error('child_disconnected');
      child.send(frame);
    },
    onClose: (listener: () => void) => {
      child.once('exit', listener); child.once('error', listener);
      return () => { child.off('exit', listener); child.off('error', listener); };
    },
    terminate: () => {
      if (child.connected) child.disconnect();
      if (child.exitCode === null && child.signalCode === null) child.kill();
    },
  };
}

function createProductionLauncher(
  kind: keyof typeof TARGETS, sourcesValue: unknown, spawnChildOverride?: SpawnChild,
) {
  const ports = sources(sourcesValue);
  return createAuthenticatedAgentLauncherV1({
    now: () => Date.now(),
    nextRef: (referenceKind: string) => referenceKind === 'bootstrap'
      ? `aipb_${randomBytes(16).toString('hex')}`
      : referenceKind === 'follow_up_proposal'
        ? `aipfp_${randomBytes(32).toString('hex')}`
        : referenceKind === 'follow_up_proposal_receipt'
          ? `aipfr_${randomBytes(32).toString('hex')}`
          : `${referenceKind.replaceAll('_', '.')}.${randomBytes(24).toString('hex')}`,
    hashRef: (value: string) => `sha256:${createHash('sha256')
      .update('mediflow.headless.authenticated-launcher.v1').update('\0').update(value).digest('hex')}`,
    writeAudit: ports.writeAudit,
    commitTerminalAudit: ports.commitTerminalAudit,
    readHostContext: ports.readHostContext,
    spawnChild: spawnChildOverride
      ?? ((environment: Readonly<Record<string, string>>) => childPort(TARGETS[kind], environment)),
    createOpenLoopsRead: createPatientOpenLoopsReadInternalCandidateV1,
    previewCheckupStatus: ports.previewCheckupStatus
      ?? (async () => { throw new AuthenticatedAgentLauncherV1Error('operation_unavailable'); }),
  });
}

export function createProductionMcpAgentLauncherV1(sourcesValue: unknown) {
  return createProductionLauncher('mcp', sourcesValue);
}

export function createProductionMiniAgentLauncherV1(sourcesValue: unknown) {
  return createProductionLauncher('mini', sourcesValue);
}

export function createProductionMcpAgentLauncherWithPreSpawnedChildV1(
  sourcesValue: unknown, childPortValue: unknown,
) {
  let claimed = false;
  return createProductionLauncher('mcp', sourcesValue, (environment) => {
    if (claimed) throw new AuthenticatedAgentLauncherV1Error('child_unavailable');
    claimed = true;
    return createLateBoundMcpChildPortV1(childPortValue, environment);
  });
}

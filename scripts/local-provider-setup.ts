/* @Codex: privileged host composition; never import from a web route or consumer. */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createLocalProviderBindingReader, HOST_LOCAL_PROVIDER_SETTING_KEYS } from '../lib/ai-providers/local-provider-binding-reader';
import { attestLocalOllamaModel } from '../lib/ai-providers/ollama-locality';
import { createHostProviderLifecycleService } from '../lib/ai-providers/fabric/provider-lifecycle-service';
import { advanceOnboarding, startOnboarding } from '../lib/ai-providers/fabric/onboarding';

type Action = 'inspect' | 'admit' | 'recover' | 'revoke';
type Command = Readonly<{ action: Action; dataDir: string; confirmed: boolean }>;
export class LocalProviderSetupError extends Error {
    constructor(public readonly code: string) { super(code); this.name = 'LocalProviderSetupError'; }
}
function deny(code: string): never { throw new LocalProviderSetupError(code); }

export function parseLocalProviderSetupArgs(args: string[]): Command {
    const [action, flag, dataDir, confirmation, ...extra] = args;
    if (!['inspect', 'admit', 'recover', 'revoke'].includes(action) || flag !== '--data-dir'
        || !dataDir || !path.isAbsolute(dataDir) || extra.length
        || (confirmation !== undefined && confirmation !== '--confirm-local-change')) deny('arguments_invalid');
    if (action !== 'inspect' && confirmation !== '--confirm-local-change') deny('confirmation_required');
    return Object.freeze({ action: action as Action, dataDir, confirmed: confirmation === '--confirm-local-change' });
}

function readBinding(dataDir: string) {
    return createLocalProviderBindingReader({ readSettings: async () => {
        const db = new Database(path.join(dataDir, 'medical.db'), { readonly: true, fileMustExist: true });
        try {
            const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN (${HOST_LOCAL_PROVIDER_SETTING_KEYS.map(() => '?').join(',')})`)
                .all(...HOST_LOCAL_PROVIDER_SETTING_KEYS) as { key: string; value: string }[];
            return Object.fromEntries(rows.map(row => [row.key, row.value]));
        } finally { db.close(); }
    } }).readClinical();
}

/** Test injection stays on this host module; the executable uses the production attestor. */
export async function runLocalProviderSetup(command: Command, attest: typeof attestLocalOllamaModel = attestLocalOllamaModel) {
    if (!['inspect', 'admit', 'recover', 'revoke'].includes(command.action) || !path.isAbsolute(command.dataDir)) deny('arguments_invalid');
    if (command.action !== 'inspect' && command.confirmed !== true) deny('confirmation_required');
    try {
        if (!fs.statSync(command.dataDir).isDirectory() || !fs.statSync(path.join(command.dataDir, 'medical.db')).isFile()) deny('data_directory_invalid');
    } catch { deny('data_directory_invalid'); }
    const boundary = createHostProviderLifecycleService({ appDataDir: command.dataDir, provider: 'ollama' });
    const lifecycle = boundary.service.read();
    const state = lifecycle.status === 'available' ? lifecycle.record.lifecycle.status : lifecycle.reason;
    const version = lifecycle.status === 'available' ? lifecycle.record.version : 0;
    const result = (outcome: string, model: string | null, checkedAt: string | null = null) => Object.freeze({
        schemaVersion: 'mediflow.local-provider-setup.v1', outcome, provider: 'ollama', model,
        lifecycle: state, lifecycleVersion: version, checkedAt, inference: 'not_run', capabilityQualification: 'not_assessed',
    });
    if (command.action === 'inspect') {
        const binding = await readBinding(command.dataDir);
        return result(binding.status === 'available' ? 'configuration_read' : binding.code,
            binding.status === 'available' ? binding.resolution.receipt.model : null);
    }
    if (lifecycle.status === 'denied' && lifecycle.reason !== 'missing') deny(`lifecycle_${lifecycle.reason}`);
    if (state === 'revoked') {
        if (command.action === 'revoke') return result('unchanged', null);
        deny('lifecycle_revoked');
    }
    if (command.action === 'revoke') {
        if (lifecycle.status !== 'available') deny('lifecycle_missing');
        const record = boundary.control.revoke({ expectedVersion: version });
        return { ...result('revoked', null), lifecycle: record.lifecycle.status, lifecycleVersion: record.version };
    }
    if (command.action === 'admit' && state !== 'missing' && state !== 'available_unqualified') deny('use_recover');
    if (command.action === 'recover' && state !== 'degraded' && state !== 'available_unqualified') deny('use_admit');
    const binding = await readBinding(command.dataDir);
    if (binding.status !== 'available') deny(binding.code);
    const model = binding.resolution.receipt.model;
    const endpoint = binding.resolution.adapter.getBaseUrl();
    let checkedAt: string;
    try {
        const observation = await attest(endpoint, model, AbortSignal.timeout(30_000));
        checkedAt = observation.checkedAt;
    } catch { deny('local_attestation_failed'); }
    const current = await readBinding(command.dataDir);
    if (current.status !== 'available' || current.resolution.receipt.model !== model
        || current.resolution.adapter.getBaseUrl() !== endpoint) deny('binding_changed');
    // Idempotence never revives a concurrent revocation or hides a lifecycle change.
    const latest = boundary.service.read();
    if ((latest.status === 'available' ? latest.record.version : 0) !== version
        || (latest.status === 'available' ? latest.record.lifecycle.status : latest.reason) !== state) deny('lifecycle_changed');
    if (state === 'available_unqualified') return result('unchanged', model, checkedAt);
    let onboarding = startOnboarding('ollama', 'local_model');
    for (const type of ['configure', 'credential_declared', 'attest_local', 'enable'] as const) onboarding = advanceOnboarding(onboarding, { type });
    const record = command.action === 'admit'
        ? boundary.control.admit({ expectedVersion: version, onboarding })
        : boundary.control.recover({ expectedVersion: version });
    return { ...result(command.action === 'admit' ? 'admitted' : 'recovered', model, checkedAt),
        lifecycle: record.lifecycle.status, lifecycleVersion: record.version };
}

/* @Codex */
import 'server-only';
import { createHash } from 'node:crypto';
import { createLocalProviderBindingReader, HOST_LOCAL_PROVIDER_SETTING_KEYS,
    type HostLocalProviderSettingsSnapshot } from '../local-provider-binding-reader';
import { attestLocalOllamaModel, OllamaLocalityError, strictOllamaLoopbackBaseUrl } from '../ollama-locality';
import { createHostProviderLifecycleService } from './provider-lifecycle-service';
import { ProviderLifecycleStoreError } from './provider-lifecycle-store';
import { startOnboarding, advanceOnboarding } from './onboarding';
import * as owner from '../../security/web-auth-lifecycle-owner-adapter';

export class LocalProviderOnboardingError extends Error {
    constructor(public readonly code: string) { super(code); this.name = 'LocalProviderOnboardingError'; }
}
function deny(code: string): never { throw new LocalProviderOnboardingError(code); }
type Sources = Readonly<{
    appDataDir: string;
    readSettings(): HostLocalProviderSettingsSnapshot;
    immediate<T>(operation: () => T): T;
    authenticate(): Promise<owner.WebSessionProjection | null>;
    attest?: typeof attestLocalOllamaModel;
}>;
export type LocalProviderOnboardingStatus = Readonly<{
    provider: 'ollama'; credentialClass: 'local_model'; model: string | null;
    state: string; revision: string; version: number; receipt: string | null;
    canActivate: boolean; inference: 'not_run'; qualification: 'not_assessed';
}>;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Host composition seam only. No source, authority or target comes from the HTTP body. */
export function createLocalProviderOnboardingService(sources: Sources) {
    const lifecycle = createHostProviderLifecycleService({ appDataDir: sources.appDataDir, provider: 'ollama' });
    function snapshot() {
        const settings = sources.readSettings();
        const record = lifecycle.service.read();
        const state = record.status === 'available'
            ? record.record.lifecycle.status === 'revoked' ? 'revoked'
                : record.record.lifecycle.credentialClass !== 'local_model' ? 'credential_mismatch' : record.record.lifecycle.status
            : record.reason;
        const version = record.status === 'available' ? record.record.version : 0;
        const settingsDigest = digest(HOST_LOCAL_PROVIDER_SETTING_KEYS.map(key => [key, settings[key] ?? null]));
        // No implicit provider, model or URL default may authorize onboarding.
        const configured = settings.aiProvider === 'ollama'
            && Boolean(settings.aiModel_clinical?.trim() || settings.aiModel?.trim())
            && Boolean(settings.aiUrl?.trim() || settings.ollamaUrl?.trim());
        let localEndpoint = false;
        try {
            const url = new URL(strictOllamaLoopbackBaseUrl(settings.aiUrl?.trim() || settings.ollamaUrl?.trim() || ''));
            localEndpoint = url.port === '11434';
        } catch { /* Invalid configuration stays visible without contacting it. */ }
        const status: LocalProviderOnboardingStatus = Object.freeze({
            provider: 'ollama', credentialClass: 'local_model',
            model: configured ? (settings.aiModel_clinical?.trim() || settings.aiModel?.trim() || null) : null,
            state: state === 'revoked' ? state : !configured ? 'configuration_missing' : !localEndpoint ? 'locality_denied' : state,
            revision: digest([settingsDigest, state, version]), version,
            receipt: record.status === 'available' ? record.record.receiptRef : null,
            canActivate: configured && localEndpoint && ['missing', 'degraded', 'available_unqualified'].includes(state),
            inference: 'not_run', qualification: 'not_assessed',
        });
        return { settings, status, state };
    }
    async function session() {
        const current = await sources.authenticate();
        if (!current || current.authChannel !== 'web') deny('owner_locked');
        return current;
    }
    return Object.freeze({
        async inspect() {
            const current = await session();
            const port = owner.mintResourcePort(current);
            if (!port) deny('owner_locked');
            try {
                const use = owner.beginResourceUse(port);
                if (!use) deny('owner_locked');
                try {
                    const result = snapshot().status;
                    if (!owner.commitResourceUse(use)) deny('owner_locked');
                    return result;
                } finally { owner.abortResourceUse(use); }
            } finally { owner.releaseResourcePort(port); }
        },
        async activate(expectedRevision: string) {
            if (!/^[a-f0-9]{64}$/.test(expectedRevision)) deny('input_invalid');
            const current = await session();
            const port = owner.mintResourcePort(current);
            if (!port) deny('owner_locked');
            const use = owner.beginResourceUse(port);
            if (!use) { owner.releaseResourcePort(port); deny('owner_locked'); }
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30_000);
            let retired = false;
            const registration = owner.registerPrivateResource(port, () => { retired = true; controller.abort(); });
            try {
                if (!registration) deny('owner_locked');
                const initial = snapshot();
                if (initial.state === 'revoked') deny('revoked');
                if (initial.status.revision !== expectedRevision) deny('configuration_changed');
                if (!initial.status.canActivate) deny(initial.status.state);
                const binding = await createLocalProviderBindingReader({ readSettings: async () => initial.settings }).readClinical();
                if (binding.status !== 'available') deny(binding.code);
                if (binding.resolution.receipt.model !== initial.status.model) deny('configuration_missing');
                if (controller.signal.aborted) deny(retired ? 'owner_locked' : 'verification_interrupted');
                try {
                    await Promise.race([
                        (sources.attest ?? attestLocalOllamaModel)(binding.resolution.adapter.getBaseUrl(),
                            binding.resolution.receipt.model, controller.signal),
                        new Promise<never>((_, reject) => {
                            controller.signal.addEventListener('abort', () => reject(new LocalProviderOnboardingError('verification_interrupted')), { once: true });
                        }),
                    ]);
                } catch (error) {
                    if (controller.signal.aborted) deny(retired ? 'owner_locked' : 'verification_interrupted');
                    if (error instanceof OllamaLocalityError) {
                        if (error.code === 'model_not_local') deny('model_absent_or_not_local');
                        if (error.code === 'endpoint_not_loopback' || error.code === 'model_cloud_reference') deny('locality_denied');
                    }
                    deny('provider_unreachable');
                }
                const latestSession = await session();
                // The canonical resolver emits a fresh projection on each read. These values
                // check continuity; authority remains the original owner-bound resource use.
                if (latestSession.id !== current.id || latestSession.userId !== current.userId
                    || latestSession.role !== current.role) deny('owner_locked');
                if (controller.signal.aborted) deny(retired ? 'owner_locked' : 'verification_interrupted');
                return sources.immediate(() => {
                    const latest = snapshot();
                    if (latest.state === 'revoked') deny('revoked');
                    if (latest.status.revision !== expectedRevision) deny('configuration_changed');
                    if (!owner.commitResourceUse(use)) deny('owner_locked');
                    // Synchronous host-owned section: no await between authority and lifecycle CAS.
                    if (latest.state !== 'available_unqualified') {
                        let onboarding = startOnboarding('ollama', 'local_model');
                        for (const type of ['configure', 'credential_declared', 'attest_local', 'enable'] as const)
                            onboarding = advanceOnboarding(onboarding, { type });
                        if (latest.state === 'missing') lifecycle.control.admit({ expectedVersion: latest.status.version, onboarding });
                        else lifecycle.control.recover({ expectedVersion: latest.status.version });
                    }
                    return snapshot().status;
                });
            } catch (error) {
                if (error instanceof LocalProviderOnboardingError) throw error;
                if (error instanceof ProviderLifecycleStoreError)
                    deny(error.code === 'busy' ? 'provider_busy' : 'configuration_changed');
                deny('state_unavailable');
            } finally {
                clearTimeout(timeout);
                owner.abortResourceUse(use);
                if (registration) owner.unregisterPrivateResource(port, registration);
                owner.releaseResourcePort(port);
            }
        },
    });
}

/** Lazy production root keeps imports from opening any database in fixture composition. */
export async function getLocalProviderOnboardingService() {
    const [{ dbServer, runDbServerImmediateTransaction }, { settings }, { inArray }, { getDataDir }, { requireSession }] = await Promise.all([
        import('../../db-server'), import('../../schema'), import('drizzle-orm'),
        import('../../data-dir'), import('../../security/server-auth'),
    ]);
    return createLocalProviderOnboardingService({ appDataDir: getDataDir(), authenticate: requireSession,
        immediate: runDbServerImmediateTransaction,
        readSettings() {
            const rows = dbServer.select({ key: settings.key, value: settings.value }).from(settings)
                .where(inArray(settings.key, [...HOST_LOCAL_PROVIDER_SETTING_KEYS])).all();
            return Object.fromEntries(rows.map(row => [row.key, row.value]));
        },
    });
}

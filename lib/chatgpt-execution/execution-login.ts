/* @Codex — source candidate; gated by exact protocol/config/OS qualification. */
import 'server-only';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { ExecutionError, type ExecutionTransport } from './execution-contract';
import { EXECUTION_CONFIG, EXECUTION_SUBSTRATE } from './execution-sandbox';
import { MAC_CONFIG_SOURCE } from './execution-mac-config';
import { ProductError, type ProductLoginChallenge, type ProductLimits } from '../chatgpt-product/product-contract';

const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ExecutionError('protocol_error');
    return value as Record<string, unknown>;
};
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/u.test(value);

/** Attached C1 regeneration metadata, NOT an OS witness or authentic readback.
 * JSON schema hashes are over exact bytes, not canonicalized JSON. Offline
 * qualification-tools verify them against the supplied receipt and files.
 */
export const EXECUTION_PROTOCOL_PROVENANCE = Object.freeze({
    binaryVersion: '0.153.4',
    binarySha256: 'a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629',
    c1ReceiptSha256: '2b07b00c3f0473acf5caafb706e07265db55c189e61e14259800e628e1d205ae',
    claim: 'attached_current_schema_regeneration_only',
    configInputSchema: MAC_CONFIG_SOURCE, binaryBuildBinding: 'unqualified', normalizedReadback: 'not_observed',
    schemas: Object.freeze({
        "v1/InitializeParams.json": "6f0094be9a65242ec779a40794cbd4fdfa32fca1e45084a16adfb50501d33ea2",
        "v1/InitializeResponse.json": "62ad689c2cb6379913c1d72749cfd8de5089d35760214123518eb92eef11acc9",
        "v2/AccountLoginCompletedNotification.json": "d81e8821fd5a4a9ad118dfc3506ea156d32dcb18da388b336501bbc6a5ccb4a6",
        "v2/ConfigReadParams.json": "257c54a423b47c1d209ff1076765a1564d82322fd5161670fd489a2874de1bac",
        "v2/ConfigReadResponse.json": "96a04a3f7fff2dc7fafc9f831e8bcd422e021d697dd2c14c801f098a9f21396d",
        "v2/GetAccountResponse.json": "08a7dd8c570c905b0bb6998d43ed133e72e2445f08125f86dfc96887e288701a",
        "v2/LoginAccountParams.json": "48fb9bea54d7e0890052653ac06737efb3200ba2261515b2c4014027f36bea3d",
        "v2/LoginAccountResponse.json": "72e6d77f49bc5809c3af50f183e2a0862dd8f7836816d4796ff69bb13eae0e89"
}),
} as const);

/** Shared request shape, not an observation. */
export function executionInitializationParams() {
    return { clientInfo: { name: 'mediflow_synthetic_product', title: 'MediFlow synthetic synthesis', version: '0.8.6' }, capabilities: { experimentalApi: true } };
}

/** Existing, pinned execution-host layout; no filesystem discovery or env read. */
export function expectedExecutionEnvironment(executionCwd: string) {
    if (!text(executionCwd, 4096) || !isAbsolute(executionCwd) || normalize(executionCwd) !== executionCwd
        || join(dirname(executionCwd), 'work') !== executionCwd) throw new ExecutionError('unqualified_boundary');
    const platformOs = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : process.platform === 'linux' ? 'linux' : null;
    if (!platformOs) throw new ExecutionError('unqualified_boundary');
    return Object.freeze({ codexHome: join(dirname(executionCwd), 'codex'), platformOs, platformFamily: process.platform === 'win32' ? 'windows' : 'unix' });
}
export function assertInitialized(raw: unknown, executionCwd: string): void {
    const response = object(raw), expected = expectedExecutionEnvironment(executionCwd);
    if (EXECUTION_SUBSTRATE.codexVersion !== EXECUTION_PROTOCOL_PROVENANCE.binaryVersion
        || EXECUTION_SUBSTRATE.codexSha256 !== EXECUTION_PROTOCOL_PROVENANCE.binarySha256
        || Object.keys(response).some(key => !['userAgent', 'codexHome', 'platformOs', 'platformFamily'].includes(key))
        || !text(response.userAgent, 1024)
        || !response.userAgent.split(/[^0-9A-Za-z.-]+/u).includes(EXECUTION_PROTOCOL_PROVENANCE.binaryVersion)
        || response.codexHome !== expected.codexHome || response.platformOs !== expected.platformOs
        || response.platformFamily !== expected.platformFamily) throw new ExecutionError('unqualified_boundary');
}

/** All fixed config expectations derive from the attached TOML, not invented keys. */
export function expectedExecutionConfig(): Readonly<Record<string, unknown>> {
    const root: Record<string, unknown> = {}; let section = root;
    for (const line of EXECUTION_CONFIG.split('\n').map(line => line.trim()).filter(Boolean)) {
        if (line.startsWith('[')) {
            section = root;
            for (const part of line.slice(1, -1).split('.')) section = (section[part] ??= {}) as Record<string, unknown>;
        } else {
            const index = line.indexOf(' = ');
            if (index < 1) throw new ExecutionError('unqualified_boundary');
            section[line.slice(0, index)] = JSON.parse(line.slice(index + 3));
        }
    }
    return root;
}
/**
 * Requires every restrictive setting to be observable; absence is NOT a default.
 * Exact public config schema/readback must be qualified before this can run live.
 */
export function assertExecutionConfig(raw: unknown): void {
    const response = object(raw);
    // Exact ConfigReadResponse envelope. includeLayers:false never licenses
    // ingesting layers or ambient origin mappings whose provenance is unknown.
    if (Object.keys(response).some(key => !['config', 'origins', 'layers'].includes(key))
        || !Object.hasOwn(response, 'origins') || Object.keys(object(response.origins)).length !== 0
        || (Object.hasOwn(response, 'layers') && response.layers !== null)) throw new ExecutionError('unqualified_boundary');
    const config = object(response.config), expected = expectedExecutionConfig();
    // These FOUR declarations are in the pinned RPC Config schema. They are
    // optional; string|null is NOT object|null. Null supplies no instruction;
    // provider is also imposed as openai by the downstream thread contract.
    // Unknown roots (including empty MCP/provider/plugin/hook maps) and the
    // thirteen C2 roots remain denied: schema-nullable is not runtime-neutral.
    const noInstructionOverrides = ['instructions', 'developer_instructions', 'compact_prompt'] as const;
    const optionalSchemaRoots = new Set<string>(['model_provider', ...noInstructionOverrides]);
    function exact(actual: Record<string, unknown>, required: Record<string, unknown>, root = false) {
        for (const key of Object.keys(actual)) {
            if (!Object.hasOwn(required, key) && !(root && optionalSchemaRoots.has(key))) throw new ExecutionError('unqualified_boundary');
        }
        for (const [key, value] of Object.entries(required)) {
            if (!Object.hasOwn(actual, key)) throw new ExecutionError('unqualified_boundary');
            if (value && typeof value === 'object') exact(object(actual[key]), value as Record<string, unknown>);
            else if (actual[key] !== value) throw new ExecutionError('unqualified_boundary');
        }
    }
    exact(config, expected, true);
    for (const key of noInstructionOverrides) {
        if (Object.hasOwn(config, key) && config[key] !== null) throw new ExecutionError('unqualified_boundary');
    }
    if (Object.hasOwn(config, 'model_provider') && config.model_provider !== null && config.model_provider !== 'openai') throw new ExecutionError('unqualified_boundary');
}
export function readExecutionLimits(raw: unknown): ProductLimits {
    const response = object(raw);
    const candidate = response.rateLimitsByLimitId == null ? response.rateLimits : object(response.rateLimitsByLimitId).codex;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new ExecutionError('limits_unavailable');
    const bucket = object(candidate);
    if (bucket.rateLimitReachedType != null || bucket.spendControlReached === true) throw new ExecutionError('quota_exhausted');
    const read = (rawWindow: unknown): number | null => {
        if (rawWindow == null) return null;
        const used = object(rawWindow).usedPercent;
        if (typeof used !== 'number' || !Number.isFinite(used) || used < 0) throw new ExecutionError('limits_unavailable');
        if (used >= 100) throw new ExecutionError('quota_exhausted');
        return used;
    };
    const primaryUsedPercent = read(bucket.primary), secondaryUsedPercent = read(bucket.secondary);
    if (primaryUsedPercent === null && secondaryUsedPercent === null) throw new ExecutionError('limits_unavailable');
    return Object.freeze({ primaryUsedPercent, secondaryUsedPercent });
}

export function createExecutionLogin(transport: ExecutionTransport, guard: () => void, changed: (state: 'verifying') => void, fail: (error: ProductError | ExecutionError) => void, executionCwd: string) {
    let loginId: string | undefined;
    let starting = false, acceptingEarlyCompletion = false, matched = false, retired = false;
    let early: Record<string, unknown> | undefined;
    let fingerprint: string | undefined;
    let plan: 'plus' | 'pro' | undefined;
    const check = () => { guard(); if (retired) throw new ProductError('revoked'); };
    async function rpc(method: Parameters<ExecutionTransport['request']>[0], params?: unknown) {
        check(); const response = await transport.request(method, params); check(); return response;
    }
    function completion(raw: unknown) {
        const notice = object(raw);
        if (typeof notice.success !== 'boolean' || !text(notice.loginId, 200) || (notice.error != null && typeof notice.error !== 'string')) throw new ExecutionError('protocol_error');
        if (!loginId) {
            if (!acceptingEarlyCompletion || early) throw new ExecutionError('protocol_error');
            early = notice; return;
        }
        if (notice.loginId !== loginId || matched) throw new ExecutionError('protocol_error');
        if (!notice.success || notice.error != null) throw new ProductError('login_failed');
        matched = true; changed('verifying');
    }
    const unsubscribe = transport.subscribe((method, raw) => {
        if (retired || method !== 'account/login/completed') return;
        try { check(); completion(raw); } catch (error) {
            // A malformed/foreign/duplicate completion invalidates this login even
            // if the injected failure observer cannot synchronously dispose it.
            retired = true; matched = false; early = undefined;
            fail(error instanceof ProductError || error instanceof ExecutionError ? error : new ExecutionError('protocol_error'));
        }
    }, code => { if (!retired) { retired = true; matched = false; early = undefined; fail(new ExecutionError(code)); } });
    async function account(requireEmpty: boolean) {
        const response = object(await rpc('account/read', { refreshToken: false }));
        if (typeof response.requiresOpenaiAuth !== 'boolean') throw new ExecutionError('protocol_error');
        if (requireEmpty) {
            if (response.account !== null) throw new ExecutionError('unqualified_boundary');
            return;
        }
        if (response.account == null) throw new ExecutionError('not_connected');
        const value = object(response.account);
        if (value.type !== 'chatgpt' || (value.planType !== 'plus' && value.planType !== 'pro') || !text(value.email, 320) || !/^[^\s@]+@[^\s@]+$/u.test(value.email)) throw new ExecutionError('unsupported_account');
        const current = createHash('sha256').update(JSON.stringify([value.email, value.planType])).digest('hex');
        if (fingerprint && fingerprint !== current) throw new ExecutionError('revoked');
        fingerprint = current; plan = value.planType;
    }
    return Object.freeze({
        async start(): Promise<ProductLoginChallenge> {
            if (starting || loginId) throw new ProductError('invalid_state');
            starting = true;
            // Validate our host layout before the first RPC, not a personal HOME.
            expectedExecutionEnvironment(executionCwd);
            // A prepared Mac host reuses its OWN actual initialization once,
            // not a second initialize RPC or a fabricated config response.
            check();
            const prepared = transport.takeInitializationObservation;
            const initialized = prepared ? prepared() : await rpc('initialize', executionInitializationParams());
            assertInitialized(initialized, executionCwd);
            check(); if (!prepared) transport.initialized(); check();
            assertExecutionConfig(await rpc('config/read', { includeLayers: false }));
            await account(true);
            let response: Record<string, unknown>;
            acceptingEarlyCompletion = true;
            try { response = object(await rpc('account/login/start', { type: 'chatgptDeviceCode' })); }
            finally { acceptingEarlyCompletion = false; }
            if (response.type !== 'chatgptDeviceCode' || !text(response.loginId, 200) || !text(response.userCode, 64)
                || !/^[A-Za-z0-9-]+$/u.test(response.userCode) || !text(response.verificationUrl, 2048)) throw new ExecutionError('protocol_error');
            let url: URL;
            try { url = new URL(response.verificationUrl); } catch { throw new ExecutionError('protocol_error'); }
            if (url.protocol !== 'https:' || url.hostname !== 'auth.openai.com' || url.port || url.username || url.password || url.hash) throw new ExecutionError('protocol_error');
            loginId = response.loginId;
            if (early) { const pending = early; early = undefined; completion(pending); }
            check();
            return Object.freeze({ verificationUrl: url.href, userCode: response.userCode });
        },
        async complete(): Promise<'plus' | 'pro'> {
            check(); if (!matched) throw new ProductError('login_pending');
            assertExecutionConfig(await rpc('config/read', { includeLayers: false }));
            await account(false); check(); return plan!;
        },
        async read(): Promise<'plus' | 'pro'> {
            check(); if (!fingerprint || !matched) throw new ProductError('invalid_state');
            await account(false); check(); return plan!;
        },
        /** Called only during an owner-authorized cleanup, never after retirement. */
        async cancel(): Promise<void> {
            check(); if (loginId) await rpc('account/login/cancel', { loginId });
        },
        dispose() { retired = true; matched = false; acceptingEarlyCompletion = false; unsubscribe(); early = undefined; loginId = undefined; fingerprint = undefined; plan = undefined; },
    });
}

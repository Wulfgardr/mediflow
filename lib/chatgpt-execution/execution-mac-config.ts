/* @Codex — fixed source provenance and structural projection validation, never an issuer. */
import 'server-only';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize } from 'node:path';
import { EXECUTION_CONFIG, EXECUTION_SUBSTRATE } from './execution-sandbox';
import { ExecutionError } from './execution-contract';

export const MAC_CONTEXT_SHA256 = '25374bcdc057575c57018f3379e2d3e9245e0258ea3fad679f85f6716548dc00';
export const MAC_POLICY_REVISION = 'mac-nofork-custodian-v1';
export const MAC_CONFIG_SOURCE = Object.freeze({
    schema: 'mediflow.config-input-source.v1', state: 'input_schema_source_available',
    commit: '3d2ee51ca2d5db578f328aa75e20aa22c0197c9a',
    url: 'https://raw.githubusercontent.com/openai/codex/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/config.schema.json',
    bytes: 200401, sha256: '692da7699367f6f4fbbd46c0021278c1311440bcebf0bcb9b836690c05e56196',
    receipt: Object.freeze({ bytes: 572, sha256: '216fc490e6b2df23e01dbc729da65651d6622ab8a272d4feafc2685064448584' }),
    loader: Object.freeze({ bytes: 76594, sha256: '6fc44b60c64065994c9aa18df248eb521dba6b0e9917a8cf69fc60e0035ac56a',
        url: 'https://raw.githubusercontent.com/openai/codex/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/config/src/loader/mod.rs',
        receiptBytes: 415, receiptSha256: 'e2f902e74eae01e297466be3d0a49110e82b219b797ae255cdd4e97b96085ca2' }),
    binaryBuildBinding: 'unqualified', runtimeReadback: 'not_observed',
} as const);
export const MAC_C1_RECEIPT = Object.freeze({ bytes: 8330,
    sha256: '2b07b00c3f0473acf5caafb706e07265db55c189e61e14259800e628e1d205ae' });
export const macDigest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
export function readPinnedMacFile(path: string, pin: Readonly<{ bytes: number; sha256: string }>): Buffer {
    try {
        const before = lstatSync(path);
        if (!before.isFile() || before.isSymbolicLink() || before.size !== pin.bytes) throw new Error();
        const bytes = readFileSync(path), after = lstatSync(path);
        if (after.dev !== before.dev || after.ino !== before.ino || after.ctimeMs !== before.ctimeMs
            || bytes.length !== pin.bytes || macDigest(bytes) !== pin.sha256) throw new Error();
        return bytes;
    } catch { throw new ExecutionError('unqualified_boundary'); }
}

type RecordValue = Record<string, unknown>;
const rec = (value: unknown): RecordValue => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ExecutionError('unqualified_boundary');
    return value as RecordValue;
};
/** Small validator for the fixed ConfigToml projection, NOT a general JSON-schema
 * library or a normalizer. No runtime permissions derive from source properties.
 * Unsupported validation constructs on a consumed node fail closed. */
export function assertMacInputProjection(schemaBytes: Buffer, projection: unknown): void {
    if (schemaBytes.length !== MAC_CONFIG_SOURCE.bytes || macDigest(schemaBytes) !== MAC_CONFIG_SOURCE.sha256)
        throw new ExecutionError('unqualified_boundary');
    const schema = rec(JSON.parse(schemaBytes.toString('utf8')));
    function accepts(node: unknown, value: unknown, depth = 0): boolean {
        if (depth > 32 || node === false) return false;
        if (node === true) return true;
        const rule = rec(node);
        // These constructs do not occur on the admitted projection. Do not silently
        // ignore future constraints if a reviewed source pin is later changed.
        for (const key of ['not', 'if', 'then', 'else', 'patternProperties', 'dependencies', 'dependentSchemas', 'contains', 'unevaluatedProperties'])
            if (Object.hasOwn(rule, key)) return false;
        if (typeof rule.$ref === 'string') {
            const prefix = '#/definitions/';
            if (!rule.$ref.startsWith(prefix)) return false;
            const target = rec(schema.definitions)[rule.$ref.slice(prefix.length)];
            if (!target || !accepts(target, value, depth + 1)) return false;
        }
        for (const op of ['allOf', 'anyOf', 'oneOf'] as const) if (rule[op]) {
            if (!Array.isArray(rule[op])) return false;
            const count = rule[op].filter(n => accepts(n, value, depth + 1)).length;
            if (op === 'allOf' ? count !== rule[op].length : op === 'oneOf' ? count !== 1 : count < 1) return false;
        }
        if (Array.isArray(rule.enum) && !rule.enum.some(v => JSON.stringify(v) === JSON.stringify(value))) return false;
        if (Object.hasOwn(rule, 'const') && JSON.stringify(rule.const) !== JSON.stringify(value)) return false;
        const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
        if (rule.type) {
            const types = Array.isArray(rule.type) ? rule.type : [rule.type];
            if (!types.some(t => t === actual || t === 'integer' && typeof value === 'number' && Number.isSafeInteger(value))) return false;
        }
        if (typeof value === 'number') {
            if (!Number.isFinite(value) || typeof rule.minimum === 'number' && value < rule.minimum
                || typeof rule.maximum === 'number' && value > rule.maximum) return false;
        }
        if (typeof value === 'string') {
            if (typeof rule.minLength === 'number' && value.length < rule.minLength
                || typeof rule.maxLength === 'number' && value.length > rule.maxLength
                || typeof rule.pattern === 'string' && !new RegExp(rule.pattern, 'u').test(value)) return false;
        }
        if (Array.isArray(value)) return false; // The fixed input contains no arrays.
        if (actual === 'object') {
            const object = rec(value), properties = rule.properties ? rec(rule.properties) : {};
            if (Array.isArray(rule.required) && rule.required.some(k => typeof k !== 'string' || !Object.hasOwn(object, k))) return false;
            for (const [key, v] of Object.entries(object)) {
                if (Object.hasOwn(properties, key)) { if (!accepts(properties[key], v, depth + 1)) return false; }
                else if (rule.additionalProperties === false) return false;
                else if (rule.additionalProperties && typeof rule.additionalProperties === 'object'
                    && !accepts(rule.additionalProperties, v, depth + 1)) return false;
                else if (!Object.hasOwn(rule, '$ref') && !rule.allOf && !rule.anyOf && !rule.oneOf && !rule.additionalProperties) return false;
            }
        }
        return true;
    }
    if (!accepts(schema, projection)) throw new ExecutionError('unqualified_boundary');
}
export function verifyMacSourceSet(directory: string, c1ReceiptPath: string, projection: unknown) {
    const schema = readPinnedMacFile(join(directory, 'config.schema.json'), MAC_CONFIG_SOURCE);
    readPinnedMacFile(join(directory, 'RECEIPT.json'), MAC_CONFIG_SOURCE.receipt);
    readPinnedMacFile(join(directory, 'config-loader-mod.rs'), MAC_CONFIG_SOURCE.loader);
    readPinnedMacFile(join(directory, 'LOADER-RECEIPT.json'), {
        bytes: MAC_CONFIG_SOURCE.loader.receiptBytes, sha256: MAC_CONFIG_SOURCE.loader.receiptSha256 });
    const c1 = rec(JSON.parse(readPinnedMacFile(c1ReceiptPath, MAC_C1_RECEIPT).toString('utf8')));
    assertMacInputProjection(schema, projection);
    const comparison = c1.comparison;
    if (!Array.isArray(comparison) || comparison.length !== 24) throw new ExecutionError('unqualified_boundary');
    const pins = comparison.map(raw => {
        const value = rec(raw);
        if (typeof value.path !== 'string' || !/^v[12]\/[A-Za-z]+\.json$/u.test(value.path)
            || typeof value.expected_sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.expected_sha256)) throw new ExecutionError('unqualified_boundary');
        return Object.freeze({ path: value.path, sha256: value.expected_sha256 });
    });
    if (new Set(pins.map(pin => pin.path)).size !== pins.length) throw new ExecutionError('unqualified_boundary');
    return Object.freeze(pins);
}

/** Reviewed compatibility contract, NOT a source-build proof or an authority.
 * Sources are the attached rust-v0.153.4 files at this exact commit. In particular
 * config_manager_service.rs:113-175 reloads ConfigToml, applies requirements and
 * projects it through ApiConfig. Packaged defaults are OMITTED from provenance.
 * Never describe this RPC as direct observation of every resolved tool setting.
 */
export const MAC_READBACK_SOURCE = Object.freeze({
    revision: 'mac-config-read-layered-v1',
    commit: '3d2ee51ca2d5db578f328aa75e20aa22c0197c9a',
    binaryVersion: '0.153.4',
    binarySha256: 'b973d440acac501fd2594a43e7ca9ce41e0a65b9dfb28d0d7a7837c99e1261e3',
    configManagerSha256: '239eac692e3d1839105345708f61f8dc4b7056fcd41c2de1ee25f568210921dc',
    configTomlSha256: '5ff36c12287c453d9421483c62da3377bd3fb9bc7de80defb80e215e0ccf3633',
    apiConfigSha256: '5907ff78f46c5ffe4ae8eb252e9f3e304fda72bfa04b0cee360436e75eaaa0ac',
    resolverSha256: 'b3eb0a9751522f7f6f7a7bd1b21253f2fcb4e669955819bfb6d0a7425e1fed9e',
    featuresSha256: 'b7ef7bb1bb5517a82ae7c7294f2d7a072cb00f151a3d8f5025aa2e967b036937',
    typesSha256: 'c5a81049a05861c6a8a4ca7384f410ebcd4438e3712d31a32a32f888e1bb1a7a',
    omittedTools: 'source_resolver_binding_not_direct_tool_observation',
    packagedDefaults: 'not_exposed_by_readback',
} as const);

/** Parse only the host's fixed literal, never a file, response or caller input.
 * The same input is independently schema-checked by verifyMacSourceSet. This
 * intentionally small grammar must fail if the fixed TOML grows new constructs.
 */
function macReadbackInput(): RecordValue {
    const root: RecordValue = {}; let section = root;
    for (const line of EXECUTION_CONFIG.split('\n').map(value => value.trim()).filter(Boolean)) {
        const table = /^\[([a-z_]+(?:\.[a-z_]+)*)\]$/u.exec(line);
        if (table) {
            section = root;
            for (const part of table[1].split('.')) section = rec(section[part] ??= {});
        } else {
            const field = /^([a-z_][a-z0-9_]*) = (true|false|0|"[^"\\\r\n]*")$/u.exec(line);
            if (!field || Object.hasOwn(section, field[1])) throw new ExecutionError('unqualified_boundary');
            section[field[1]] = JSON.parse(field[2]);
        }
    }
    return root;
}

// Every permitted null is NAMED; absence, {} and null are not interchangeable.
// ConfigToml:158-526 (Option<T>, no skip-serialization) and ApiConfig:277-312.
// These denote no override on the wire, NOT absence of a runtime capability.
const MAC_NULL_READBACK_ROOTS = Object.freeze([
    'model', 'review_model', 'model_context_window', 'model_auto_compact_token_limit',
    'model_auto_compact_token_limit_scope', 'model_provider', 'sandbox_workspace_write',
    'forced_chatgpt_workspace_id', 'instructions', 'developer_instructions', 'compact_prompt',
    'model_reasoning_effort', 'model_verbosity', 'service_tier', 'browser_use', 'computer_use',
    'desktop', 'hooks', 'mcp_oauth_callback_url', 'otel', 'windows', 'experimental_compact_prompt_file',
    'mcp_optional_startup_grace_ms', 'experimental_realtime_webrtc_call_base_url', 'personality',
    'disable_paste_burst', 'ghost_snapshot', 'notice', 'tool_output_token_limit', 'profile',
    'openai_base_url', 'sqlite_home', 'tool_suggest', 'permissions', 'goals', 'auto_review',
    'experimental_realtime_ws_startup_context', 'experimental_realtime_ws_backend_prompt',
    'apps_mcp_product_sku', 'notify', 'oss_provider', 'model_catalog_json', 'experimental_thread_store',
    'model_instructions_file', 'realtime', 'plan_mode_reasoning_effort', 'memories', 'orchestrator',
    'js_repl_node_module_dirs', 'experimental_realtime_ws_model', 'skills',
    'experimental_use_unified_exec_tool', 'suppress_unstable_features_warning', 'default_permissions',
    'experimental_realtime_ws_base_url', 'js_repl_node_path', 'mcp_oauth_callback_port', 'tui',
    'responses_api_metadata', 'projects', 'experimental_thread_store_endpoint', 'audio',
    'experimental_realtime_start_instructions', 'log_dir',
] as const);

function macTypedReadback(input: RecordValue): RecordValue {
    const expected: RecordValue = { ...input };
    for (const name of MAC_NULL_READBACK_ROOTS) {
        if (Object.hasOwn(expected, name)) throw new ExecutionError('unqualified_boundary');
        expected[name] = null;
    }
    // ConfigToml default maps, all closed here. No provider, profile, project,
    // plugin, marketplace or MCP entry is admitted by being an "empty object".
    for (const name of ['model_providers', 'mcp_servers', 'profiles', 'plugins', 'marketplaces']) expected[name] = {};
    // Default-equivalent values: core/config/mod.rs:3812-3815,3900-3903,
    // 4244,4261-4263; config_toml.rs:83-85,318-320,479-483; types.rs:124-136.
    // Non-null packaged values are allowed ONLY at these exact values, not by
    // unseen packaged-layer provenance. No grant is inferred from these defaults.
    Object.assign(expected, {
        chatgpt_base_url: 'https://chatgpt.com/backend-api/', file_opener: 'vscode',
        background_terminal_max_timeout: 300000, include_collaboration_mode_instructions: true,
        include_apps_instructions: true, include_permissions_instructions: true,
        project_doc_fallback_filenames: [], project_root_markers: ['.git'], mcp_oauth_credentials_store: 'auto',
    });
    // API ToolsV2:159-161 drops BOTH supported input fields (ToolsToml:612-635).
    // core/config/mod.rs:2640-2654 resolves each explicit enabled=false to false.
    // Only the exact raw layer + immutable pre-start file + live issuer bind them.
    expected.tools = { web_search: null };
    expected.history = { ...rec(input.history), max_bytes: null }; // types.rs:197-204
    expected.apps = { _default: { ...rec(rec(input.apps)._default),
        approvals_reviewer: null, default_tools_approval_mode: null } }; // API:185-193
    expected.agents = { ...rec(input.agents), max_concurrent_threads_per_session: null, max_depth: null,
        default_subagent_model: null, default_subagent_reasoning_effort: null,
        job_max_runtime_seconds: null, interrupt_message: null }; // ConfigToml:676-708
    expected.features = { ...rec(input.features), network_proxy: null,
        // FeaturesToml:747-780; FeatureSpec defaults at 1104,1264,1480,1588,1630.
        auth_elicitation: true, background_paginated_rollout_migration: false,
        mcp_2026_07_28: false, mentions_v2: true, remote_control: false };
    // ConfigToml:199-200 uses the default ShellEnvironmentPolicyToml. Its
    // definition is re-exported, NOT present in this source pack. Match only this
    // observed null wire shape; do NOT infer environment filtering or tool safety.
    // The actual child environment and nofork/exec boundary remain host-enforced.
    expected.shell_environment_policy = { inherit: null, ignore_default_excludes: null, exclude: null,
        set: null, include_only: null, filters: null, experimental_use_profile: null };
    return expected;
}

/** Exact JSON comparison with closed objects/arrays; never runs property getters.
 * Objects from the real transport are JSON.parse data. Reject non-JSON stand-ins
 * rather than normalizing them into an apparently genuine response.
 */
function exactMacReadback(actual: unknown, expected: unknown): void {
    const fail = (): never => { throw new ExecutionError('unqualified_boundary'); };
    if (expected === null || typeof expected !== 'object') {
        if (!Object.is(actual, expected)) fail();
        return;
    }
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual) !== Array.isArray(expected)) throw new ExecutionError('unqualified_boundary');
    const prototype = Object.getPrototypeOf(actual);
    if (prototype !== (Array.isArray(expected) ? Array.prototype : Object.prototype)) fail();
    const keys = Reflect.ownKeys(expected), descriptors = Object.getOwnPropertyDescriptors(actual);
    if (Reflect.ownKeys(actual).length !== keys.length) fail();
    for (const key of keys) {
        const descriptor = descriptors[key as string];
        if (!descriptor || !Object.hasOwn(descriptor, 'value')
            || descriptor.enumerable !== Object.getOwnPropertyDescriptor(expected, key)!.enumerable) fail();
        exactMacReadback(descriptor.value, (expected as RecordValue)[key as string]);
    }
}
function canonicalMacJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalMacJson).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalMacJson((value as RecordValue)[key])}`).join(',')}}`;
}

/** Structural/source compatibility ONLY. Returns no token, receipt, authority,
 * Boolean witness or normalized replacement response. Administrative absence,
 * pre-start inode/content identity and same-process currentness MUST be observed
 * independently by the private issuer around its actual includeLayers/cwd RPC.
 * In particular this helper alone cannot attest even an empty system layer.
 */
export function assertMacConfigReadback(raw: unknown, executionCwd: string): void {
    if (MAC_CONFIG_SOURCE.commit !== MAC_READBACK_SOURCE.commit
        || EXECUTION_SUBSTRATE.codexVersion !== MAC_READBACK_SOURCE.binaryVersion
        || EXECUTION_SUBSTRATE.codexSha256 !== MAC_READBACK_SOURCE.binarySha256
        || typeof executionCwd !== 'string' || !isAbsolute(executionCwd) || normalize(executionCwd) !== executionCwd
        || basename(executionCwd) !== 'work' || executionCwd !== join(dirname(executionCwd), 'work') || dirname(executionCwd) === '/'
        || /[\x00-\x1f\x7f]/u.test(executionCwd)) throw new ExecutionError('unqualified_boundary');
    const input = macReadbackInput(), version = `sha256:${macDigest(canonicalMacJson(input))}`;
    const name = { type: 'user', file: join(dirname(executionCwd), 'codex', 'config.toml'), profile: null };
    const user = { name, version, config: input };
    const origins: RecordValue = {};
    function leaves(value: RecordValue, prefix = ''): void {
        for (const [key, child] of Object.entries(value)) {
            const path = prefix ? `${prefix}.${key}` : key;
            if (child && typeof child === 'object') leaves(rec(child), path);
            else {
                // FeatureToml<bool|config> supports this enabled leaf (features
                // lib.rs:855-866). The captured current stack spells ONLY this
                // origin with .enabled; its origin-builder is not in this pack.
                // Require the exact one-to-one wire spelling, never either alias
                // or a generic feature normalizer. Raw user input stays boolean.
                const origin = path === 'features.multi_agent_v2' ? 'features.multi_agent_v2.enabled' : path;
                origins[origin] = { name, version };
            }
        }
    }
    leaves(input);
    // Read only own data descriptors before selecting the single optional shape.
    if (!raw || typeof raw !== 'object') throw new ExecutionError('unqualified_boundary');
    const layers = Object.getOwnPropertyDescriptor(raw, 'layers');
    const values = layers && Object.hasOwn(layers, 'value') ? layers.value : undefined;
    if (!Array.isArray(values) || values.length < 1 || values.length > 2) throw new ExecutionError('unqualified_boundary');
    const expectedLayers: unknown[] = [user];
    if (values.length === 2) expectedLayers.push({ name: { type: 'system', file: '/etc/codex/config.toml' },
        version: `sha256:${macDigest('{}')}`, config: {} });
    exactMacReadback(raw, { config: macTypedReadback(input), origins, layers: expectedLayers });
}

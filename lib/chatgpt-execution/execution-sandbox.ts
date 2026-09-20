/* @Codex */
import 'server-only';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { rootCertificates } from 'node:tls';
import { ExecutionError } from './execution-contract';

// A candidate is admitted only on this observed substrate. Updating a pin needs
// a new synthetic OS qualification; this is not a portable macOS sandbox claim.
export const EXECUTION_SUBSTRATE = Object.freeze({
    codexVersion: '0.153.4', osBuild: '26B5086k',
    codexSha256: 'b973d440acac501fd2594a43e7ca9ce41e0a65b9dfb28d0d7a7837c99e1261e3',
    dyldSupportSha256: 'bdfc2354c683c8fb95a39e63fbc8610e9739b0256c89ab880564edefbe73a5ce',
    publicCaSha256: 'fcd6a24dfe6185af9b508d0fcb8b8525b7451dc241a2c18978abdd7b50ecfc84',
});
export const DYLD_SUPPORT_PATH = '/System/Library/Sandbox/Profiles/dyld-support.sb';

/** Only bundled public roots; never consult the user's keychain or environment. */
export function executionPublicCaBundle(): string {
    const pem = rootCertificates.join('\n');
    if (createHash('sha256').update(pem).digest('hex') !== EXECUTION_SUBSTRATE.publicCaSha256) throw new ExecutionError('unqualified_boundary');
    return pem;
}

function literal(path: string): string {
    if (!isAbsolute(path) || /[\x00-\x1f\x7f]/u.test(path)) throw new ExecutionError('unqualified_boundary');
    return JSON.stringify(path);
}
export function verifyExecutionSubstrate(binary: string): string {
    try {
        if (process.platform !== 'darwin') throw new Error();
        const executable = realpathSync(binary);
        const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
        const osVersion = readFileSync('/System/Library/CoreServices/SystemVersion.plist', 'utf8');
        if (!osVersion.includes(`<string>${EXECUTION_SUBSTRATE.osBuild}</string>`)
            || digest(executable) !== EXECUTION_SUBSTRATE.codexSha256
            || digest(DYLD_SUPPORT_PATH) !== EXECUTION_SUBSTRATE.dyldSupportSha256) throw new Error();
        return executable;
    } catch { throw new ExecutionError('unqualified_boundary'); }
}

/** No general system.sb import: it grants ambient preference IPC and broad reads. */
export function executionSandboxProfile(root: string, binary: string, proxyPort: number, probeNode?: string): string {
    if (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535) throw new ExecutionError('unqualified_boundary');
    const owned = literal(root), executable = literal(binary);
    const probe = probeNode ? ` (literal ${literal(probeNode)})` : '';
    const probeAncestors = probeNode ? ` (path-ancestors ${literal(probeNode)})` : '';
    return `(version 1)
(deny default)
(import "dyld-support.sb")
(deny process-fork)
(allow process-exec (literal ${executable})${probe})
(allow signal (target same-sandbox))
(allow process-info* (target same-sandbox))
(allow file-read-metadata file-test-existence
  (path-ancestors ${owned}) (subpath ${owned})
  (path-ancestors ${executable}) (literal ${executable})${probe}${probeAncestors}
  (subpath "/System/Library") (subpath "/usr/lib")
  (subpath "/Library/Apple/System/Library")
  (literal "/dev") (literal "/dev/null") (literal "/dev/random") (literal "/dev/urandom")
  (literal "/private/etc/localtime")
  (literal "/etc") (literal "/private/etc")
  (literal "/private/etc/codex") (literal "/private/etc/codex/requirements.toml")
  (literal "/private/etc/codex/config.toml") (literal "/private/etc/codex/managed_config.toml")
  (literal "/etc/codex") (literal "/etc/codex/requirements.toml")
  (literal "/etc/codex/config.toml") (literal "/etc/codex/managed_config.toml"))
(allow file-map-executable file-read-data
  (subpath "/System/Library") (subpath "/usr/lib")
  (subpath "/Library/Apple/System/Library")
  (literal "/dev/null") (literal "/dev/random") (literal "/dev/urandom")
  (literal "/private/etc/localtime") (literal ${executable})${probe}
  (subpath ${owned}))
; ONLY exact absent administrative paths, checked by the native custodian.
; PermissionDenied is never converted to NotFound.
(allow file-read-data
  (literal "/etc/codex/requirements.toml") (literal "/private/etc/codex/requirements.toml")
  (literal "/etc/codex/config.toml") (literal "/private/etc/codex/config.toml")
  (literal "/etc/codex/managed_config.toml") (literal "/private/etc/codex/managed_config.toml"))
(allow file-write* ${['codex', 'work', 'tmp', 'config', 'cache', 'data'].map(name => `(subpath ${literal(join(root, name))})`).join(' ')} (literal "/dev/null"))
; All protected files lack owner-write permission. Deny chmod/chown/chflags
; globally so a hard-link alias in scratch cannot regain write permission.
(deny file-write-mode file-write-owner file-write-flags)
; Protect parent directory entries as well as immutable leaf files.
(deny file-write* (literal ${owned}) (subpath ${literal(join(root, 'runtime'))})
  ${['codex', 'work', 'tmp', 'config', 'cache', 'data'].map(name => `(literal ${literal(join(root, name))})`).join(' ')})
(deny file-write* (literal ${literal(join(root, 'codex', 'config.toml'))})
  (literal ${literal(join(root, 'profile.sb'))}) (literal ${literal(join(root, 'runtime', 'public-ca.pem'))}) (literal ${executable}))
(allow sysctl-read)
(allow system-mac-syscall (mac-policy-name "vnguard"))
(allow system-mac-syscall (require-all (mac-policy-name "Sandbox") (mac-syscall-number 67)))
; No ambient Mach lookup, preferences IPC, Unix sockets or local services.
(deny mach-lookup)
(allow network-outbound (remote tcp "localhost:${proxyPort}"))
`;
}

// Whole-process restrictions above are independent of these narrower Codex
// capability controls. Unknown config keys fail through --strict-config.
export const EXECUTION_CONFIG = `cli_auth_credentials_store = "ephemeral"
forced_login_method = "chatgpt"
check_for_update_on_startup = false
approval_policy = "never"
approvals_reviewer = "user"
sandbox_mode = "read-only"
web_search = "disabled"
allow_login_shell = false
project_doc_max_bytes = 0
include_environment_context = false
hide_agent_reasoning = true
show_raw_agent_reasoning = false
model_reasoning_summary = "none"
[history]
persistence = "none"
[analytics]
enabled = false
[feedback]
enabled = false
[agents]
enabled = false
[apps._default]
enabled = false
destructive_enabled = false
open_world_enabled = false
[features]
apps = false
plugins = false
remote_plugin = false
tool_suggest = false
shell_tool = false
unified_exec = false
code_mode = false
js_repl = false
multi_agent = false
multi_agent_v2 = false
code_mode_host = false
code_mode_prewarm = false
apply_patch_freeform = false
request_permissions_tool = false
tool_search = false
search_tool = false
standalone_web_search = false
web_search_cached = false
web_search_request = false
skip_host_skill_discovery = true
skill_search = false
skill_mcp_dependency_install = false
external_agent_memory_import = false
memory_tool = false
realtime_conversation = false
in_app_browser = false
browser_use_external = false
browser_use_full_cdp_access = false
enable_mcp_apps = false
plugin_hooks = false
codex_hooks = false
web_search = false
browser_use = false
computer_use = false
hooks = false
memories = false
[tools.update_plan]
enabled = false
[tools.experimental_request_user_input]
enabled = false
`;

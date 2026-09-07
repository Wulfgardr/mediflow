/* @Codex */
import 'server-only';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { accessSync, constants, mkdtempSync, mkdirSync, chmodSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { AccountError, record, type AccountTransport } from './account-protocol';
import { createStdioAccountTransport } from './account-transport';

const CONFIG = 'cli_auth_credentials_store = "ephemeral"\nforced_login_method = "chatgpt"\ncheck_for_update_on_startup = false\n[analytics]\nenabled = false\n[feedback]\nenabled = false\n';
// Server-only injection seam. Routes never accept any of these values.
export function createAccountHost(binary: string | undefined) {
    const owned = new Set<AccountTransport>();
    const children = new Set<ChildProcessWithoutNullStreams>();
    // Exit handlers cannot await cleanup. Kill only owned children; orphan homes
    // remain private, are never reused, and are not reported as deleted.
    const onParentExit = () => { for (const child of children) child.kill('SIGKILL'); };
    return Object.freeze({
        configured: typeof binary === 'string' && isAbsolute(binary),
        async createTransport(): Promise<AccountTransport> {
            if (!binary || !isAbsolute(binary) || binary.includes('\0')) throw new AccountError('host_unavailable');
            let executable: string;
            try { executable = realpathSync(binary); accessSync(executable, constants.X_OK); }
            catch { throw new AccountError('host_unavailable'); }
            const root = realpathSync(mkdtempSync(join(tmpdir(), 'mediflow-chatgpt-account-')));
            try {
                chmodSync(root, 0o700);
                const codexHome = join(root, 'codex');
                for (const name of ['codex', 'config', 'cache', 'data', 'tmp', 'work']) mkdirSync(join(root, name), { mode: 0o700 });
                writeFileSync(join(codexHome, 'config.toml'), CONFIG, { mode: 0o600, flag: 'wx' });
                const child = spawn(executable, ['app-server', '--listen', 'stdio://'], {
                    cwd: join(root, 'work'), shell: false, stdio: ['pipe', 'pipe', 'pipe'],
                    env: {
                        HOME: root, CODEX_HOME: codexHome, XDG_CONFIG_HOME: join(root, 'config'),
                        XDG_CACHE_HOME: join(root, 'cache'), XDG_DATA_HOME: join(root, 'data'), TMPDIR: join(root, 'tmp'),
                        NODE_ENV: 'production', PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8',
                    },
                });
                if (children.size === 0) process.once('exit', onParentExit);
                children.add(child);
                child.once('exit', () => { children.delete(child); if (children.size === 0) process.removeListener('exit', onParentExit); });
                child.once('error', () => {
                    if (!child.pid) { children.delete(child); if (children.size === 0) process.removeListener('exit', onParentExit); }
                });
                const transport = createStdioAccountTransport(child, { onClosed: async () => {
                    rmSync(root, { recursive: true, force: true }); owned.delete(transport);
                } });
                owned.add(transport);
                return Object.freeze({ ...transport, async request(method, params) {
                    const result = await transport.request(method, params);
                    if (method === 'initialize' && record(result).codexHome !== codexHome) {
                        await transport.close(); throw new AccountError('protocol_error');
                    }
                    return result;
                } } satisfies AccountTransport);
            } catch { rmSync(root, { recursive: true, force: true }); throw new AccountError('host_unavailable'); }
        },
        async dispose() { return (await Promise.all([...owned].map((transport) => transport.close()))).every(Boolean); },
    });
}

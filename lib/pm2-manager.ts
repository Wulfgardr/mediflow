import net from 'node:net';
import path from 'path';

import { resolveDataPath } from '@/lib/data-dir';

/* @Codex */
const PM2_PATH_OVERRIDE_KEYS = [
    'OVER_HOME',
    'PM2_ROOT_PATH',
    'PM2_CONF_FILE',
    'PM2_MODULE_CONF_FILE',
    'PM2_LOG_FILE_PATH',
    'PM2_PID_FILE_PATH',
    'PM2_RELOAD_LOCKFILE',
    'PM2_DEFAULT_PID_PATH',
    'PM2_DEFAULT_LOG_PATH',
    'PM2_DEFAULT_MODULE_PATH',
    'PM2_IO_ACCESS_TOKEN',
    'PM2_DUMP_FILE_PATH',
    'PM2_DUMP_BACKUP_FILE_PATH',
    'PM2_DAEMON_RPC_PORT',
    'PM2_DAEMON_PUB_PORT',
    'PM2_INTERACTOR_RPC_PORT',
    'PM2_INTERACTOR_LOG_FILE_PATH',
    'PM2_INTERACTOR_PID_PATH',
    'PM2_INTERACTION_CONF',
    'PM2_HAS_NODE_EMBEDDED',
    'PM2_BUILTIN_NODE_PATH',
    'PM2_BUILTIN_NPM_PATH',
] as const;

for (const key of PM2_PATH_OVERRIDE_KEYS) delete process.env[key];

process.env.PM2_NO_INTERACTION = 'true';
// Keep MediFlow out of a pre-existing global PM2 daemon: it may be linked to an
// external PM2 service or manage unrelated applications. Both values must be
// fixed before CommonJS initialization because PM2 snapshots them at load time.
const mediflowPM2Home = path.resolve(resolveDataPath('pm2'));
const longestSocketPath = path.join(mediflowPM2Home, 'interactor.sock');
const unixSocketLimit = process.platform === 'darwin' ? 103 : 107;

if (process.platform !== 'win32' && Buffer.byteLength(longestSocketPath) > unixSocketLimit) {
    throw new Error(
        `PM2 non avviato: il percorso socket MediFlow supera ${unixSocketLimit} byte. `
        + 'Configura MEDIFLOW_DATA_DIR con un percorso locale più corto.',
    );
}

process.env.PM2_HOME = mediflowPM2Home;

type IsolatedPM2 = Omit<typeof import('pm2'), 'disconnect'> & {
    pm2_home?: string;
    Client?: {
        pm2_home?: string;
        rpc_socket_file?: string;
        pub_socket_file?: string;
    };
    disconnect(callback?: (error?: Error | null) => void): void;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pm2 = require('pm2') as IsolatedPM2;

const effectivePaths = [pm2.pm2_home, pm2.Client?.pm2_home];
if (process.platform !== 'win32') {
    effectivePaths.push(pm2.Client?.rpc_socket_file, pm2.Client?.pub_socket_file);
}

for (const effectivePath of effectivePaths) {
    if (!effectivePath) throw new Error('PM2 non avviato: configurazione di isolamento incompleta.');
    const relativePath = path.relative(mediflowPM2Home, effectivePath);
    if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
        throw new Error('PM2 non avviato: un percorso runtime esce dalla home MediFlow isolata.');
    }
}

const PROCESS_NAME = 'mlx-inference-server';
const MLX_LOOPBACK_PORT = 8080;
let startInFlight: Promise<void> | null = null;
let connectionTail: Promise<void> = Promise.resolve();

function withConnectionLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = connectionTail;
    let release: () => void = () => undefined;
    connectionTail = new Promise<void>((resolve) => {
        release = resolve;
    });

    return previous.then(operation).finally(release);
}

function disconnectPM2(): Promise<void> {
    return new Promise((resolve, reject) => {
        pm2.disconnect((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

/* @Codex */
export function assertLoopbackPortAvailable(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();

        probe.once('error', (error: NodeJS.ErrnoException) => {
            if (error.code === 'EADDRINUSE') {
                reject(new Error(
                    `MLX non avviato: la porta locale ${port} è già in uso. `
                    + 'Arresta soltanto l’eventuale istanza legacy di mlx-inference-server e riprova; '
                    + 'MediFlow non modificherà altri processi PM2.',
                ));
                return;
            }

            reject(error);
        });

        probe.once('listening', () => {
            probe.close((error) => {
                if (error) reject(error);
                else resolve();
            });
        });

        probe.listen({ host: '127.0.0.1', port, exclusive: true });
    });
}

export interface ProcessStatus {
    name: string;
    status: 'online' | 'stopped' | 'stopping' | 'launching' | 'errored' | 'unknown';
    uptime?: number;
    cpu?: number;
    memory?: number;
}

export class PM2Manager {
    static withConnection<T>(operation: () => Promise<T>): Promise<T> {
        return withConnectionLock(async () => {
            try {
                await new Promise<void>((resolve, reject) => {
                    pm2.connect((err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
            } catch (error) {
                // PM2 may leave a partially initialized RPC client after a
                // failed connect. Best-effort closure keeps the next queued
                // request from inheriting that client; preserve the root error.
                await disconnectPM2().catch(() => undefined);
                throw error;
            }

            try {
                return await operation();
            } finally {
                // PM2's disconnect callback fires only after RPC/PUB sockets
                // have closed. Await it before releasing the queue: calling
                // connect again while Client.close is in flight can null the
                // socket underneath PM2's next connect handler.
                await disconnectPM2();
            }
        });
    }

    static async getStatus(): Promise<ProcessStatus> {
        return new Promise((resolve, reject) => {
            pm2.describe(PROCESS_NAME, (err, description) => {
                if (err) {
                    // If error is just "process not found" (can happen if never started), treat as stopped
                    // PM2 describe might return empty array if not found?
                    // Let's handle general error
                    console.error("PM2 Describe Error:", err);
                    // Usually if not found, it returns empty array, no error
                    return reject(err);
                }

                if (!description || description.length === 0) {
                    return resolve({ name: PROCESS_NAME, status: 'stopped' });
                }

                const proc = description[0];
                return resolve({
                    name: proc.name || PROCESS_NAME,
                    status: (proc.pm2_env?.status as any) || 'unknown',
                    uptime: proc.pm2_env?.pm_uptime,
                    cpu: proc.monit?.cpu,
                    memory: proc.monit?.memory
                });
            });
        });
    }

    static start(): Promise<void> {
        if (startInFlight) return startInFlight;

        startInFlight = this.startOnce().finally(() => {
            startInFlight = null;
        });
        return startInFlight;
    }

    private static async startOnce(): Promise<void> {
        // @Codex
        // The MLX inference server (ecosystem.config.js -> bash start-mlx.sh) only
        // runs on macOS Apple Silicon. Fail fast with a clear message elsewhere
        // instead of letting PM2 try to load a bash interpreter on Windows.
        if (process.platform !== 'darwin') {
            throw new Error(
                `MLX inference server non supportato su ${process.platform}/${process.arch}: disponibile solo su macOS Apple Silicon. Usa Ollama come runtime AI cross-platform.`,
            );
        }

        const currentStatus = await this.getStatus();
        if (currentStatus.status === 'online') return;
        await assertLoopbackPortAvailable(MLX_LOOPBACK_PORT);

        return new Promise((resolve, reject) => {
            // We start using the ecosystem file to ensure config is loaded
            const cwd = process.cwd();
            const ecosystemPath = path.join(cwd, 'ecosystem.config.js');

            pm2.start(ecosystemPath, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    static async stop(): Promise<void> {
        return new Promise((resolve, reject) => {
            pm2.stop(PROCESS_NAME, (err) => {
                // Ignore error if process not found to stop
                const message = err instanceof Error ? err.message : String(err || '');
                if (err && /process(?: or namespace)? not found/i.test(message)) {
                    resolve();
                } else if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
}

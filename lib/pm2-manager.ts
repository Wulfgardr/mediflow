import pm2 from 'pm2';
import path from 'path';

const PROCESS_NAME = 'mlx-inference-server';

export interface ProcessStatus {
    name: string;
    status: 'online' | 'stopped' | 'stopping' | 'launching' | 'errored' | 'unknown';
    uptime?: number;
    cpu?: number;
    memory?: number;
}

export class PM2Manager {
    static connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            pm2.connect((err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    static disconnect(): void {
        pm2.disconnect();
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

    static async start(): Promise<void> {
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
                if (err && (err as any).message?.includes('process not found')) {
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

/* @Codex */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

export const BACKUP_SCHEDULER_SETTINGS_KEY = 'backupScheduler';
export const BACKUP_SCHEDULER_LABEL = 'dev.wulfgardr.mediflow.backup';
export const BACKUP_SCHEDULER_STATE_VERSION = 1 as const;

export type BackupSchedulerRunStatus = 'success' | 'error';

export type BackupSchedulerConfig = {
    enabled: boolean;
    hour: number;
    minute: number;
    destinationDir: string;
};

export type BackupSchedulerRunState = {
    lastRunAt: string | null;
    lastRunStatus: BackupSchedulerRunStatus | null;
    lastRunMessage: string | null;
    lastArtifactPath: string | null;
};

export type BackupSchedulerState = {
    version: typeof BACKUP_SCHEDULER_STATE_VERSION;
    config: BackupSchedulerConfig;
    run: BackupSchedulerRunState;
};

export type BackupSchedulerStatus = {
    supported: boolean;
    installed: boolean;
    plistPath: string | null;
    state: BackupSchedulerState;
};

export type BackupSchedulerScriptResult = {
    ok: boolean;
    artifactPath?: string;
    createdAt?: string;
    message: string;
};

function getDefaultDataDir(): string {
    return process.env.MEDIFLOW_DATA_DIR
        || (process.platform === 'darwin'
            ? path.join(os.homedir(), 'Library', 'Application Support', 'MediFlow')
            : path.join(os.homedir(), '.mediflow'));
}

function getDefaultDestinationDir(): string {
    return path.join(getDefaultDataDir(), 'backups');
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

function sanitizeDestinationDir(value: unknown): string {
    if (typeof value !== 'string') return getDefaultDestinationDir();
    const trimmed = value.trim();
    if (!trimmed || !path.isAbsolute(trimmed)) return getDefaultDestinationDir();
    return trimmed;
}

function sanitizeRunState(value: unknown): BackupSchedulerRunState {
    const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const lastRunStatus = record.lastRunStatus === 'success' || record.lastRunStatus === 'error'
        ? record.lastRunStatus
        : null;

    return {
        lastRunAt: typeof record.lastRunAt === 'string' ? record.lastRunAt : null,
        lastRunStatus,
        lastRunMessage: typeof record.lastRunMessage === 'string' ? record.lastRunMessage : null,
        lastArtifactPath: typeof record.lastArtifactPath === 'string' ? record.lastArtifactPath : null,
    };
}

export function getDefaultBackupSchedulerState(): BackupSchedulerState {
    return {
        version: BACKUP_SCHEDULER_STATE_VERSION,
        config: {
            enabled: false,
            hour: 2,
            minute: 0,
            destinationDir: getDefaultDestinationDir(),
        },
        run: {
            lastRunAt: null,
            lastRunStatus: null,
            lastRunMessage: null,
            lastArtifactPath: null,
        },
    };
}

export function readBackupSchedulerStateFromValue(value: string | null | undefined): BackupSchedulerState {
    if (!value) return getDefaultBackupSchedulerState();

    try {
        const parsed = JSON.parse(value) as Record<string, unknown>;
        const config = parsed.config && typeof parsed.config === 'object'
            ? parsed.config as Record<string, unknown>
            : {};

        return {
            version: BACKUP_SCHEDULER_STATE_VERSION,
            config: {
                enabled: Boolean(config.enabled),
                hour: clampInteger(config.hour, 2, 0, 23),
                minute: clampInteger(config.minute, 0, 0, 59),
                destinationDir: sanitizeDestinationDir(config.destinationDir),
            },
            run: sanitizeRunState(parsed.run),
        };
    } catch {
        return getDefaultBackupSchedulerState();
    }
}

export function mergeBackupSchedulerConfig(
    current: BackupSchedulerState,
    patch: Partial<BackupSchedulerConfig>,
): BackupSchedulerState {
    return {
        ...current,
        config: {
            enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.config.enabled,
            hour: clampInteger(patch.hour, current.config.hour, 0, 23),
            minute: clampInteger(patch.minute, current.config.minute, 0, 59),
            destinationDir: sanitizeDestinationDir(patch.destinationDir ?? current.config.destinationDir),
        },
    };
}

function escapeXml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}

export function getBackupLaunchAgentPath(homeDir = os.homedir()): string {
    return path.join(homeDir, 'Library', 'LaunchAgents', `${BACKUP_SCHEDULER_LABEL}.plist`);
}

export function buildBackupLaunchAgentPlist(
    state: BackupSchedulerState,
    options?: {
        projectRoot?: string;
        nodePath?: string;
        dataDir?: string;
    },
): string {
    const projectRoot = options?.projectRoot ?? process.cwd();
    const nodePath = options?.nodePath ?? process.execPath;
    const dataDir = options?.dataDir ?? getDefaultDataDir();
    const logsDir = path.join(dataDir, 'logs');
    const runnerPath = path.join(projectRoot, 'scripts', 'run-scheduled-backup.mjs');

    return `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(BACKUP_SCHEDULER_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodePath)}</string>
    <string>--experimental-strip-types</string>
    <string>${escapeXml(runnerPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(projectRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>MEDIFLOW_DATA_DIR</key>
    <string>${escapeXml(dataDir)}</string>
    <key>MEDIFLOW_BACKUP_DEST_DIR</key>
    <string>${escapeXml(state.config.destinationDir)}</string>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${state.config.hour}</integer>
    <key>Minute</key>
    <integer>${state.config.minute}</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${escapeXml(path.join(logsDir, 'backup-scheduler.stdout.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(path.join(logsDir, 'backup-scheduler.stderr.log'))}</string>
</dict>
</plist>
`;
}

export function installBackupLaunchAgent(state: BackupSchedulerState): string {
    if (process.platform !== 'darwin') {
        throw new Error('Automatic nightly backup is currently supported only on macOS.');
    }

    const plistPath = getBackupLaunchAgentPath();
    fs.mkdirSync(path.dirname(plistPath), { recursive: true });
    fs.mkdirSync(path.join(getDefaultDataDir(), 'logs'), { recursive: true });
    fs.writeFileSync(plistPath, buildBackupLaunchAgentPlist(state), 'utf8');

    const uid = String(process.getuid?.() ?? '');
    const domain = uid ? `gui/${uid}` : '';
    if (domain) {
        spawnSync('launchctl', ['bootout', domain, plistPath], { stdio: 'ignore' });
        const result = spawnSync('launchctl', ['bootstrap', domain, plistPath], { encoding: 'utf8' });
        if (result.status !== 0) {
            const message = (result.stderr || result.stdout || 'launchctl bootstrap failed').trim();
            throw new Error(message);
        }
    }

    return plistPath;
}

export function uninstallBackupLaunchAgent(): void {
    if (process.platform !== 'darwin') return;

    const plistPath = getBackupLaunchAgentPath();
    const uid = String(process.getuid?.() ?? '');
    const domain = uid ? `gui/${uid}` : '';
    if (domain && fs.existsSync(plistPath)) {
        spawnSync('launchctl', ['bootout', domain, plistPath], { stdio: 'ignore' });
    }
    if (fs.existsSync(plistPath)) {
        fs.unlinkSync(plistPath);
    }
}

export function getBackupSchedulerStatus(value: string | null | undefined): BackupSchedulerStatus {
    const state = readBackupSchedulerStateFromValue(value);
    const plistPath = process.platform === 'darwin' ? getBackupLaunchAgentPath() : null;
    return {
        supported: process.platform === 'darwin',
        installed: Boolean(plistPath && fs.existsSync(plistPath)),
        plistPath,
        state,
    };
}

export function runBackupSchedulerScript(options?: {
    force?: boolean;
    projectRoot?: string;
    destinationDir?: string;
}): BackupSchedulerScriptResult {
    const projectRoot = options?.projectRoot ?? process.cwd();
    const scriptPath = path.join(projectRoot, 'scripts', 'run-scheduled-backup.mjs');
    const env = {
        ...process.env,
        MEDIFLOW_BACKUP_JSON: '1',
        ...(options?.force ? { MEDIFLOW_BACKUP_FORCE: '1' } : {}),
        ...(options?.destinationDir ? { MEDIFLOW_BACKUP_DEST_DIR: options.destinationDir } : {}),
    };

    const result = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath], {
        cwd: projectRoot,
        env,
        encoding: 'utf8',
    });

    const raw = (result.stdout || result.stderr || '').trim();
    if (!raw) {
        return {
            ok: false,
            message: 'Scheduled backup runner returned no output.',
        };
    }

    try {
        const parsed = JSON.parse(raw) as BackupSchedulerScriptResult;
        if (typeof parsed.ok === 'boolean' && typeof parsed.message === 'string') {
            return parsed;
        }
    } catch {
        // fall through
    }

    return {
        ok: false,
        message: raw,
    };
}

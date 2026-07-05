/* @Codex */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

export const BACKUP_SCHEDULER_SETTINGS_KEY = 'backupScheduler';
export const BACKUP_SCHEDULER_LABEL = 'dev.wulfgardr.mediflow.backup';
export const BACKUP_SCHEDULER_STATE_VERSION = 1 as const;
export const DEFAULT_BACKUP_RETENTION_KEEP_ARTIFACTS = 14 as const;

const BACKUP_ARTIFACT_FILE_PREFIX = 'mediflow-backup-v1-';
const BACKUP_ARTIFACT_FILE_SUFFIX = '.mediflow';
const BACKUP_ARTIFACT_TEMP_SUFFIX = '.mediflow.tmp';

export type BackupSchedulerRunStatus = 'success' | 'error';
export type BackupRetentionMode = 'auto' | 'manual';

export type BackupSchedulerConfig = {
    enabled: boolean;
    hour: number;
    minute: number;
    destinationDir: string;
    retentionKeepArtifacts: number;
};

export type BackupSchedulerRunState = {
    lastRunAt: string | null;
    lastRunStatus: BackupSchedulerRunStatus | null;
    lastRunMessage: string | null;
    lastArtifactPath: string | null;
    lastRetentionAt: string | null;
    lastRetentionDeletedCount: number | null;
    lastRetentionDeletedBytes: number | null;
    lastRetentionMode: BackupRetentionMode | null;
};

export type BackupSchedulerState = {
    version: typeof BACKUP_SCHEDULER_STATE_VERSION;
    config: BackupSchedulerConfig;
    run: BackupSchedulerRunState;
};

export type BackupScheduleKind = 'launchd' | 'schtasks' | 'systemd-timer' | 'cron';

export type BackupSchedulerStatus = {
    supported: boolean;
    installed: boolean;
    plistPath: string | null;
    /** Cross-platform path of the registered schedule (plist/task/unit/crontab marker). */
    schedulePath?: string | null;
    /** Which scheduling backend is active on this platform, if any. */
    scheduleKind?: BackupScheduleKind | null;
    state: BackupSchedulerState;
};

export type BackupSchedulerScriptResult = {
    ok: boolean;
    artifactPath?: string;
    createdAt?: string;
    message: string;
};

export type BackupRetentionCandidate = {
    path: string;
    kind: 'artifact' | 'temp';
    reason: 'keep-last-n' | 'orphan-temp';
    sizeBytes: number;
    modifiedAt: string | null;
};

export type BackupRetentionPreview = {
    destinationDir: string;
    keepArtifacts: number;
    artifactCount: number;
    orphanTempCount: number;
    deleteCount: number;
    deleteBytes: number;
    items: BackupRetentionCandidate[];
};

export type BackupRetentionApplyResult = BackupRetentionPreview & {
    deletedCount: number;
    deletedBytes: number;
};

type ManagedBackupFile = {
    path: string;
    name: string;
    kind: 'artifact' | 'temp';
    sizeBytes: number;
    modifiedAt: string | null;
    modifiedAtMs: number;
};

export function getDefaultDataDir(): string {
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

function clampRetentionKeepArtifacts(value: unknown, fallback: number = DEFAULT_BACKUP_RETENTION_KEEP_ARTIFACTS): number {
    return clampInteger(value, fallback, 1, 365);
}

function sanitizeDestinationDir(value: unknown): string {
    if (typeof value !== 'string') return getDefaultDestinationDir();
    const trimmed = value.trim();
    if (!trimmed || !path.isAbsolute(trimmed)) return getDefaultDestinationDir();
    return trimmed;
}

function sanitizeOptionalCount(value: unknown): number | null {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 0) return null;
    return parsed;
}

function sanitizeRunState(value: unknown): BackupSchedulerRunState {
    const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const lastRunStatus = record.lastRunStatus === 'success' || record.lastRunStatus === 'error'
        ? record.lastRunStatus
        : null;
    const lastRetentionMode = record.lastRetentionMode === 'auto' || record.lastRetentionMode === 'manual'
        ? record.lastRetentionMode
        : null;

    return {
        lastRunAt: typeof record.lastRunAt === 'string' ? record.lastRunAt : null,
        lastRunStatus,
        lastRunMessage: typeof record.lastRunMessage === 'string' ? record.lastRunMessage : null,
        lastArtifactPath: typeof record.lastArtifactPath === 'string' ? record.lastArtifactPath : null,
        lastRetentionAt: typeof record.lastRetentionAt === 'string' ? record.lastRetentionAt : null,
        lastRetentionDeletedCount: sanitizeOptionalCount(record.lastRetentionDeletedCount),
        lastRetentionDeletedBytes: sanitizeOptionalCount(record.lastRetentionDeletedBytes),
        lastRetentionMode,
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
            retentionKeepArtifacts: DEFAULT_BACKUP_RETENTION_KEEP_ARTIFACTS,
        },
        run: {
            lastRunAt: null,
            lastRunStatus: null,
            lastRunMessage: null,
            lastArtifactPath: null,
            lastRetentionAt: null,
            lastRetentionDeletedCount: null,
            lastRetentionDeletedBytes: null,
            lastRetentionMode: null,
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
                retentionKeepArtifacts: clampRetentionKeepArtifacts(config.retentionKeepArtifacts),
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
            retentionKeepArtifacts: clampRetentionKeepArtifacts(
                patch.retentionKeepArtifacts,
                current.config.retentionKeepArtifacts,
            ),
        },
    };
}

function classifyManagedBackupFile(name: string): ManagedBackupFile['kind'] | null {
    if (name.startsWith(BACKUP_ARTIFACT_FILE_PREFIX) && name.endsWith(BACKUP_ARTIFACT_TEMP_SUFFIX)) {
        return 'temp';
    }
    if (name.startsWith(BACKUP_ARTIFACT_FILE_PREFIX) && name.endsWith(BACKUP_ARTIFACT_FILE_SUFFIX)) {
        return 'artifact';
    }
    return null;
}

function listManagedBackupFiles(destinationDir: string): ManagedBackupFile[] {
    if (!fs.existsSync(destinationDir)) return [];

    const entries = fs.readdirSync(destinationDir, { withFileTypes: true });
    return entries.flatMap((entry) => {
        if (!entry.isFile()) return [];
        const kind = classifyManagedBackupFile(entry.name);
        if (!kind) return [];

        const filePath = path.join(destinationDir, entry.name);
        const stats = fs.statSync(filePath);
        return [{
            path: filePath,
            name: entry.name,
            kind,
            sizeBytes: stats.size,
            modifiedAt: Number.isFinite(stats.mtimeMs) ? stats.mtime.toISOString() : null,
            modifiedAtMs: Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : 0,
        }];
    });
}

function sortManagedBackupFiles(files: ManagedBackupFile[]): ManagedBackupFile[] {
    return [...files].sort((left, right) => {
        if (left.modifiedAtMs !== right.modifiedAtMs) {
            return right.modifiedAtMs - left.modifiedAtMs;
        }
        return right.name.localeCompare(left.name);
    });
}

export function previewBackupRetention(
    config: Pick<BackupSchedulerConfig, 'destinationDir' | 'retentionKeepArtifacts'>,
    options?: { preservePaths?: string[] },
): BackupRetentionPreview {
    const preservePaths = new Set((options?.preservePaths ?? []).map((value) => path.resolve(value)));
    const managedFiles = sortManagedBackupFiles(listManagedBackupFiles(config.destinationDir));
    const artifacts = managedFiles.filter((file) => file.kind === 'artifact');
    const orphanTemps = managedFiles
        .filter((file) => file.kind === 'temp')
        .filter((file) => !preservePaths.has(path.resolve(file.path)));
    const staleArtifacts = artifacts
        .slice(clampRetentionKeepArtifacts(config.retentionKeepArtifacts))
        .filter((file) => !preservePaths.has(path.resolve(file.path)));

    const items: BackupRetentionCandidate[] = [
        ...staleArtifacts.map((file) => ({
            path: file.path,
            kind: file.kind,
            reason: 'keep-last-n' as const,
            sizeBytes: file.sizeBytes,
            modifiedAt: file.modifiedAt,
        })),
        ...orphanTemps.map((file) => ({
            path: file.path,
            kind: file.kind,
            reason: 'orphan-temp' as const,
            sizeBytes: file.sizeBytes,
            modifiedAt: file.modifiedAt,
        })),
    ];

    return {
        destinationDir: config.destinationDir,
        keepArtifacts: clampRetentionKeepArtifacts(config.retentionKeepArtifacts),
        artifactCount: artifacts.length,
        orphanTempCount: orphanTemps.length,
        deleteCount: items.length,
        deleteBytes: items.reduce((sum, item) => sum + item.sizeBytes, 0),
        items,
    };
}

export function applyBackupRetention(
    config: Pick<BackupSchedulerConfig, 'destinationDir' | 'retentionKeepArtifacts'>,
    options?: { preservePaths?: string[] },
): BackupRetentionApplyResult {
    const preview = previewBackupRetention(config, options);

    for (const item of preview.items) {
        if (fs.existsSync(item.path)) {
            fs.unlinkSync(item.path);
        }
    }

    return {
        ...preview,
        deletedCount: preview.deleteCount,
        deletedBytes: preview.deleteBytes,
    };
}

export function applyRetentionResultToState(
    current: BackupSchedulerState,
    result: BackupRetentionApplyResult,
    mode: BackupRetentionMode,
    occurredAt = new Date(),
): BackupSchedulerState {
    const retainedArtifactPath = current.run.lastArtifactPath
        && result.items.some((item) => item.path === current.run.lastArtifactPath)
        ? null
        : current.run.lastArtifactPath;

    return {
        ...current,
        run: {
            ...current.run,
            lastArtifactPath: retainedArtifactPath,
            lastRetentionAt: occurredAt.toISOString(),
            lastRetentionDeletedCount: result.deletedCount,
            lastRetentionDeletedBytes: result.deletedBytes,
            lastRetentionMode: mode,
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

    const result = spawnSync(process.execPath, [scriptPath], {
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

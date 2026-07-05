/* @Codex */
// Cross-platform backup scheduling. The nightly backup runner
// (scripts/run-scheduled-backup.mjs) is already OS-agnostic; this module
// abstracts ONLY the OS-specific registration of a recurring job behind a
// single SchedulerAdapter interface:
//   - macOS:   launchd LaunchAgent (delegates to backup-scheduler.ts, unchanged)
//   - Windows: Task Scheduler via schtasks.exe + a small .cmd wrapper for env vars
//   - Linux:   systemd user timer (default), with a crontab fallback
// On a host where none is available (headless/sandbox) isSupported() is false and
// the API returns a structured 501 instead of throwing.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

import {
    BACKUP_SCHEDULER_LABEL,
    type BackupScheduleKind,
    type BackupSchedulerState,
    type BackupSchedulerStatus,
    buildBackupLaunchAgentPlist,
    getBackupLaunchAgentPath,
    getDefaultDataDir,
    installBackupLaunchAgent,
    readBackupSchedulerStateFromValue,
    uninstallBackupLaunchAgent,
} from './backup-scheduler';

export type SchedulerInstallResult = {
    schedulePath: string;
    kind: BackupScheduleKind;
};

export type SchedulerStatus = {
    installed: boolean;
    schedulePath: string | null;
};

export interface SchedulerAdapter {
    readonly kind: BackupScheduleKind;
    isSupported(): boolean;
    install(state: BackupSchedulerState): SchedulerInstallResult;
    uninstall(): void;
    getStatus(): SchedulerStatus;
}

const WINDOWS_TASK_NAME = 'MediFlow Backup';
const SYSTEMD_UNIT_NAME = 'mediflow-backup';
const CRON_MARKER = `# ${BACKUP_SCHEDULER_LABEL}`;

function pad2(value: number): string {
    return String(value).padStart(2, '0');
}

function runnerPathFor(projectRoot: string): string {
    return path.join(projectRoot, 'scripts', 'run-scheduled-backup.mjs');
}

function backupEnv(state: BackupSchedulerState, dataDir: string): Record<string, string> {
    return {
        MEDIFLOW_DATA_DIR: dataDir,
        MEDIFLOW_BACKUP_DEST_DIR: state.config.destinationDir,
    };
}

function assertNoControlChars(value: string, label: string): void {
    if (/[\0\r\n]/.test(value)) {
        throw new Error(`${label} cannot contain control characters.`);
    }
}

function quoteCmdArg(value: string, label: string): string {
    assertNoControlChars(value, label);
    if (value.includes('"')) {
        throw new Error(`${label} cannot contain double quotes.`);
    }
    return `"${value}"`;
}

function quoteCmdSetValue(value: string, label: string): string {
    assertNoControlChars(value, label);
    if (value.includes('"')) {
        throw new Error(`${label} cannot contain double quotes.`);
    }
    return value;
}

function quoteSystemdValue(value: string, label: string): string {
    assertNoControlChars(value, label);
    return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function quoteShellArg(value: string, label: string): string {
    assertNoControlChars(value, label);
    return `'${value.replaceAll("'", "'\\''")}'`;
}

// ---------------------------------------------------------------------------
// Pure builders (exported for unit tests; no side effects)
// ---------------------------------------------------------------------------

export function buildWindowsWrapperCmd(params: {
    nodePath: string;
    runnerPath: string;
    dataDir: string;
    destinationDir: string;
}): string {
    return [
        '@echo off',
        `set "MEDIFLOW_DATA_DIR=${quoteCmdSetValue(params.dataDir, 'dataDir')}"`,
        `set "MEDIFLOW_BACKUP_DEST_DIR=${quoteCmdSetValue(params.destinationDir, 'destinationDir')}"`,
        `${quoteCmdArg(params.nodePath, 'nodePath')} ${quoteCmdArg(params.runnerPath, 'runnerPath')}`,
        '',
    ].join('\r\n');
}

export function buildSchtasksCreateArgs(params: {
    taskName: string;
    wrapperPath: string;
    hour: number;
    minute: number;
}): string[] {
    return [
        '/Create', '/F',
        '/SC', 'DAILY',
        '/TN', params.taskName,
        '/TR', `"${params.wrapperPath}"`,
        '/ST', `${pad2(params.hour)}:${pad2(params.minute)}`,
    ];
}

export function buildSystemdServiceUnit(params: {
    nodePath: string;
    runnerPath: string;
    projectRoot: string;
    dataDir: string;
    destinationDir: string;
}): string {
    return `[Unit]
Description=MediFlow nightly backup

[Service]
Type=oneshot
WorkingDirectory=${quoteSystemdValue(params.projectRoot, 'projectRoot')}
Environment=${quoteSystemdValue(`MEDIFLOW_DATA_DIR=${params.dataDir}`, 'dataDir')}
Environment=${quoteSystemdValue(`MEDIFLOW_BACKUP_DEST_DIR=${params.destinationDir}`, 'destinationDir')}
ExecStart=${quoteSystemdValue(params.nodePath, 'nodePath')} ${quoteSystemdValue(params.runnerPath, 'runnerPath')}
`;
}

export function buildSystemdTimerUnit(params: { hour: number; minute: number }): string {
    return `[Unit]
Description=MediFlow nightly backup timer

[Timer]
OnCalendar=*-*-* ${pad2(params.hour)}:${pad2(params.minute)}:00
Persistent=true

[Install]
WantedBy=timers.target
`;
}

export function buildCronLine(params: {
    nodePath: string;
    runnerPath: string;
    projectRoot: string;
    dataDir: string;
    destinationDir: string;
    hour: number;
    minute: number;
}): string {
    const env = `MEDIFLOW_DATA_DIR=${quoteShellArg(params.dataDir, 'dataDir')} MEDIFLOW_BACKUP_DEST_DIR=${quoteShellArg(params.destinationDir, 'destinationDir')}`;
    const cmd = `cd ${quoteShellArg(params.projectRoot, 'projectRoot')} && ${env} ${quoteShellArg(params.nodePath, 'nodePath')} ${quoteShellArg(params.runnerPath, 'runnerPath')}`;
    return `${params.minute} ${params.hour} * * * ${cmd} ${CRON_MARKER}`;
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

class MacOSScheduler implements SchedulerAdapter {
    readonly kind: BackupScheduleKind = 'launchd';
    isSupported(): boolean {
        return process.platform === 'darwin';
    }
    install(state: BackupSchedulerState): SchedulerInstallResult {
        const schedulePath = installBackupLaunchAgent(state);
        return { schedulePath, kind: this.kind };
    }
    uninstall(): void {
        uninstallBackupLaunchAgent();
    }
    getStatus(): SchedulerStatus {
        const schedulePath = getBackupLaunchAgentPath();
        return { installed: fs.existsSync(schedulePath), schedulePath };
    }
}

class WindowsScheduler implements SchedulerAdapter {
    readonly kind: BackupScheduleKind = 'schtasks';

    private wrapperPath(): string {
        return path.join(getDefaultDataDir(), 'mediflow-scheduled-backup.cmd');
    }

    isSupported(): boolean {
        if (process.platform !== 'win32') return false;
        const probe = spawnSync('schtasks', ['/Query', '/?'], { stdio: 'ignore' });
        return !probe.error;
    }

    install(state: BackupSchedulerState): SchedulerInstallResult {
        const dataDir = getDefaultDataDir();
        fs.mkdirSync(dataDir, { recursive: true });
        const wrapperPath = this.wrapperPath();
        fs.writeFileSync(wrapperPath, buildWindowsWrapperCmd({
            nodePath: process.execPath,
            runnerPath: runnerPathFor(process.cwd()),
            dataDir,
            destinationDir: state.config.destinationDir,
        }), 'utf8');

        const args = buildSchtasksCreateArgs({
            taskName: WINDOWS_TASK_NAME,
            wrapperPath,
            hour: state.config.hour,
            minute: state.config.minute,
        });
        const result = spawnSync('schtasks', args, { encoding: 'utf8' });
        if (result.status !== 0) {
            throw new Error((result.stderr || result.stdout || 'schtasks /Create failed').trim());
        }
        return { schedulePath: wrapperPath, kind: this.kind };
    }

    uninstall(): void {
        spawnSync('schtasks', ['/Delete', '/F', '/TN', WINDOWS_TASK_NAME], { stdio: 'ignore' });
        const wrapperPath = this.wrapperPath();
        if (fs.existsSync(wrapperPath)) fs.unlinkSync(wrapperPath);
    }

    getStatus(): SchedulerStatus {
        const query = spawnSync('schtasks', ['/Query', '/TN', WINDOWS_TASK_NAME], { stdio: 'ignore' });
        return { installed: query.status === 0, schedulePath: this.wrapperPath() };
    }
}

class LinuxScheduler implements SchedulerAdapter {
    readonly kind: BackupScheduleKind = 'systemd-timer';

    private systemdDir(): string {
        return path.join(os.homedir(), '.config', 'systemd', 'user');
    }
    private servicePath(): string {
        return path.join(this.systemdDir(), `${SYSTEMD_UNIT_NAME}.service`);
    }
    private timerPath(): string {
        return path.join(this.systemdDir(), `${SYSTEMD_UNIT_NAME}.timer`);
    }
    private hasSystemd(): boolean {
        const probe = spawnSync('systemctl', ['--user', 'show-environment'], { stdio: 'ignore' });
        return !probe.error && probe.status === 0;
    }
    private hasCron(): boolean {
        const probe = spawnSync('crontab', ['-l'], { stdio: 'ignore' });
        // exit 0 (has crontab) or 1 (no crontab yet) both mean crontab is usable; ENOENT means missing.
        return !probe.error;
    }

    isSupported(): boolean {
        if (process.platform !== 'linux') return false;
        return this.hasSystemd() || this.hasCron();
    }

    install(state: BackupSchedulerState): SchedulerInstallResult {
        const dataDir = getDefaultDataDir();
        const projectRoot = process.cwd();
        const runnerPath = runnerPathFor(projectRoot);

        if (this.hasSystemd()) {
            fs.mkdirSync(this.systemdDir(), { recursive: true });
            fs.writeFileSync(this.servicePath(), buildSystemdServiceUnit({
                nodePath: process.execPath,
                runnerPath,
                projectRoot,
                dataDir,
                destinationDir: state.config.destinationDir,
            }), 'utf8');
            fs.writeFileSync(this.timerPath(), buildSystemdTimerUnit({
                hour: state.config.hour,
                minute: state.config.minute,
            }), 'utf8');
            spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
            const result = spawnSync('systemctl', ['--user', 'enable', '--now', `${SYSTEMD_UNIT_NAME}.timer`], { encoding: 'utf8' });
            if (result.status !== 0) {
                throw new Error((result.stderr || result.stdout || 'systemctl --user enable failed').trim());
            }
            return { schedulePath: this.timerPath(), kind: 'systemd-timer' };
        }

        // Fallback: crontab marker line.
        const line = buildCronLine({
            nodePath: process.execPath,
            runnerPath,
            projectRoot,
            dataDir,
            destinationDir: state.config.destinationDir,
            hour: state.config.hour,
            minute: state.config.minute,
        });
        this.writeCron([...this.readCronWithoutMarker(), line]);
        return { schedulePath: 'crontab', kind: 'cron' };
    }

    uninstall(): void {
        if (this.hasSystemd() && fs.existsSync(this.timerPath())) {
            spawnSync('systemctl', ['--user', 'disable', '--now', `${SYSTEMD_UNIT_NAME}.timer`], { stdio: 'ignore' });
            if (fs.existsSync(this.timerPath())) fs.unlinkSync(this.timerPath());
            if (fs.existsSync(this.servicePath())) fs.unlinkSync(this.servicePath());
            spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
            return;
        }
        if (this.hasCron()) {
            this.writeCron(this.readCronWithoutMarker());
        }
    }

    getStatus(): SchedulerStatus {
        if (fs.existsSync(this.timerPath())) {
            return { installed: true, schedulePath: this.timerPath() };
        }
        if (this.hasCron()) {
            const existing = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
            if ((existing.stdout || '').includes(CRON_MARKER)) {
                return { installed: true, schedulePath: 'crontab' };
            }
        }
        return { installed: false, schedulePath: null };
    }

    private readCronWithoutMarker(): string[] {
        const existing = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
        const lines = existing.status === 0 ? (existing.stdout || '').split(/\r?\n/) : [];
        return lines.filter((l) => l.trim() && !l.includes(CRON_MARKER));
    }

    private writeCron(lines: string[]): void {
        const content = lines.join('\n') + (lines.length ? '\n' : '');
        spawnSync('crontab', ['-'], { input: content, encoding: 'utf8' });
    }
}

class UnsupportedScheduler implements SchedulerAdapter {
    readonly kind: BackupScheduleKind = 'launchd';
    isSupported(): boolean {
        return false;
    }
    install(): SchedulerInstallResult {
        throw new Error('Scheduling backup non supportato su questa piattaforma.');
    }
    uninstall(): void {
        // no-op
    }
    getStatus(): SchedulerStatus {
        return { installed: false, schedulePath: null };
    }
}

export function getSchedulerAdapter(): SchedulerAdapter {
    switch (process.platform) {
        case 'darwin':
            return new MacOSScheduler();
        case 'win32':
            return new WindowsScheduler();
        case 'linux':
            return new LinuxScheduler();
        default:
            return new UnsupportedScheduler();
    }
}

/** Platform-aware status combining persisted state with the active scheduler adapter. */
export function buildBackupSchedulerStatus(value: string | null | undefined): BackupSchedulerStatus {
    const state = readBackupSchedulerStateFromValue(value);
    const adapter = getSchedulerAdapter();
    const supported = adapter.isSupported();
    const status = supported ? adapter.getStatus() : { installed: false, schedulePath: null };
    return {
        supported,
        installed: status.installed,
        plistPath: process.platform === 'darwin' ? status.schedulePath : null,
        schedulePath: status.schedulePath,
        scheduleKind: supported ? adapter.kind : null,
        state,
    };
}

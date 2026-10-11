/* @Codex */
// Cross-platform backup scheduling. The nightly backup runner
// (scripts/run-scheduled-backup.mjs) is already OS-agnostic; this module
// abstracts ONLY the OS-specific registration of a recurring job behind a
// single SchedulerAdapter interface:
//   - macOS:   launchd LaunchAgent (delegates to backup-scheduler.ts)
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
    BACKUP_SCHEDULER_COMMAND_OPTIONS,
    BackupSchedulerOutcomeUnknownError,
    assertBackupSchedulerCommand,
    readBackupLaunchAgentInstalled,
    type BackupScheduleKind,
    type BackupSchedulerState,
    type BackupSchedulerStatus,
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
    return `"${value.replaceAll('%', '%%')}"`;
}

function quoteCmdSetValue(value: string, label: string): string {
    assertNoControlChars(value, label);
    if (value.includes('"')) {
        throw new Error(`${label} cannot contain double quotes.`);
    }
    return value.replaceAll('%', '%%');
}

function quoteSystemdValue(value: string, label: string, execStart = false): string {
    assertNoControlChars(value, label);
    const escaped = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%');
    return `"${execStart ? escaped.replaceAll('$', () => '$$') : escaped}"`;
}

function systemdWorkingDirectory(value: string): string {
    assertNoControlChars(value, 'projectRoot');
    if (/[ \t\v\f]$/.test(value) || value.endsWith('\\')) {
        throw new Error('Il backup automatico non può usare questa cartella di MediFlow: il nome termina con spazi o con il carattere \\. Sposta MediFlow in una cartella con un nome diverso.');
    }
    // WorkingDirectory is a single path value, not an ExecStart argument list.
    return value.replaceAll('%', '%%');
}

function quoteShellArg(value: string, label: string): string {
    assertNoControlChars(value, label);
    return `'${value.replaceAll("'", "'\\''")}'`;
}

// Cron removes the backslash immediately before %, then passes the result to
// the shell. Split quoted chunks at % so a path's own backslash never becomes
// that escape character (including a path containing \%).
function quoteCronShellArg(value: string, label: string): string {
    return value.split('%').map((part) => quoteShellArg(part, label)).join('\\%');
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
        'setlocal DisableDelayedExpansion',
        `set "MEDIFLOW_DATA_DIR=${quoteCmdSetValue(params.dataDir, 'dataDir')}"`,
        `set "MEDIFLOW_BACKUP_DEST_DIR=${quoteCmdSetValue(params.destinationDir, 'destinationDir')}"`,
        `${quoteCmdArg(params.nodePath, 'nodePath')} ${quoteCmdArg(params.runnerPath, 'runnerPath')}`,
        'endlocal & exit /b %errorlevel%',
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
WorkingDirectory=${systemdWorkingDirectory(params.projectRoot)}
Environment=${quoteSystemdValue(`MEDIFLOW_DATA_DIR=${params.dataDir}`, 'dataDir')}
Environment=${quoteSystemdValue(`MEDIFLOW_BACKUP_DEST_DIR=${params.destinationDir}`, 'destinationDir')}
ExecStart=${quoteSystemdValue(params.nodePath, 'nodePath')} ${quoteSystemdValue(params.runnerPath, 'runnerPath', true)}
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
    const env = `MEDIFLOW_DATA_DIR=${quoteCronShellArg(params.dataDir, 'dataDir')} MEDIFLOW_BACKUP_DEST_DIR=${quoteCronShellArg(params.destinationDir, 'destinationDir')}`;
    const cmd = `cd ${quoteCronShellArg(params.projectRoot, 'projectRoot')} && ${env} ${quoteCronShellArg(params.nodePath, 'nodePath')} ${quoteCronShellArg(params.runnerPath, 'runnerPath')}`;
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
        return { installed: readBackupLaunchAgentInstalled(), schedulePath };
    }
}

class WindowsScheduler implements SchedulerAdapter {
    readonly kind: BackupScheduleKind = 'schtasks';

    private wrapperPath(): string {
        return path.join(getDefaultDataDir(), 'mediflow-scheduled-backup.cmd');
    }

    isSupported(): boolean {
        if (process.platform !== 'win32') return false;
        const probe = spawnSync('schtasks', ['/Query', '/?'], BACKUP_SCHEDULER_COMMAND_OPTIONS);
        if ((probe.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return false;
        assertBackupSchedulerCommand(probe);
        return true;
    }

    install(state: BackupSchedulerState): SchedulerInstallResult {
        this.getStatus(); // A failed read cannot authorize replacement of the wrapper.
        const dataDir = getDefaultDataDir();
        const wrapperPath = this.wrapperPath();
        const wrapper = buildWindowsWrapperCmd({
            nodePath: process.execPath,
            runnerPath: runnerPathFor(process.cwd()),
            dataDir,
            destinationDir: state.config.destinationDir,
        });
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(wrapperPath, wrapper, 'utf8');

        const args = buildSchtasksCreateArgs({
            taskName: WINDOWS_TASK_NAME,
            wrapperPath,
            hour: state.config.hour,
            minute: state.config.minute,
        });
        const result = spawnSync('schtasks', args, BACKUP_SCHEDULER_COMMAND_OPTIONS);
        assertBackupSchedulerCommand(result);
        if (!this.getStatus().installed) throw new BackupSchedulerOutcomeUnknownError();
        return { schedulePath: wrapperPath, kind: this.kind };
    }

    uninstall(): void {
        if (this.getStatus().installed) assertBackupSchedulerCommand(spawnSync('schtasks', ['/Delete', '/F', '/TN', WINDOWS_TASK_NAME], BACKUP_SCHEDULER_COMMAND_OPTIONS));
        if (this.getStatus().installed) throw new BackupSchedulerOutcomeUnknownError();
        const wrapperPath = this.wrapperPath();
        if (fs.existsSync(wrapperPath)) fs.unlinkSync(wrapperPath);
    }

    getStatus(): SchedulerStatus {
        const query = spawnSync('schtasks', ['/Query', '/FO', 'CSV', '/NH'], BACKUP_SCHEDULER_COMMAND_OPTIONS);
        assertBackupSchedulerCommand(query);
        const rows = query.stdout.trim() ? query.stdout.trim().split(/\r?\n/) : [];
        if (query.stderr.trim() || rows.some(row => !/^"(?:[^"]|"")*","(?:[^"]|"")*","(?:[^"]|"")*"$/u.test(row))) throw new BackupSchedulerOutcomeUnknownError();
        return { installed: rows.some(row => row.startsWith(`"\\${WINDOWS_TASK_NAME}",`)), schedulePath: this.wrapperPath() };
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
        const probe = spawnSync('systemctl', ['--user', 'show-environment'], BACKUP_SCHEDULER_COMMAND_OPTIONS);
        if ((probe.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return false;
        assertBackupSchedulerCommand(probe);
        return true;
    }
    private hasCron(): boolean {
        const probe = spawnSync('crontab', ['-l'], { ...BACKUP_SCHEDULER_COMMAND_OPTIONS, env: { ...process.env, LC_ALL: 'C' } });
        if ((probe.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return false;
        if (probe.error || probe.signal || (probe.status !== 0 && !(probe.status === 1 && /^no crontab for /u.test(probe.stderr.trim()) && !probe.stdout.trim()))) throw new BackupSchedulerOutcomeUnknownError();
        return true;
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
            this.readSystemdInstalled();
            const service = buildSystemdServiceUnit({
                nodePath: process.execPath,
                runnerPath,
                projectRoot,
                dataDir,
                destinationDir: state.config.destinationDir,
            });
            fs.mkdirSync(this.systemdDir(), { recursive: true });
            fs.writeFileSync(this.servicePath(), service, 'utf8');
            fs.writeFileSync(this.timerPath(), buildSystemdTimerUnit({
                hour: state.config.hour,
                minute: state.config.minute,
            }), 'utf8');
            assertBackupSchedulerCommand(spawnSync('systemctl', ['--user', 'daemon-reload'], BACKUP_SCHEDULER_COMMAND_OPTIONS));
            const result = spawnSync('systemctl', ['--user', 'enable', '--now', `${SYSTEMD_UNIT_NAME}.timer`], BACKUP_SCHEDULER_COMMAND_OPTIONS);
            assertBackupSchedulerCommand(result);
            if (!this.readSystemdInstalled()) throw new BackupSchedulerOutcomeUnknownError();
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
        const existing = this.readCronWithoutMarker();
        this.writeCron([...existing, line]);
        if (!this.getStatus().installed) throw new BackupSchedulerOutcomeUnknownError();
        return { schedulePath: 'crontab', kind: 'cron' };
    }

    uninstall(): void {
        const systemd = this.hasSystemd();
        if (!systemd && fs.existsSync(this.timerPath())) throw new BackupSchedulerOutcomeUnknownError();
        if (systemd && (this.readSystemdInstalled() || fs.existsSync(this.timerPath()))) {
            assertBackupSchedulerCommand(spawnSync('systemctl', ['--user', 'disable', '--now', `${SYSTEMD_UNIT_NAME}.timer`], BACKUP_SCHEDULER_COMMAND_OPTIONS));
            if (this.readSystemdInstalled()) throw new BackupSchedulerOutcomeUnknownError();
            if (fs.existsSync(this.timerPath())) fs.unlinkSync(this.timerPath());
            if (fs.existsSync(this.servicePath())) fs.unlinkSync(this.servicePath());
            assertBackupSchedulerCommand(spawnSync('systemctl', ['--user', 'daemon-reload'], BACKUP_SCHEDULER_COMMAND_OPTIONS));
        }
        if (this.hasCron()) {
            this.writeCron(this.readCronWithoutMarker());
        }
        if (this.getStatus().installed) throw new BackupSchedulerOutcomeUnknownError();
    }

    private readSystemdInstalled(): boolean {
        const query = spawnSync('systemctl', ['--user', 'show', `${SYSTEMD_UNIT_NAME}.timer`, '--property=LoadState,UnitFileState,ActiveState'], BACKUP_SCHEDULER_COMMAND_OPTIONS);
        assertBackupSchedulerCommand(query);
        const values = Object.fromEntries(query.stdout.trim().split(/\r?\n/).map(line => line.split('=')));
        if (query.stderr.trim() || !['loaded', 'not-found'].includes(values.LoadState)
            || typeof values.UnitFileState !== 'string' || typeof values.ActiveState !== 'string') throw new BackupSchedulerOutcomeUnknownError();
        if (values.LoadState === 'loaded' && (['enabled', 'enabled-runtime'].includes(values.UnitFileState) || values.ActiveState === 'active')) return true;
        if (values.ActiveState === 'inactive' && ['', 'disabled', 'static', 'masked'].includes(values.UnitFileState)) return false;
        throw new BackupSchedulerOutcomeUnknownError();
    }

    getStatus(): SchedulerStatus {
        const systemd = this.hasSystemd();
        if (!systemd && fs.existsSync(this.timerPath())) throw new BackupSchedulerOutcomeUnknownError();
        if (systemd && this.readSystemdInstalled()) return { installed: true, schedulePath: this.timerPath() };
        if (this.hasCron() && this.readCron().some(line => line.trimEnd().endsWith(CRON_MARKER))) return { installed: true, schedulePath: 'crontab' };
        return { installed: false, schedulePath: null };
    }

    private readCron(): string[] {
        const existing = spawnSync('crontab', ['-l'], { ...BACKUP_SCHEDULER_COMMAND_OPTIONS, env: { ...process.env, LC_ALL: 'C' } });
        if (!existing.error && !existing.signal && existing.status === 1 && /^no crontab for /u.test(existing.stderr.trim()) && !existing.stdout.trim()) return [];
        assertBackupSchedulerCommand(existing);
        if (existing.stderr.trim()) throw new BackupSchedulerOutcomeUnknownError();
        return existing.stdout.split(/\r?\n/);
    }
    private readCronWithoutMarker(): string[] {
        return this.readCron().filter(line => line.trim() && !line.trimEnd().endsWith(CRON_MARKER));
    }

    private writeCron(lines: string[]): void {
        const content = lines.join('\n') + (lines.length ? '\n' : '');
        assertBackupSchedulerCommand(spawnSync('crontab', ['-'], { ...BACKUP_SCHEDULER_COMMAND_OPTIONS, input: content }));
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
    let supported = true;
    let status: { installed: boolean | null; schedulePath: string | null; observationMessage?: string };
    try {
        supported = adapter.isSupported();
        status = supported ? adapter.getStatus() : { installed: false, schedulePath: null };
    } catch (error) {
        if (!(error instanceof BackupSchedulerOutcomeUnknownError)) throw error;
        status = { installed: null, schedulePath: null, observationMessage: error.message };
    }
    return {
        supported,
        installed: status.installed,
        ...(status.observationMessage ? { observationMessage: status.observationMessage } : {}),
        plistPath: process.platform === 'darwin' ? status.schedulePath : null,
        schedulePath: status.schedulePath,
        scheduleKind: supported ? adapter.kind : null,
        state,
    };
}

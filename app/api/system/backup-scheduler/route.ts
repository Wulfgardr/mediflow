/* @Codex */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { settings } from '@/lib/schema';
import { forbiddenResponse, requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
/* @Codex */
import { isWebAdminSession } from '@/lib/security/server-auth-policy';
import { auditContextFromSession, requestIdFromRequest, withAuditContextMetadata, writeAuditEvent } from '@/lib/security/audit';
import {
    BACKUP_SCHEDULER_SETTINGS_KEY,
    applyBackupRetention,
    applyRetentionResultToState,
    mergeBackupSchedulerConfig,
    previewBackupRetention,
    readBackupSchedulerStateFromValue,
    runBackupSchedulerScript,
} from '@/lib/backup-scheduler';
/* @Codex */
import { buildBackupSchedulerStatus, getSchedulerAdapter } from '@/lib/backup-scheduler-adapter';

export const dynamic = 'force-dynamic';

async function loadSchedulerSettingValue(): Promise<string | null> {
    const row = await dbServer.select().from(settings).where(eq(settings.key, BACKUP_SCHEDULER_SETTINGS_KEY)).get();
    return row?.value ?? null;
}

async function saveSchedulerSettingValue(value: string): Promise<void> {
    await dbServer
        .insert(settings)
        .values({ key: BACKUP_SCHEDULER_SETTINGS_KEY, value })
        .onConflictDoUpdate({ target: settings.key, set: { value } });
}

export async function GET() {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (!isWebAdminSession(session)) return forbiddenResponse();

    try {
        const value = await loadSchedulerSettingValue();
        return NextResponse.json(buildBackupSchedulerStatus(value));
    } catch (error) {
        console.error('GET backup scheduler status failed:', error);
        return NextResponse.json({ error: 'Failed to load backup scheduler status.' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (!isWebAdminSession(session)) return forbiddenResponse();

    try {
        const body = await request.json();
        const action = typeof body?.action === 'string' ? body.action : 'save';
        const currentValue = await loadSchedulerSettingValue();
        const currentState = readBackupSchedulerStateFromValue(currentValue);
        const configPatch = body?.config && typeof body.config === 'object'
            ? body.config as Record<string, unknown>
            : {};
        const draftState = mergeBackupSchedulerConfig(currentState, {
            enabled: typeof configPatch.enabled === 'boolean' ? configPatch.enabled : currentState.config.enabled,
            hour: configPatch.hour as number | undefined,
            minute: configPatch.minute as number | undefined,
            destinationDir: configPatch.destinationDir as string | undefined,
            retentionKeepArtifacts: configPatch.retentionKeepArtifacts as number | undefined,
        });

        if (action === 'run-now') {
            const result = runBackupSchedulerScript({
                force: true,
                destinationDir: currentState.config.destinationDir,
            });
            const refreshedValue = await loadSchedulerSettingValue();
            return NextResponse.json(
                {
                    result,
                    status: buildBackupSchedulerStatus(refreshedValue),
                },
                { status: result.ok ? 200 : 500 },
            );
        }

        if (action === 'preview-retention') {
            return NextResponse.json({
                retention: previewBackupRetention(draftState.config),
            });
        }

        if (action === 'apply-retention') {
            const retention = applyBackupRetention(draftState.config);
            const nextState = applyRetentionResultToState(draftState, retention, 'manual');
            await saveSchedulerSettingValue(JSON.stringify(nextState));

            return NextResponse.json({
                retention,
                status: buildBackupSchedulerStatus(JSON.stringify(nextState)),
            });
        }

        const nextState = draftState;

        /* @Codex */
        const adapter = getSchedulerAdapter();
        if (nextState.config.enabled) {
            if (!adapter.isSupported()) {
                return NextResponse.json(
                    {
                        error: 'Scheduling automatico del backup non disponibile su questa piattaforma.',
                        detail: `Nessuno scheduler supportato rilevato su ${process.platform} (launchd su macOS, Task Scheduler su Windows, systemd-timer o cron su Linux). Il backup manuale "Esegui adesso" e la retention restano disponibili.`,
                        supported: false,
                    },
                    { status: 501 },
                );
            }
            adapter.install(nextState);
        } else {
            adapter.uninstall();
        }

        await saveSchedulerSettingValue(JSON.stringify(nextState));

        try {
            const context = auditContextFromSession(session);
            await writeAuditEvent({
                eventType: 'settings.updated',
                outcome: 'success',
                actorType: context.actorType,
                actorRef: context.actorRef,
                subjectType: 'settings',
                subjectRef: BACKUP_SCHEDULER_SETTINGS_KEY,
                sourceSurface: context.sourceSurface,
                requestId: requestIdFromRequest(request),
                redactedMetadata: withAuditContextMetadata(context, {
                    changedFields: ['enabled', 'hour', 'minute', 'destinationDir', 'retentionKeepArtifacts'],
                    flags: [`action:${action}`],
                }),
            });
        } catch (error) {
            console.error('Audit backup scheduler write failed:', error);
        }

        return NextResponse.json(buildBackupSchedulerStatus(JSON.stringify(nextState)));
    } catch (error) {
        console.error('POST backup scheduler failed:', error);
        const message = error instanceof Error ? error.message : 'Failed to save backup scheduler settings.';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

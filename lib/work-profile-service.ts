/* @Codex */
import 'server-only';
import { eq } from 'drizzle-orm';
import { dbServer, runDbServerImmediateTransaction } from './db-server';
import { settings } from './schema';
import {
    applyWorkProfileCommand, emptyWorkProfileState, parseWorkProfileState,
    WORK_PROFILE_SETTING_KEY, WorkProfileError, type WorkProfileState,
} from './work-profile';

export function readWorkProfile(): WorkProfileState {
    const row = dbServer.select().from(settings).where(eq(settings.key, WORK_PROFILE_SETTING_KEY)).get();
    if (!row) return emptyWorkProfileState();
    try { return parseWorkProfileState(JSON.parse(row.value)); }
    catch { throw new WorkProfileError('state_invalid'); }
}

export function updateWorkProfile(input: unknown): WorkProfileState {
    return runDbServerImmediateTransaction(() => {
        const current = readWorkProfile();
        const next = applyWorkProfileCommand(current, input);
        if (next !== current) {
            const value = JSON.stringify(next);
            dbServer.insert(settings).values({ key: WORK_PROFILE_SETTING_KEY, value })
                .onConflictDoUpdate({ target: settings.key, set: { value } }).run();
        }
        return next;
    });
}

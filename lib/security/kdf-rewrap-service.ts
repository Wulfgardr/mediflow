import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import type { dbServer as dbServerType } from '@/lib/db-server';
import { users } from '@/lib/schema';
import type { KdfRewrapPayload } from '@/lib/security/kdf-rewrap-validation';

/**
 * Stores a stronger PIN wrapping of the same master key. Returns false, having written nothing,
 * when the account unlocks with a passphrase (ADR 0143): a session must not be able to put a
 * PIN wrapping back in place of the passphrase one.
 */
export function persistKdfRewrap(db: typeof dbServerType, userId: string, payload: KdfRewrapPayload): boolean {
    return db.update(users)
        .set({ encryptedMasterKey: payload.encryptedMasterKey, salt: payload.salt })
        .where(and(eq(users.id, userId), isNull(users.unlockVerifierHash)))
        .run().changes === 1;
}

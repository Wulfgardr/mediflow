import type Database from 'better-sqlite3';
import { assertAmbulatoryCommandPredecessorRecoverySchema } from './ambulatory-destructive-command-recovery-schema';

export function assertTherapyCommandPredecessorRecoverySchema(probe: Database.Database): void {
    if (probe.pragma('user_version', { simple: true }) !== 4) throw new Error('Recovery predecessor is not v4');
    assertAmbulatoryCommandPredecessorRecoverySchema(probe);
}

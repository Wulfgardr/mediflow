import { NextResponse } from 'next/server';
import encryptedFields from '../../backup-encrypted-fields.json';
import { isSealedValue } from '../../network-patient-lifecycle';

type Table = 'patients' | 'entries' | 'therapies' | 'observations' | 'checkups';

export function rejectUnsealedV1Write(table: Table, values: Record<string, unknown>) {
    const field = encryptedFields[table].find(name => values[name] !== undefined
        && values[name] !== null && !isSealedValue(values[name]));
    return field ? NextResponse.json({ error: `Field ${field} must be sealed with ENC:`, code: 'ENCRYPTED_FIELD_REQUIRED' }, { status: 422 }) : null;
}

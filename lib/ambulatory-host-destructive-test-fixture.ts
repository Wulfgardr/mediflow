import { dbServer } from './db-server';
import { parseExpectedVersion } from './ambulatory-concurrency';
import { clearAmbulatoryInTransaction, deleteAmbulatoryInTransaction, type AmbulatoryMutationResponse, type HostAmbulatoryContext } from './ambulatory-write';
import { VersionExhaustedError } from './version-concurrency';

export function deleteAmbulatory(context: HostAmbulatoryContext, id: string, expectedVersion: unknown): AmbulatoryMutationResponse {
    const parsedVersion = parseExpectedVersion(expectedVersion);
    if (parsedVersion === null) return { status: 400, value: { error: 'Version is required' } };
    return dbServer.transaction((tx): AmbulatoryMutationResponse => deleteAmbulatoryInTransaction(tx, context, id, parsedVersion, 'host', undefined), { behavior: 'immediate' });
}

export async function clearAmbulatory(context: HostAmbulatoryContext, ambulatoryId: string, expectedVersion: unknown): Promise<AmbulatoryMutationResponse> {
    const parsedVersion = parseExpectedVersion(expectedVersion);
    if (parsedVersion === null) return { status: 400, value: { error: 'Version is required' } };
    if (context.session.role !== 'admin') return { status: 403, value: { error: 'Forbidden' } };
    try {
        return dbServer.transaction((tx): AmbulatoryMutationResponse => clearAmbulatoryInTransaction(tx, context, ambulatoryId, parsedVersion, 'host', undefined), { behavior: 'immediate' });
    } catch (error) {
        if (error instanceof VersionExhaustedError) return { status: 409, value: { error: 'Patient version cannot advance safely' } };
        throw error;
    }
}

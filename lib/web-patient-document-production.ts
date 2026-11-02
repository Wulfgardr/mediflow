import 'server-only';
import { eq } from 'drizzle-orm';
import { dbServer } from './db-server';
import { ambulatories } from './schema';
import { createWebPatientDocumentService } from './web-patient-document';

export const webPatientDocumentService = createWebPatientDocumentService(dbServer);

/** The selected ambulatory, or the default one, as the existing create flow captures it. */
export function webPatientDocumentScope(selected: string | undefined): string | null {
    const target = selected
        ? dbServer.select({ id: ambulatories.id }).from(ambulatories).where(eq(ambulatories.id, selected)).get()
        : dbServer.select({ id: ambulatories.id }).from(ambulatories).where(eq(ambulatories.isDefault, true)).limit(1).get();
    return target?.id ?? null;
}

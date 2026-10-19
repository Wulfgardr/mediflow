import 'server-only';

import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { dbServer } from './db-server';
import { patients, patientsToAmbulatories } from './schema';
import { activePatients } from './patient-lifecycle';
import { prepareNetworkPatientCommitGuard } from './network-patient-commit-authority';
import type { NetworkWriteContext } from './network-write-context';
import { NETWORK_EXPECTED_SCOPE_HEADER } from './network-request-scope';
import { archiveGenerationForSession } from './security/archive-session-generation';
import { ArchiveReplacedError } from './archive-generation';
import { apiFailure } from './api-error-response';
import {
    buildPopulationDemographics, parsePopulationDemographicsQuery, POPULATION_DEMOGRAPHICS_CAPABILITY,
    POPULATION_DEMOGRAPHICS_MAX_BYTES, POPULATION_DEMOGRAPHICS_OPERATION, type PopulationDemographicsResult,
} from './population-demographics';

/** Called after ordinary paired admission; the existing guard authenticates the original owner again. */
export async function readNetworkPopulationDemographics(context: NetworkWriteContext): Promise<NextResponse> {
    const { request } = context;
    const query = parsePopulationDemographicsQuery(new URL(request.url));
    if (!query) return apiFailure('ANALYTICS_INVALID_QUERY', 'Controlla la fascia di età e il fuso orario della lettura.', 400);
    if (request.headers.get(NETWORK_EXPECTED_SCOPE_HEADER) !== encodeURIComponent(context.scopeAmbulatoryId)) {
        return apiFailure('ANALYTICS_SCOPE_UNAVAILABLE', 'Seleziona nuovamente l’ambulatorio prima di leggere l’analisi.', 403);
    }
    const generation = archiveGenerationForSession(context.session);
    if (!generation || request.headers.get('x-mediflow-archive-generation') !== generation) throw new ArchiveReplacedError();
    const current = await prepareNetworkPatientCommitGuard(context, POPULATION_DEMOGRAPHICS_CAPABILITY);
    // A single read transaction binds membership and counts to the same snapshot.
    // Every await precedes these current-owner checks, and no writer is invoked.
    return dbServer.transaction(tx => {
        const denied = current(tx);
        if (denied) return NextResponse.json(denied.value, { status: denied.status, headers: { 'Cache-Control': 'no-store' } });
        if (request.signal.aborted) return apiFailure('ANALYTICS_CANCELLED', 'La lettura è stata annullata.', 409);
        const observedAt = new Date();
        const projection = tx.select({ birthDate: patients.birthDate, isAdi: patients.isAdi, isArchived: patients.isArchived })
            .from(patients).innerJoin(patientsToAmbulatories, eq(patients.id, patientsToAmbulatories.patientId))
            .where(and(eq(patientsToAmbulatories.ambulatoryId, context.scopeAmbulatoryId), activePatients())).all();
        const result: PopulationDemographicsResult = {
            operation: POPULATION_DEMOGRAPHICS_OPERATION, contractVersion: 1,
            scope: { ambulatoryId: context.scopeAmbulatoryId, archiveGeneration: generation },
            ageRange: query.ageRange, timeZone: query.timeZone, observedAt: observedAt.toISOString(),
            stats: buildPopulationDemographics(projection.map(row => ({ birthDate: row.birthDate,
                isAdi: row.isAdi ?? false, isArchived: row.isArchived ?? false })), query, observedAt),
        };
        const output = JSON.stringify(result);
        const finalDenial = current(tx);
        if (finalDenial) return NextResponse.json(finalDenial.value, { status: finalDenial.status, headers: { 'Cache-Control': 'no-store' } });
        if (request.signal.aborted) return apiFailure('ANALYTICS_CANCELLED', 'La lettura è stata annullata.', 409);
        if (Buffer.byteLength(output, 'utf8') > POPULATION_DEMOGRAPHICS_MAX_BYTES) {
            return apiFailure('ANALYTICS_OUTPUT_TOO_LARGE', 'Il risultato supera il limite previsto per questa lettura.', 413);
        }
        return new NextResponse(output, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    });
}

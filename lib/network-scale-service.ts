/** The paired scale boundary only reads. The ordinary diary owns every clinical write. */
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { dbServer } from './db-server';
import { patients, patientsToAmbulatories } from './schema';
import { activePatients } from './patient-lifecycle';
import { NETWORK_CATALOG_READ_CAPABILITY } from './network-catalog-read';
import { prepareNetworkPatientCommitGuard } from './network-patient-commit-authority';
import type { NetworkWriteContext } from './network-write-context';
import { nativeProfileSelectionOwner } from './security/native-profile-selection-owner';
import { serverSessionProjectionOwnerProductionOwner } from './security/server-session-projection-owner-production-internal';
import { ServerSessionProjectionOwnerError } from './security/server-session-projection-owner';
import { apiFailure, archiveReplacementResponse } from './api-error-response';
import { readNativeNetworkJson, jsonBodyTooLargeResponse } from './native-network-json-body';
import { readScaleCatalog, SCALE_PREPARATION_MAX_BYTES, SCALE_PREPARATION_VERSION } from './scale-catalog';
import { prepareScaleSubmission, type PreparedScaleSubmission } from './scale-submission';
import { ScaleValidationError } from './scale-validation';

export const NETWORK_SCALE_PATIENT_CAPABILITY = 'network.replica.readonly-patients';
const PREPARE_CAPABILITIES = Object.freeze([NETWORK_CATALOG_READ_CAPABILITY, NETWORK_SCALE_PATIENT_CAPABILITY]);
const INPUT_FIELDS = ['contractVersion', 'scaleId', 'answers', 'expectedCatalogRevision', 'expectedPatientVersion', 'expectedSelectionEpoch'];

type ScalePreparationInput = Readonly<{
    contractVersion: 1; scaleId: string; answers: Record<string, number>;
    expectedCatalogRevision: string; expectedPatientVersion: number; expectedSelectionEpoch: number;
}>;
export type NetworkScalePreparation = Readonly<{
    contractVersion: 1; preparationVersion: string; catalogRevision: string; status: 'draft';
    context: Readonly<{ patientId: string; ambulatoryId: string; patientVersion: number; selectionEpoch: number }>;
    submission: PreparedScaleSubmission;
}>;

function parseInput(value: unknown): ScalePreparationInput | null {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== INPUT_FIELDS.length || keys.some(key => typeof key !== 'string' || !INPUT_FIELDS.includes(key))) return null;
    const input = value as Record<string, unknown>;
    if (input.contractVersion !== 1 || typeof input.scaleId !== 'string' || !input.scaleId || input.scaleId.length > 160
        || typeof input.expectedCatalogRevision !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(input.expectedCatalogRevision)
        || !Number.isSafeInteger(input.expectedPatientVersion) || (input.expectedPatientVersion as number) < 1
        || !Number.isSafeInteger(input.expectedSelectionEpoch) || (input.expectedSelectionEpoch as number) < 0
        || !input.answers || typeof input.answers !== 'object' || Array.isArray(input.answers)
        || Object.getPrototypeOf(input.answers) !== Object.prototype
        || Object.values(input.answers).some(answer => typeof answer !== 'number' || !Number.isFinite(answer))) return null;
    return input as ScalePreparationInput;
}

export function scaleNoStore<T extends Response>(response: T): T {
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

function inputFailure() { return apiFailure('SCALE_INPUT_INVALID', 'Richiesta di valutazione non valida.', 400); }
function contextFailure() { return apiFailure('SCALE_CONTEXT_CONFLICT', 'Il contesto è cambiato. Rileggi la scheda e prepara di nuovo la valutazione.', 409); }

export function networkScaleFailure(error: unknown): Response {
    const replacement = archiveReplacementResponse(error); if (replacement) return replacement;
    const tooLarge = jsonBodyTooLargeResponse(error); if (tooLarge) return scaleNoStore(tooLarge);
    if (error instanceof SyntaxError || error instanceof ScaleValidationError) return inputFailure();
    if (error instanceof ServerSessionProjectionOwnerError) {
        if (['session_ineligible', 'session_unavailable', 'owner_disposed'].includes(error.code)) {
            return apiFailure('SCALE_SESSION_UNAVAILABLE', 'Sessione non disponibile.', 401);
        }
        return contextFailure();
    }
    // Calculation inputs and exception details never enter the response, logs or audit.
    return apiFailure('SCALE_UNAVAILABLE', 'Valutazione non disponibile.', 503);
}

export async function readNetworkScaleCatalog(context: NetworkWriteContext): Promise<Response> {
    if (new URL(context.request.url).search) return inputFailure();
    const guard = await prepareNetworkPatientCommitGuard(context, NETWORK_CATALOG_READ_CAPABILITY);
    return dbServer.transaction(tx => {
        if (context.request.signal.aborted) return contextFailure();
        const denial = guard(tx); if (denial) return scaleNoStore(NextResponse.json(denial.value, { status: denial.status }));
        return scaleNoStore(NextResponse.json(readScaleCatalog()));
    });
}

export async function prepareNetworkScale(context: NetworkWriteContext, patientId: string): Promise<Response> {
    if (!context.pairedClient.grantedCapabilities.includes(NETWORK_SCALE_PATIENT_CAPABILITY)) {
        return apiFailure('SCALE_SCOPE_DENIED', 'Accesso non consentito.', 403);
    }
    if (new URL(context.request.url).search || !patientId || patientId.length > 160 || patientId.trim() !== patientId) return inputFailure();
    const input = parseInput(await readNativeNetworkJson(context.request, SCALE_PREPARATION_MAX_BYTES));
    if (!input) return inputFailure();
    const guard = await prepareNetworkPatientCommitGuard(context, PREPARE_CAPABILITIES);
    return dbServer.transaction(tx => {
        if (context.request.signal.aborted) return contextFailure();
        const denial = guard(tx); if (denial) return scaleNoStore(NextResponse.json(denial.value, { status: denial.status }));
        const catalog = readScaleCatalog();
        if (input.expectedCatalogRevision !== catalog.catalogRevision) {
            return apiFailure('SCALE_CATALOG_CONFLICT', 'Il catalogo è cambiato. Rileggilo prima di preparare la valutazione.', 409);
        }
        const patient = tx.select({ version: patients.version }).from(patients)
            .innerJoin(patientsToAmbulatories, eq(patients.id, patientsToAmbulatories.patientId))
            .where(and(eq(patients.id, patientId), activePatients(), eq(patientsToAmbulatories.ambulatoryId, context.scopeAmbulatoryId))).get();
        if (!patient) return apiFailure('SCALE_SCOPE_DENIED', 'Accesso non consentito.', 403);
        if (patient.version !== input.expectedPatientVersion) return contextFailure();
        const process = context.session.authChannel === 'native' ? nativeProfileSelectionOwner : serverSessionProjectionOwnerProductionOwner;
        const owner = process.registry.acquire(context.session);
        if (owner.snapshotSelectionEpoch(context.session) !== input.expectedSelectionEpoch) return contextFailure();
        return owner.withLeaseCriticalSection(context.session, selection => {
            if (selection.patientId !== patientId || selection.ambulatoryId !== context.scopeAmbulatoryId) return contextFailure();
            const submission = prepareScaleSubmission(input.scaleId, input.answers);
            const result: NetworkScalePreparation = { contractVersion: 1, preparationVersion: SCALE_PREPARATION_VERSION,
                catalogRevision: catalog.catalogRevision, status: 'draft',
                context: { patientId, ambulatoryId: context.scopeAmbulatoryId, patientVersion: patient.version, selectionEpoch: input.expectedSelectionEpoch },
                submission };
            return scaleNoStore(NextResponse.json(result));
        });
    });
}

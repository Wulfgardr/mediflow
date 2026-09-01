/* @Codex */
import 'server-only';

import { and, eq } from 'drizzle-orm';
import type { dbServer } from '../db-server';
import { ambulatories, patients, patientsToAmbulatories } from '../schema';
import type { ServerSession } from './server-session';
import {
    abortResourceUse,
    beginResourceUse,
    commitResourceUse,
    mintResourcePort,
    releaseResourcePort,
    type WebResourcePort,
    type WebResourceUse,
} from './web-auth-lifecycle-owner-adapter';

type ClinicalContextDatabase = Pick<typeof dbServer, 'select'>;

export type ServerSessionClinicalContextErrorCode =
    | 'ambulatory_missing' | 'input_invalid' | 'membership_missing' | 'patient_missing'
    | 'patient_version_invalid' | 'session_ineligible';

export class ServerSessionClinicalContextError extends Error {
    constructor(readonly code: ServerSessionClinicalContextErrorCode) {
        super(`Server session clinical context rejected: ${code}`);
        this.name = 'ServerSessionClinicalContextError';
    }
}

function fail(code: ServerSessionClinicalContextErrorCode): never {
    throw new ServerSessionClinicalContextError(code);
}

function parseRequest(input: unknown): Readonly<{ patientId: string; ambulatoryId: string }> {
    if (typeof input !== 'object' || input === null || Array.isArray(input)
        || Object.getPrototypeOf(input) !== Object.prototype) fail('input_invalid');
    const keys = Reflect.ownKeys(input);
    if (keys.length !== 2 || keys.some((key) => key !== 'patientId' && key !== 'ambulatoryId')) {
        fail('input_invalid');
    }
    const patient = Object.getOwnPropertyDescriptor(input, 'patientId');
    const ambulatory = Object.getOwnPropertyDescriptor(input, 'ambulatoryId');
    if (!patient || !('value' in patient) || !ambulatory || !('value' in ambulatory)) fail('input_invalid');
    const validId = (value: unknown): value is string => typeof value === 'string'
        && value.length > 0 && value.length <= 160 && value.trim() === value;
    if (!validId(patient.value) || !validId(ambulatory.value)) fail('input_invalid');
    return Object.freeze({ patientId: patient.value, ambulatoryId: ambulatory.value });
}

export function createCanonicalClinicalContextResolver(database: ClinicalContextDatabase) {
    return (session: ServerSession, input: unknown) => {
        const request = parseRequest(input);
        let port: WebResourcePort | null = null;
        let use: WebResourceUse | null = null;
        let committed = false;
        try {
            port = mintResourcePort(session);
            if (!port) return fail('session_ineligible');
            use = beginResourceUse(port);
            if (!use || session.authChannel !== 'web' || session.id === 'local-api') return fail('session_ineligible');
            const patient = database.select({ id: patients.id, version: patients.version })
                .from(patients).where(eq(patients.id, request.patientId)).get();
            if (!patient) return fail('patient_missing');
            if (!Number.isSafeInteger(patient.version) || patient.version < 1) return fail('patient_version_invalid');
            const ambulatory = database.select({ id: ambulatories.id })
                .from(ambulatories).where(eq(ambulatories.id, request.ambulatoryId)).get();
            if (!ambulatory) return fail('ambulatory_missing');
            const membership = database.select({ patientId: patientsToAmbulatories.patientId })
                .from(patientsToAmbulatories)
                .where(and(
                    eq(patientsToAmbulatories.patientId, patient.id),
                    eq(patientsToAmbulatories.ambulatoryId, ambulatory.id),
                )).get();
            if (!membership) return fail('membership_missing');
            committed = commitResourceUse(use);
            if (!committed) return fail('session_ineligible');
            return Object.freeze({ patientId: patient.id, ambulatoryId: ambulatory.id, patientVersion: patient.version });
        } finally {
            if (use && !committed) abortResourceUse(use);
            if (port) releaseResourcePort(port);
        }
    };
}

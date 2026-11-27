import type { Checkup, ClinicalEntry, Observation, Patient, Therapy } from './db';
import { clinicalRichTextToPlainText } from './clinical-rich-text';
import { patientAllergiesSchema } from './patient-allergies';
import { clientArchiveGeneration } from './security/client-auth-api';
import {
    normalizeAgentPatientTaxCode,
    parseAgentPatientContextInput,
    type AgentPatientContextIdentity,
    type AgentPatientContextInput,
    type AgentPatientContextRequest,
} from './agent-local-kit-context-contract';

function toIsoDate(value: Date | string | null | undefined): string | undefined {
    if (!value) return undefined;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;
    return date.toISOString().slice(0, 10);
}

export async function buildAgentPatientContextPayload(input: {
    patient: Patient;
    entries: readonly ClinicalEntry[];
    therapies: readonly Therapy[];
    observations: readonly Observation[];
    checkups: readonly Checkup[];
    exemptionCodes: readonly string[];
}): Promise<AgentPatientContextInput | null> {
    const normalizedTaxCode = normalizeAgentPatientTaxCode(input.patient.taxCode ?? '');
    if (normalizedTaxCode.length < 4) return null;

    const taxCodeLast4 = normalizedTaxCode.slice(-4);

    const diagnoses = (Array.isArray(input.patient.diagnoses) ? input.patient.diagnoses : [])
        .filter(item => Boolean(item?.description?.trim()))
        .slice(0, 50)
        .map(item => ({
            description: item.description.trim().slice(0, 300),
            ...(item.code?.trim() ? { code: item.code.trim().slice(0, 40) } : {}),
            ...(item.system?.trim() ? { system: item.system.trim().slice(0, 24) } : {}),
            ...(toIsoDate(item.date) ? { date: toIsoDate(item.date) } : {}),
        }));

    const therapies = input.therapies
        .filter(item => !item.deletedAt && Boolean(item.drugName?.trim()) && Boolean(item.dosage?.trim()))
        .slice()
        .sort((left, right) => {
            if (left.status === 'active' && right.status !== 'active') return -1;
            if (left.status !== 'active' && right.status === 'active') return 1;
            return (right.startDate ? new Date(right.startDate).getTime() : 0)
                - (left.startDate ? new Date(left.startDate).getTime() : 0);
        })
        .slice(0, 60)
        .map(item => ({
            drugName: item.drugName.trim().slice(0, 200),
            ...(item.activePrinciple?.trim() ? { activePrinciple: item.activePrinciple.trim().slice(0, 200) } : {}),
            dosage: item.dosage.trim().slice(0, 300),
            status: item.status,
            ...(toIsoDate(item.startDate) ? { startDate: toIsoDate(item.startDate) } : {}),
        }));

    const exemptions = [...new Set(
        input.exemptionCodes
            .map(code => code.trim().toUpperCase())
            .filter(Boolean),
    )].slice(0, 30).map(code => ({ code: code.slice(0, 40) }));

    const parsedAllergies = patientAllergiesSchema.safeParse(input.patient.allergies ?? []);
    const allergies = parsedAllergies.success
        ? parsedAllergies.data.slice(0, 30).map(item => ({
            substance: item.substance.trim().slice(0, 200),
            ...(item.reaction?.trim() ? { reaction: item.reaction.trim().slice(0, 200) } : {}),
            ...(item.severity ? { severity: item.severity } : {}),
        }))
        : [];

    const observations = input.observations
        .filter(item => !item.deletedAt && Boolean(item.display?.trim()) && Boolean(item.unitCode?.trim()) && String(item.value ?? '').trim().length > 0)
        .slice()
        .sort((left, right) => new Date(right.observedAt).getTime() - new Date(left.observedAt).getTime())
        .slice(0, 40)
        .map(item => ({
            display: item.display.trim().slice(0, 160),
            value: String(item.value).trim().slice(0, 80),
            unit: item.unitCode.trim().slice(0, 40),
            ...(item.code?.trim() ? { code: item.code.trim().slice(0, 40) } : {}),
            ...(toIsoDate(item.observedAt) ? { observedAt: toIsoDate(item.observedAt) } : {}),
        }));

    const recentNotes = input.entries
        .filter(item => !item.deletedAt && item.type !== 'scale')
        .slice()
        .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
        .map(item => {
            const date = toIsoDate(item.date);
            const text = clinicalRichTextToPlainText(item.content).slice(0, 2000).trim();
            if (!date || !text) return null;
            return {
                date,
                ...(item.title?.trim() ? { title: item.title.trim().slice(0, 200) } : {}),
                text,
            };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .slice(0, 6);

    const openCheckups = input.checkups
        .filter(item => !item.deletedAt && item.status !== 'completed' && item.status !== 'cancelled' && Boolean(item.title?.trim()))
        .slice(0, 20)
        .map(item => ({
            title: item.title.trim().slice(0, 240),
            ...(item.status ? { status: item.status } : {}),
        }));

    return parseAgentPatientContextInput({
        patient: {
            taxCodeLast4,
            ...(input.patient.isAdi === true ? { isAdi: true } : {}),
        },
        diagnoses,
        therapies,
        exemptions,
        allergies,
        observations,
        recentNotes,
        openCheckups,
    });
}

function optionalIdentity(value: string | null | undefined): string | null {
    return value?.trim() ? value.trim() : null;
}

export function agentPatientContextIdentity(patient: Patient): AgentPatientContextIdentity {
    const birthDate = patient.birthDate ? new Date(patient.birthDate) : null;
    return {
        firstName: patient.firstName ?? '',
        lastName: patient.lastName ?? '',
        taxCode: patient.taxCode ?? '',
        birthDate: birthDate && !Number.isNaN(birthDate.getTime()) ? birthDate.toISOString() : null,
        address: optionalIdentity(patient.address),
        phone: optionalIdentity(patient.phone),
        caregiver: optionalIdentity(patient.caregiver),
    };
}

export async function sendPatientContextToLocalKit(
    payload: AgentPatientContextInput,
    patient: Patient,
): Promise<{ ok: true; expiresAt: number } | { ok: false; code: string }> {
    const request: AgentPatientContextRequest = { context: payload, identity: agentPatientContextIdentity(patient) };
    const response = await fetch('/api/agent-mandates/local-kit/context', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-mediflow-archive-generation': clientArchiveGeneration(),
        },
        body: JSON.stringify(request),
    });
    if (!response.ok) {
        try {
            const body = await response.json() as { code?: unknown };
            return { ok: false, code: typeof body?.code === 'string' ? body.code : 'REQUEST_FAILED' };
        } catch {
            return { ok: false, code: 'REQUEST_FAILED' };
        }
    }
    const body = await response.json() as { expiresAt?: unknown };
    return {
        ok: true,
        expiresAt: typeof body?.expiresAt === 'number' ? body.expiresAt : Date.now(),
    };
}

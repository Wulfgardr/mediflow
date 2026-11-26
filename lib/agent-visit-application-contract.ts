import { z } from 'zod';
import { dateInputSchema } from './api-schemas/common';
import { therapyCreateSchema } from './api-schemas/clinical-writes';
import { servicePrescriptionCreateSchema } from './api-schemas/prescriptions';
import type { AgentCassette } from './agent-cassette-contract';
import { clinicalContentAllowed } from './agent-mandate-contract';

export type AgentCassetteIndexEntry = Pick<AgentCassette, 'id' | 'archiveGeneration' | 'status' | 'revision' | 'depositedAt'>;
export type AgentCassetteIndexPage = { visits: AgentCassetteIndexEntry[]; next: string | null };
export type IncomingAgentCassette = AgentCassette & { appliedItemIds: string[]; discardedItemIds?: string[]; correctedItemIds?: string[] };

const sealed = z.string().regex(/^ENC:[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/u);
const noteValues = z.object({ title: sealed, content: sealed, date: dateInputSchema, metadata: sealed }).strict();
const id = z.string().uuid();
export const newAgentPatientSchema = z.object({
    ambulatoryId: z.string().min(1).max(256),
    taxCode: z.string().regex(/^[A-Z0-9]{16}$/u),
    birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).nullable(),
}).strict();
export type NewAgentPatient = z.output<typeof newAgentPatientSchema>;
export const agentApplicationItemSchema = z.discriminatedUnion('kind', [
    z.object({ id, kind: z.literal('note'), values: noteValues }).strict(),
    z.object({ id, kind: z.literal('transcription'), values: noteValues }).strict(),
    z.object({ id, kind: z.literal('pdf'), values: z.object({ name: sealed, size: z.number().int().positive(),
        data: z.string().regex(/^ENC2:/u) }).strict() }).strict(),
    z.object({ id, kind: z.literal('therapy'), values: therapyCreateSchema.omit({ id: true, patientId: true }).strict() }).strict(),
    z.object({ id, kind: z.literal('service'), values: servicePrescriptionCreateSchema.omit({ id: true, patientId: true }).extend({
        lineItems: z.array(z.object({ serviceName: sealed }).strict()).max(128).default([]),
    }).strict() }).strict(),
    z.object({ id, kind: z.literal('diagnosis'), values: z.object({ diagnoses: sealed }).strict() }).strict(),
    z.object({ id, kind: z.literal('exemption'), values: z.object({ exemptions: sealed }).strict() }).strict(),
    z.object({ id, kind: z.literal('observation'), values: z.object({ codeSystem: z.string().min(1).max(128), code: z.string().min(1).max(128),
        display: z.string().min(1).max(4096), unitSystem: z.string().min(1).max(128), unitCode: z.string().min(1).max(128),
        value: z.string().min(1).max(4096), observedAt: dateInputSchema,
        refLow: z.string().max(4096).nullable().optional(), refHigh: z.string().max(4096).nullable().optional(), refText: z.string().max(4096).nullable().optional(), notes: sealed }).strict() }).strict(),
]);
const applicationFields = z.object({ visitId: id, phase: z.literal('review'), patientId: z.string().min(1).max(256),
    expectedVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 129), cassetteRevision: z.number().int().positive(),
    items: z.array(agentApplicationItemSchema).min(1).max(128),
}).strict();
const uniqueItems = (value: { items: Array<{ id: string }> }) => new Set(value.items.map(item => item.id)).size === value.items.length;
export const agentApplicationSchema = applicationFields.refine(uniqueItems);
export const reviewedAgentApplicationSchema = applicationFields.extend({ newPatient: newAgentPatientSchema.optional() }).refine(uniqueItems);
export type ReviewedAgentApplicationInput = z.input<typeof reviewedAgentApplicationSchema>;
export type AgentApplicationInput = z.input<typeof agentApplicationSchema>;
export type AgentApplication = z.output<typeof agentApplicationSchema>;
export const agentStructuredKind = (kind: string) => !['note', 'transcription', 'pdf'].includes(kind);
export const agentCassetteConfirmsNatively = (cassette: Pick<AgentCassette, 'modelProvider' | 'allowsClinicalEgress'>) =>
    clinicalContentAllowed(cassette.modelProvider, cassette.allowsClinicalEgress);
export type AgentApplicationReceipt = { visitId: string; phase: 'review'; status: 'applied'; eventId: string; itemCount: number;
    patientVersion: number; modelProvider: string; allowsClinicalEgress: boolean };
export const AGENT_ITEM_DECISIONS = ['keep', 'correct', 'discard'] as const;
export type AgentItemDecision = typeof AGENT_ITEM_DECISIONS[number];
const decisionTarget = { visitId: id, cassetteRevision: z.number().int().positive() };
export const agentItemDecisionSchema = z.discriminatedUnion('decision', [
    z.object({ ...decisionTarget, decision: z.literal('discard'), itemId: id,
        kind: z.enum(['note', 'transcription', 'pdf', 'therapy', 'service', 'diagnosis', 'exemption', 'observation']) }).strict(),
    z.object({ ...decisionTarget, decision: z.enum(['keep', 'correct']), patientId: z.string().min(1).max(256),
        expectedVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 2), item: agentApplicationItemSchema }).strict(),
]);
export type AgentItemDecisionInput = z.input<typeof agentItemDecisionSchema>;
export type AgentVisitDecisionState = 'pending' | 'partial' | 'applied' | 'decided';
export type AgentItemDecisionReceipt = { visitId: string; itemId: string; decision: AgentItemDecision; status: 'decided'; eventId: string;
    patientVersion: number | null; visitState: AgentVisitDecisionState };

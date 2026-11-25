import { z } from 'zod';
import { agentApplicationSchema, type AgentApplication } from './agent-visit-application-contract';

export const visitConfirmationPurpose = 'mediflow.visit-confirmation.v2';
export const visitConfirmationDurationMs = 60_000;
export const visitConfirmationPolicies = ['biometrics-or-companion', 'account-password'] as const;
export const visitConfirmationId = z.string().uuid().toLowerCase();
const base64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/u);
export const visitRegistrationSchema = z.object({
    agreementPublicKey: base64.length(88), signingPublicKey: base64.length(88),
}).strict();
export const visitProofSchema = z.object({ signature: base64.length(88), policy: z.enum(visitConfirmationPolicies) }).strict();
export const visitConfirmationActionSchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('prepare'), reference: visitConfirmationId, patientId: z.string().min(1).max(256),
        patientVersion: z.number().int().positive() }).strict(),
    z.object({ action: z.literal('show'), reference: visitConfirmationId, plan: agentApplicationSchema,
        presentation: base64.max(440_000) }).strict(),
    z.object({ action: z.literal('dismiss'), reference: visitConfirmationId }).strict(),
]);

export type VisitConfirmationRegistration = z.infer<typeof visitRegistrationSchema>;
export type VisitConfirmationProof = z.infer<typeof visitProofSchema>;
export type VisitConfirmationReceipt = { reference: string; status: 'waiting' | 'applied' | 'not_applied' | 'unavailable' };
export type VisitConfirmationTicket = { reference: string; visitId: string; revision: number };
export type VisitConfirmationShownItem = { id: string; kind: AgentApplication['items'][number]['kind'] };
export type VisitConfirmationPresentation = {
    patient: string;
    fiscalCode: string;
    proposals: (VisitConfirmationShownItem & { title: string; fields: { label: string; value: string }[]; current: string; sourceName: string; sourceQuote: string; sourceHash: string })[];
};

import { z } from 'zod';
import { deny, planSchema, type LocalOperationPlan, type LiveContext } from '../contract.ts';

const text = z.string().min(1).max(2048);
const time = z.number().int().nonnegative();
const itemSchema = z.object({ id: text, code: text, description: text,
    quantity: z.number().int().positive().max(99), unit: z.literal('prestazione') }).strict();
export const specialistDecisionSchema = z.object({
    schema: z.literal('mediflow.synthetic-specialist.v1'), version: text, patientId: text, practiceId: text,
    decidedBy: text, decidedAt: time, clinicalQuestion: text, diagnosis: text,
    priority: z.enum(['U', 'B', 'D', 'P']), access: z.enum(['first', 'followup']), regime: z.literal('ssr'),
    exemption: z.discriminatedUnion('kind', [z.object({ kind: z.literal('none') }).strict(),
        z.object({ kind: z.literal('verified'), code: text, patientId: text, source: text, version: text,
            validFrom: time, validUntil: time, applicableCodes: z.array(text).min(1) }).strict()]),
    items: z.array(itemSchema).min(1).max(16),
}).strict();
const catalogSchema = z.object({ version: text, validFrom: time, validUntil: time,
    entries: z.array(itemSchema.omit({ id: true, quantity: true })).min(1) }).strict();
export const identitySchema = z.object({ patientId: text, name: text, identifier: text,
    version: text, verifiedAt: time, identifierType: z.literal('synthetic') }).strict();
export type SpecialistDecision = z.infer<typeof specialistDecisionSchema>;
export type SpecialistIdentity = z.infer<typeof identitySchema>;

export function specialistFieldLabel(name: string): string {
    const labels: Record<string, string> = { patientName: 'Assistito', patientIdentifier: 'Identificativo inventato',
        clinicalQuestion: 'Quesito diagnostico', diagnosis: 'Diagnosi', priority: 'Priorità', access: 'Tipo di accesso',
        regime: 'Regime', exemption: 'Esenzione', id: 'Riferimento della prestazione', code: 'Codice', description: 'Prestazione', quantity: 'Quantità', unit: 'Unità' };
    const item = /^item\.(\d+)\.(id|code|description|quantity|unit)$/.exec(name);
    return item ? `${labels[item[2]!]} (${Number(item[1]) + 1})` : labels[name] ?? 'Campo non previsto';
}

export function specialistDecisionValues(decision: SpecialistDecision): Record<string, string> {
    const values: Record<string, string> = { clinicalQuestion: decision.clinicalQuestion, diagnosis: decision.diagnosis,
        priority: decision.priority, access: decision.access, regime: decision.regime,
        exemption: decision.exemption.kind === 'none' ? 'none' : decision.exemption.code };
    decision.items.forEach((item, index) => {
        for (const name of ['id', 'code', 'description', 'quantity', 'unit'] as const) values[`item.${index}.${name}`] = String(item[name]);
    });
    return values;
}

export function validateSpecialistDecision(raw: unknown, rawCatalog: unknown, now: number): SpecialistDecision {
    const decision = specialistDecisionSchema.parse(raw), catalog = catalogSchema.parse(rawCatalog);
    if (catalog.validFrom > now || catalog.validUntil <= now || decision.decidedAt > now
        || new Set(decision.items.map(item => item.id)).size !== decision.items.length
        || new Set(catalog.entries.map(item => item.code)).size !== catalog.entries.length) deny();
    for (const item of decision.items) {
        if (!catalog.entries.some(entry => entry.code === item.code && entry.description === item.description && entry.unit === item.unit)) deny();
        const exemption = decision.exemption;
        if (exemption.kind === 'verified' && (exemption.patientId !== decision.patientId || exemption.validFrom > now
            || exemption.validUntil <= now || !exemption.applicableCodes.includes(item.code))) deny();
    }
    return decision;
}

export function specialistPlan(input: {
    operationId: string; context: LiveContext; identity: unknown; decision: unknown; catalog: unknown;
    origin: string; finalAct: 'protected' | 'manual'; now: number;
}): LocalOperationPlan {
    const decision = validateSpecialistDecision(input.decision, input.catalog, input.now);
    const identity = identitySchema.parse(input.identity), catalog = catalogSchema.parse(input.catalog), context = input.context;
    if (identity.patientId !== context.patientId || decision.patientId !== context.patientId
        || decision.practiceId !== context.practiceId || decision.decidedBy !== context.operatorId) deny();
    const fields: LocalOperationPlan['fields'] = [];
    function field(name: string, value: string, classification: 'identity' | 'clinical' | 'administrative', sourceRef = 'physician-decision', sourceVersion = decision.version) {
        fields.push({ name, value, classification, sourceRef, sourceVersion, transformation: 'none', required: true });
    }
    field('patientName', identity.name, 'identity', 'local-identity', identity.version);
    field('patientIdentifier', identity.identifier, 'identity', 'local-identity', identity.version);
    for (const [name, value] of Object.entries(specialistDecisionValues(decision))) field(name, value, name === 'exemption' ? 'administrative' : 'clinical');
    return planSchema.parse({ operationId: input.operationId, patientId: identity.patientId, practiceId: decision.practiceId,
        installationId: context.installationId, archiveGeneration: context.archiveGeneration, procedureId: 'synthetic-specialist-prreg',
        contractVersion: 'synthetic-prreg-1', adapterVersion: 'synthetic-prreg-browser-1', uiVersion: 'synthetic-prreg-ui-1',
        catalogVersion: catalog.version, sourceVersion: decision.version, portalAccountId: context.portalAccountId,
        operatorId: context.operatorId, territory: 'lom', finalAct: input.finalAct,
        sources: [{ ref: 'local-identity', version: identity.version, verifiedAt: identity.verifiedAt },
            { ref: 'physician-decision', version: decision.version, verifiedAt: decision.decidedAt }], fields,
        destinations: [
            { origin: input.origin, path: '/portal', method: 'GET', purpose: 'observe' },
            { origin: input.origin, path: '/draft', method: 'POST', purpose: 'prepare' },
            { origin: input.origin, path: '/submit', method: 'POST', purpose: 'act' },
            { origin: input.origin, path: '/receipt', method: 'GET', purpose: 'reconcile' },
        ], parts: decision.items.map(item => item.id) });
}

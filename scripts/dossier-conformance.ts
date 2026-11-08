import * as prepared from '../lib/domain/documents/dossier-prepared';
import * as dossier from '../lib/domain/documents/dossier-import';
import { catalogObservationCode } from '../lib/domain/documents/dossier-sections';
import { searchStaticTerminology, LOINC_PENDING_VALIDATION } from '../lib/terminology';

export function catalogEntries() {
    const normalize = (s: string) => s.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return searchStaticTerminology('LOINC', '', 1000).flatMap(item => {
        const label = item.displayIt ?? '';
        return [label.replace(/\(.*\)/u, ''), /\(([^)]+)\)/u.exec(label)?.[1] ?? ''].filter(Boolean)
            .flatMap(name => { const code = catalogObservationCode(name, item.defaultUnit ?? ''); return code ? [{ name: normalize(name), unit: code.unitCode, code: code.code }] : []; });
    });
}
export function catalogCalls() {
    return [...searchStaticTerminology('LOINC', '', 1000), ...LOINC_PENDING_VALIDATION].flatMap(item => {
        const label = item.displayIt ?? '';
        return [label.replace(/\(.*\)/u, ''), /\(([^)]+)\)/u.exec(label)?.[1] ?? ''].filter(Boolean).map(name => ({ op: 'catalog', args: [name, item.defaultUnit ?? ''] }));
    });
}
// Il corpus contiene argomenti JSON; i Set e la callback di assessment sono ricostruiti qui.
export function verifyCall(call: { op: string; args: unknown[] }): unknown {
    const args = structuredClone(call.args);
    if (call.op === 'catalog') return catalogObservationCode(args[0] as string, args[1] as string);
    if (call.op === 'dossierFactBlockers' && args[1]) {
        const context = args[1] as { exemptionCodes?: string[] | Set<string> };
        if (Array.isArray(context.exemptionCodes)) context.exemptionCodes = new Set(context.exemptionCodes);
    }
    if (call.op === 'preparedFactEligible') args[1] = new Set(args[1] as string[]);
    if (call.op === 'preparedDossierFacts') (args[0] as { now: Date }).now = new Date((args[0] as { now: unknown }).now as string);
    if (call.op === 'preparedBulkDecisions') {
        const input = args[0] as Record<string, unknown>;
        input.exemptionCodes = new Set(input.exemptionCodes as string[]);
        input.acceptedElsewhere = new Set(input.acceptedElsewhere as string[]);
        input.assessment = (ref: string) => (input.assessments as Record<string, unknown>)[ref] ?? undefined;
    }
    const functions = { ...prepared, ...dossier } as Record<string, unknown>;
    const operation = functions[call.op];
    if (typeof operation !== 'function') throw new Error(`Unknown conformance operation: ${call.op}`);
    return operation(...args);
}

import 'server-only';
import { isDeepStrictEqual } from 'node:util';
import { scanJsonObject } from '../../ai-json-lexical';
import { createTreatmentReasoningAthenaOutputContractV2 } from '../fabric/treatment-reasoning-athena-output-contract-v2';

export const ATHENA_EXTRACTOR_ID = 'mediflow.athena-explicit-extraction.v1';
export type ExtractionCode = 'extraction_input_invalid' | 'extraction_unmapped_text' | 'extraction_structure_missing'
    | 'extraction_bindings_missing' | 'extraction_contract_invalid' | 'extraction_would_change_content' | 'extraction_tool_call';
const deny = (code: ExtractionCode) => Object.freeze({ status: 'denied' as const, code, value: null, sourceBindings: null, segments: null });

/** Only an explicit complete contract is losslessly extractable. No prose-to-fact inference. */
export function extractAthenaResearchAnswer(raw: unknown, configuration: unknown) {
    if (typeof raw !== 'string' || !raw.length || raw.length > 64_000) return deny('extraction_input_invalid');
    if (/<\/?tool_call\b|<\|tool_call\|>/iu.test(raw)) return deny('extraction_tool_call');
    const fenced = /^\s*```(?:json)?\r?\n([\s\S]*?)\r?\n```\s*$/u.exec(raw);
    const text = fenced ? fenced[1]! : raw;
    const offset = fenced ? raw.indexOf('\n') + 1 : 0;
    const literals = scanJsonObject(text);
    if (!literals) return deny('extraction_unmapped_text');
    const input = JSON.parse(text);
    if (input.schemaVersion !== 'mediflow.treatment_reasoning.v1' || input.task !== 'treatment_reasoning'
        || typeof input.summary !== 'string' || !input.data) return deny('extraction_structure_missing');
    if (!Array.isArray(input.sourceBindings)) return deny('extraction_bindings_missing');
    if (!Array.isArray(input.data.trace?.toolsUsed)) return deny('extraction_structure_missing');
    if (input.data.trace.toolsUsed.length !== 0) return deny('extraction_tool_call');
    const result = createTreatmentReasoningAthenaOutputContractV2(configuration).normalize(input);
    if (result.status !== 'accepted') return deny('extraction_contract_invalid');
    const { sourceBindings, ...envelope } = input;
    if (!isDeepStrictEqual(result.value, envelope) || !isDeepStrictEqual(result.sourceBindings, sourceBindings)) return deny('extraction_would_change_content');
    const segments = Object.freeze(literals.filter(item => !item.key).map(item => Object.freeze({
        path: item.path, start: offset + item.start, end: offset + item.end, text: item.value,
    })));
    return Object.freeze({ status: 'extracted' as const, code: null, value: result.value, sourceBindings: result.sourceBindings, segments });
}

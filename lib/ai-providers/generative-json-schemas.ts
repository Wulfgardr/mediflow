import type { AIChatOptions } from './provider';
import { DOCUMENT_SYNTHESIS_V2_JSON_SCHEMA } from './document-synthesis-json-schema';
import { PATIENT_INSIGHT_JSON_SCHEMA, SMART_IMPORT_JSON_SCHEMA } from './extraction-json-schemas';

export type GenerativeResponseFormat = Exclude<NonNullable<AIChatOptions['responseFormat']>, 'json'>;
export const GENERATIVE_JSON_SCHEMAS = Object.freeze({
    document_synthesis_v2: DOCUMENT_SYNTHESIS_V2_JSON_SCHEMA,
    patient_insight: PATIENT_INSIGHT_JSON_SCHEMA,
    smart_import: SMART_IMPORT_JSON_SCHEMA,
} satisfies Record<GenerativeResponseFormat, Readonly<Record<string, unknown>>>);

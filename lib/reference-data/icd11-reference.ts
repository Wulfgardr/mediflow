import { parseWhoLocalReference, type WhoLocalReference } from './icd11-who-local-contract';
import { parseWhoEmbeddedReference, type WhoEmbeddedReference } from './icd11-embedded-contract';

export type WhoReference = WhoLocalReference | WhoEmbeddedReference;
export function parseWhoReference(value: unknown): WhoReference | null {
    return parseWhoEmbeddedReference(value) ?? parseWhoLocalReference(value);
}

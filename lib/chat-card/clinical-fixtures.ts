import { readFileSync } from 'node:fs';
export const CLINICAL_CORPUS_JSON = readFileSync(new URL('../../scripts/fixtures/clinical-chat-corpus.json', import.meta.url), 'utf8');

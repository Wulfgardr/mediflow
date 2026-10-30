import 'server-only';
import { createHash } from 'node:crypto';
import { scanJsonObject } from '../../ai-json-lexical';
import { extractAthenaResearchAnswer, ATHENA_EXTRACTOR_ID } from './extractor';
import { ATHENA_RESEARCH_NOTICE } from './method';

export function replayAthenaResearchAnswer(raw: string, configuration: unknown) {
    const extraction = extractAthenaResearchAnswer(raw, configuration);
    let validJson = false;
    try { JSON.parse(raw); validJson = true; } catch { /* Entire stdout only. */ }
    const humanAssessment = Object.freeze({ status: 'pending', reviewedTexts: 0, totalTexts: 1,
        unsupportedClaims: null, inventedSources: null, negationLosses: null, uncertaintyLosses: null,
        subjectLosses: null, timeLosses: null, omissions: null, additions: null });
    return Object.freeze({ mode: 'deterministic_replay', notice: ATHENA_RESEARCH_NOTICE, extractor: ATHENA_EXTRACTOR_ID,
        raw, rawSha256: createHash('sha256').update(raw).digest('hex'), validJson, lexicalJsonValid: scanJsonObject(raw) !== null,
        extraction, humanAssessment, newInference: false, newQualityThresholds: null,
        completion: 'not_attested_by_historical_stdout', qualification: false });
}

import 'server-only';
import { performance } from 'node:perf_hooks';
import { snapshotTreatmentReasoningProjectionAttachment } from '../fabric/treatment-reasoning-projection';
import type { TreatmentReasoningProjectionAttachment } from '../fabric/treatment-reasoning-projection';
import type { TreatmentReasoningAthenaV2Attestation } from '../fabric/treatment-reasoning-athena-output-contract-v2';
import { extractAthenaResearchAnswer, ATHENA_EXTRACTOR_ID } from './extractor';
import { buildAthenaResearchInstruction, ATHENA_RESEARCH_NOTICE, ATHENA_TWO_STEP_METHOD } from './method';

type GuardCode = 'research_revoked' | 'research_context_lost';
type Runtime = Readonly<{
    available(): boolean;
    invoke(instruction: ReturnType<typeof buildAthenaResearchInstruction>, signal: AbortSignal): Promise<Readonly<{
        raw: string; finishReason: 'stop' | 'length' | 'unknown';
    }>>;
}>;
type Host = Readonly<{ runtime?: Runtime; guard(): GuardCode | null; attestation: TreatmentReasoningAthenaV2Attestation }>;
const metadata = Object.freeze({ method: ATHENA_TWO_STEP_METHOD, extractor: ATHENA_EXTRACTOR_ID,
    notice: ATHENA_RESEARCH_NOTICE, publication: null, writesPerformed: 0, applyPolicy: 'none' });

/** Research only. It cannot mint a production publication or silently substitute a runner. */
export function createAthenaResearchModule(host: Host) {
    return Object.freeze({
        availability() {
            let available = false;
            try { available = host.runtime?.available() === true; } catch { /* Optional module unavailable. */ }
            return Object.freeze({ ...metadata, available, code: available ? null : 'research_module_absent' });
        },
        async execute(projection: TreatmentReasoningProjectionAttachment) {
            let raw: string | null = null;
            const stages = { reasoningMs: null as number | null, extractionMs: null as number | null };
            const denied = (code: string) => Object.freeze({ ...metadata, status: 'denied' as const, code, raw,
                extraction: null, stages: Object.freeze({ ...stages }) });
            let input: TreatmentReasoningProjectionAttachment | null;
            try { input = snapshotTreatmentReasoningProjectionAttachment(projection, projection.capturedAt); }
            catch { return denied('research_input_invalid'); }
            if (!input) return denied('research_input_invalid');
            let guard = host.guard();
            if (guard) return denied(guard);
            if (!this.availability().available || !host.runtime) return denied('research_module_absent');
            const signal = new AbortController();
            let timer: ReturnType<typeof setTimeout> | undefined;
            let output: Awaited<ReturnType<Runtime['invoke']>>;
            const start = performance.now();
            try {
                output = await Promise.race([
                    host.runtime.invoke(buildAthenaResearchInstruction(input), signal.signal),
                    new Promise<never>((_, reject) => { timer = setTimeout(() => {
                        signal.abort(); reject(new Error('research_timeout'));
                    }, 420_000); }),
                ]);
            } catch {
                stages.reasoningMs = performance.now() - start;
                return denied(host.guard() ?? (signal.signal.aborted ? 'research_timeout' : 'research_runtime_failed'));
            } finally { clearTimeout(timer); }
            stages.reasoningMs = performance.now() - start;
            raw = output.raw;
            guard = host.guard();
            if (guard) return denied(guard);
            if (output.finishReason !== 'stop') return denied('research_answer_incomplete');
            const extractionStart = performance.now();
            const extraction = extractAthenaResearchAnswer(raw, { allowedEvidenceRefs: input.evidenceRefs, attestation: host.attestation });
            stages.extractionMs = performance.now() - extractionStart;
            guard = host.guard();
            if (guard) return denied(guard);
            return Object.freeze({ ...metadata, status: extraction.status === 'extracted' ? 'extracted' as const : 'denied' as const,
                code: extraction.code, raw, extraction, stages: Object.freeze({ ...stages }) });
        },
    });
}

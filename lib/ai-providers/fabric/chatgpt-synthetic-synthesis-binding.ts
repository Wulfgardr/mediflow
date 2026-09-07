/* @Codex */
import 'server-only';
import * as owner from '../../security/web-auth-lifecycle-owner-adapter';
import { ExecutionError, type SynthesisCatalog, type SynthesisRequest, type SynthesisResult } from '../../chatgpt-execution/execution-contract';
import type { QualifiedExecutionHost } from '../../chatgpt-execution/execution-host';
import { createSynthesisExecutionService } from '../../chatgpt-execution/execution-service';
import { CHATGPT_SYNTHESIS_FIXTURE } from '../../chatgpt-execution/synthetic-synthesis-fixture';

/** Host-only handoff after official login; never exported by a generic RPC route. */
export function bindChatGptSyntheticSynthesis(session: owner.WebSessionProjection, host: QualifiedExecutionHost) {
    const port = owner.mintResourcePort(session);
    if (!port) throw new ExecutionError('session_expired');
    let active = true;
    let expiry: ReturnType<typeof setTimeout> | null = null;
    const current = () => {
        if (!active || Date.now() >= session.expiresAt) return false;
        const use = owner.beginResourceUse(port);
        if (!use) return false;
        owner.abortResourceUse(use);
        return true;
    };
    const service = createSynthesisExecutionService({ transport: host.transport, cwd: host.cwd,
        input: CHATGPT_SYNTHESIS_FIXTURE, boundaryQualified: host.boundaryQualified, isCurrent: current });
    const dispose = () => {
        if (!active) return;
        active = false; if (expiry) clearTimeout(expiry);
        void service.dispose(); void host.close();
        queueMicrotask(() => { owner.releaseResourcePort(port); });
    };
    if (!owner.registerPrivateResource(port, dispose)) { dispose(); throw new ExecutionError('session_expired'); }
    expiry = setTimeout(dispose, Math.max(0, session.expiresAt - Date.now())); expiry.unref();

    async function respond<T>(work: () => Promise<T>, render: (result: T) => Response): Promise<Response> {
        if (!active) throw new ExecutionError('session_expired');
        const use = owner.beginResourceUse(port);
        if (!use) { dispose(); throw new ExecutionError('session_expired'); }
        try {
            const result = await work();
            let response: Response | undefined;
            const bound = owner.withCurrentResourceBinding(use, () => {
                if (active && Date.now() < session.expiresAt) response = render(result);
            });
            if (!bound || !response || !owner.commitResourceUse(use)) throw new ExecutionError('session_expired');
            return response;
        } finally { owner.abortResourceUse(use); }
    }
    return Object.freeze({
        catalog(render: (result: SynthesisCatalog) => Response) { return respond(() => service.readCatalog(), render); },
        generate(request: SynthesisRequest, render: (result: SynthesisResult) => Response, signal?: AbortSignal) {
            return respond(() => service.generate(request, signal), render);
        },
        cancel() { return service.cancel(); }, dispose,
    });
}

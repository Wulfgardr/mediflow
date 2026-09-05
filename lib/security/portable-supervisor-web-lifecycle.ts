/* @Codex */
import 'server-only';

import { types } from 'node:util';

import { apiFailure } from '../api-error-response';
import {
    retirePortableSupervisorWebSessionV1,
    type PortableSupervisorWebSessionRetirementReasonV1,
} from './portable-supervisor-web-session-controller';

const MESSAGE = 'Host intelligente non disponibile.';

type Sources = Readonly<{
    retire(reason: PortableSupervisorWebSessionRetirementReasonV1): Promise<boolean>;
}>;

const productionSources: Sources = Object.freeze({
    retire: retirePortableSupervisorWebSessionV1,
});

function mutationCompleted(response: Response, reason: PortableSupervisorWebSessionRetirementReasonV1): boolean {
    if (reason === 'logout') return response.status === 204;
    if (reason === 'application_lock' || reason === 'reselection') return response.status === 200;
    return false;
}

function unavailable(): Response {
    return apiFailure('host_unavailable', MESSAGE, 503);
}

/** Awaits a terminal Supervisor fence only after the canonical Web mutation succeeds. */
export async function completePortableSupervisorWebLifecycleMutationV1(
    mutation: Promise<Response>,
    reason: PortableSupervisorWebSessionRetirementReasonV1,
    sources: Sources = productionSources,
): Promise<Response> {
    const response = await mutation;
    if (!mutationCompleted(response, reason)) return response;

    let retirement: unknown;
    try { retirement = sources.retire(reason); } catch { return unavailable(); }
    if (!types.isPromise(retirement)) return unavailable();
    try {
        const completed = await retirement;
        return typeof completed === 'boolean' ? response : unavailable();
    } catch { return unavailable(); }
}

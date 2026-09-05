/* @Codex */
import 'server-only';

import { types } from 'node:util';
import { NextResponse } from 'next/server.js';

import { apiFailure } from '../api-error-response';
import {
    PortableSupervisorWebSessionV1Error,
    type PortableSupervisorWebSessionActivationInputV1,
    type PortableSupervisorWebSessionActivationV1,
} from './portable-supervisor-web-session-controller.ts';
import { isTrustedWebMutationRequest } from './request-transport.ts';

const HOST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MESSAGE = 'Host intelligente non disponibile.';

type Sources = Readonly<{
    readAuthenticated(): Promise<unknown>;
    activate(input: PortableSupervisorWebSessionActivationInputV1):
        Promise<PortableSupervisorWebSessionActivationV1>;
}>;
type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

function failure(code: string, status: number): NextResponse {
    return apiFailure(code, MESSAGE, status);
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)
            || types.isPromise(value)) return null;
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== null && prototype !== Object.prototype) return null;
        const own = Reflect.ownKeys(value);
        if (own.length !== keys.length
            || own.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const output = Object.create(null) as Record<string, unknown>;
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor?.enumerable || !('value' in descriptor)) return null;
            output[key] = descriptor.value;
        }
        return output;
    } catch { return null; }
}

function epoch(value: unknown): number | null {
    const parsed = exact(value, ['selectionEpoch']);
    return parsed && Number.isSafeInteger(parsed.selectionEpoch) && (parsed.selectionEpoch as number) >= 1
        ? parsed.selectionEpoch as number : null;
}

function patient(value: unknown): string | null {
    const parsed = exact(value, ['id']);
    return parsed && typeof parsed.id === 'string' && HOST_ID.test(parsed.id) ? parsed.id : null;
}

function output(value: unknown): PortableSupervisorWebSessionActivationV1 | null {
    const parsed = exact(value, ['state', 'expiresAt']);
    if (!parsed || parsed.state !== 'active' || !Number.isSafeInteger(parsed.expiresAt)
        || (parsed.expiresAt as number) < 1) return null;
    return Object.freeze({ state: 'active', expiresAt: parsed.expiresAt as number });
}

function controlled(error: unknown): NextResponse | null {
    if (!(error instanceof PortableSupervisorWebSessionV1Error)) return null;
    switch (error.code) {
        case 'input_invalid': return failure(error.code, 400);
        case 'selection_unavailable':
        case 'selection_conflict': return failure(error.code, 409);
        case 'host_unavailable':
        case 'session_terminal': return failure(error.code, 503);
        default: {
            const unreachable: never = error.code;
            void unreachable;
            return null;
        }
    }
}

/** Auth-first HTTP boundary; the controller still acquires the authoritative owner capture. */
export function createPortableSupervisorWebSessionActivationHttpHandlerV1(sources: Sources) {
    return async (request: Request, context: RouteContext): Promise<NextResponse> => {
        try {
            if (await sources.readAuthenticated() !== true) return failure('session_unavailable', 401);
        } catch { return failure('session_unavailable', 401); }
        if (!isTrustedWebMutationRequest(request)) return failure('request_transport_invalid', 403);

        let patientId: string | null = null;
        try { patientId = patient(await context.params); } catch { /* invalid route context */ }
        if (!patientId) return failure('input_invalid', 400);

        let value: unknown;
        try { value = await request.json(); } catch { return failure('input_invalid', 400); }
        const selectionEpoch = epoch(value);
        if (selectionEpoch === null) return failure('input_invalid', 400);

        try {
            const result = output(await sources.activate(Object.freeze({
                expectedPatientId: patientId, selectionEpoch,
            })));
            if (!result) return failure('host_unavailable', 503);
            const response = NextResponse.json({ state: result.state, expiresAt: result.expiresAt });
            response.headers.set('Cache-Control', 'no-store');
            return response;
        } catch (error) {
            return controlled(error) ?? failure('host_unavailable', 503);
        }
    };
}

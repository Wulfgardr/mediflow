/* @Codex */
import 'server-only';

import { types } from 'node:util';
import { NextResponse } from 'next/server.js';

import { apiFailure } from '../api-error-response';
import { HeadlessCheckupActiveRoleEnrollmentError } from './headless-checkup-active-role-enrollment';

const MESSAGE = 'Ruolo checkup non disponibile.';
type Sources = Readonly<{ readAuthorizedAdmin(): Promise<unknown>; enroll(pin: unknown): Promise<unknown>;
  revoke(pin: unknown): Promise<unknown>; retireOperation(): unknown }>;

function failure(code: string, status: number): NextResponse { return apiFailure(code, MESSAGE, status); }
function pin(value: unknown): unknown {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)
      || types.isPromise(value) || Object.getPrototypeOf(value) !== Object.prototype
      || Reflect.ownKeys(value).length !== 1) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, 'candidatePin');
    return descriptor?.enumerable && 'value' in descriptor ? descriptor.value : null;
  } catch { return null; }
}
function controlled(error: unknown): NextResponse {
  if (!(error instanceof HeadlessCheckupActiveRoleEnrollmentError)) return failure('storage_unavailable', 503);
  if (error.code === 'enrollment_denied') return failure(error.code, 403);
  if (error.code === 'enrollment_conflict') return failure(error.code, 409);
  return failure(error.code, 503);
}
async function body(request: Request): Promise<unknown> {
  try { return pin(await request.json()); } catch { return null; }
}
function success(value: unknown, status = 200): NextResponse {
  const response = NextResponse.json(value, { status }); response.headers.set('Cache-Control', 'no-store'); return response;
}
function projection(value: unknown, revoked = false): Record<string, unknown> | null {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)
      || types.isPromise(value)) return null;
    const expected = revoked ? ['schemaVersion', 'status', 'attestationVersion', 'revocationGeneration']
      : ['schemaVersion', 'status', 'attestationVersion'];
    const prototype = Object.getPrototypeOf(value), keys = Reflect.ownKeys(value);
    if ((prototype !== null && prototype !== Object.prototype) || keys.length !== expected.length
      || keys.some((key) => typeof key !== 'string' || !expected.includes(key))) return null;
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of expected) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) return null;
      output[key] = descriptor.value;
    }
    if (output.attestationVersion !== 1) return null;
    if (revoked) return output.schemaVersion === 'mediflow.headless-checkup-active-role-revocation.v1'
      && output.status === 'revoked' && output.revocationGeneration === 1 ? output : null;
    return output.schemaVersion === 'mediflow.headless-checkup-active-role-enrollment.v1'
      && output.status === 'active' ? output : null;
  } catch { return null; }
}

/** Auth-first controlled setup and explicit revocation; neither path returns a grant. */
export function createHeadlessCheckupActiveRoleHttpHandlersV1(sources: Sources) {
  const authorized = async (): Promise<boolean> => {
    try { return await sources.readAuthorizedAdmin() === true; } catch { return false; }
  };
  return Object.freeze({
    POST: async (request: Request): Promise<NextResponse> => {
      if (!await authorized()) return failure('session_unavailable', 401);
      const candidatePin = await body(request); if (candidatePin === null) return failure('invalid_input', 400);
      try { const result = projection(await sources.enroll(candidatePin));
        return result ? success(result, 201) : failure('storage_unavailable', 503); }
      catch (error) { return controlled(error); }
    },
    DELETE: async (request: Request): Promise<NextResponse> => {
      if (!await authorized()) return failure('session_unavailable', 401);
      const candidatePin = await body(request); if (candidatePin === null) return failure('invalid_input', 400);
      try {
        const result = projection(await sources.revoke(candidatePin), true);
        if (!result) return failure('storage_unavailable', 503);
        let retired: unknown;
        try { retired = sources.retireOperation(); } catch { return failure('storage_unavailable', 503); }
        if (types.isPromise(retired) || (retired !== true && retired !== false)) {
          return failure('storage_unavailable', 503);
        }
        return success(result);
      } catch (error) { return controlled(error); }
    },
  });
}

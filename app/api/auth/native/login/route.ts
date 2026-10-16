import { readNativeNetworkJson, jsonBodyTooLargeResponse, NATIVE_BOOTSTRAP_JSON_MAX_BYTES } from '@/lib/native-network-json-body';
import { admitNativeBootstrapRouteRequest } from '@/lib/security/native-bootstrap-request-adapter';
import { nativeLoginDeniedResponse, nativeLoginHttp } from '@/lib/security/native-login-http';

/** Native pairing admission precedes the only body fields this route accepts. */
export async function POST(request: Request) {
    let admission: object | null = null;
    try {
        admission = await admitNativeBootstrapRouteRequest(request);
        if (!admission) return nativeLoginDeniedResponse();
        const body = await readNativeNetworkJson(request, NATIVE_BOOTSTRAP_JSON_MAX_BYTES) as Record<string, unknown> | null;
        const username = typeof body?.username === 'string' ? body.username.trim() : '';
        return nativeLoginHttp(request, admission, { ...body, username });
    } catch (error) {
        const sizeError = jsonBodyTooLargeResponse(error);
        if (sizeError) return sizeError;
        return admission ? nativeLoginHttp(request, admission, Object.create(null)) : nativeLoginDeniedResponse();
    }
}

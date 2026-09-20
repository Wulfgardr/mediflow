/* @Codex */
import 'server-only';

import { admitNativeBootstrap } from './native-bootstrap-admission';
import {
    NETWORK_PAIRED_CLIENT_ID_HEADER,
    NETWORK_PAIRED_CLIENT_TOKEN_HEADER,
} from '../network-pairing-model';

const RequestConstructor = Request;

/** Next supplies a tracked wrapper. Copy transport data, never its identity or authority. */
export async function admitNativeBootstrapRouteRequest(request: Request): Promise<object | null> {
    try {
        const clientId = request.headers.get(NETWORK_PAIRED_CLIENT_ID_HEADER);
        const token = request.headers.get(NETWORK_PAIRED_CLIENT_TOKEN_HEADER);
        if (!clientId || !token) return null;
        return await admitNativeBootstrap({ request: new RequestConstructor('https://127.0.0.1/native-bootstrap', {
            headers: {
                [NETWORK_PAIRED_CLIENT_ID_HEADER]: clientId,
                [NETWORK_PAIRED_CLIENT_TOKEN_HEADER]: token,
            },
        }) });
    } catch { return null; }
}

import { channel } from 'node:diagnostics_channel';
import { installLoopbackIngress } from './loopback-ingress.mjs';

/** Direct route tests replace only the Node socket, not the attestation check. */
export function syntheticLoopbackRequest(input: string | URL | Request, init?: RequestInit): Request {
    installLoopbackIngress();
    const ingress = { headers: {} as Record<string, string>, socket: { remoteAddress: '127.0.0.1' } };
    channel('http.server.request.start').publish({ request: ingress });
    const request = new Request(input, init);
    request.headers.set('x-mediflow-server-loopback', ingress.headers['x-mediflow-server-loopback']);
    return request;
}

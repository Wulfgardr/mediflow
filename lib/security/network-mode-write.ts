import { NextResponse } from 'next/server';
import { hasAttestedLoopbackIngress } from './loopback-ingress.mjs';
import { exposedNetworkModeAllowed } from './settings-write-policy';

/** Common boundary for every HTTP writer of `network.mode`. */
export function networkModeWriteDenial(request: Request, session: { role: string }, key: string, value: string): NextResponse | null {
    if (key !== 'network.mode') return null;
    if (!['local-only', 'network-home-base'].includes(value)) {
        return NextResponse.json({ error: 'Invalid network mode' }, { status: 400 });
    }
    if (value === 'network-home-base' && !exposedNetworkModeAllowed(session, hasAttestedLoopbackIngress(request))) {
        return NextResponse.json({ error: 'Local administrator required', code: 'NETWORK_MODE_LOCAL_ADMIN_REQUIRED' }, { status: 403 });
    }
    return null;
}

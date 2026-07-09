/* @Codex baseline, Claude A18: paired ambulatory scope list */
import { NextResponse } from 'next/server';
import { authenticateNetworkPairedClient } from '@/lib/network-home-base-server';
import { getNetworkModeGateResponse } from '@/lib/network-write-context';
import { forbiddenResponse, requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { listAmbulatorySummaries } from '@/lib/ambulatory-read';
import { createNetworkAmbulatory, NETWORK_AMBULATORY_WRITE_CAPABILITY } from '@/lib/network-ambulatory-write';
import { requireNetworkWriteContext } from '@/lib/network-write-context';

// A18: the paired Apple app needs the real ambulatory list to drive its scope
// picker. This mirrors the read auth chain of /api/v1/network/patients exactly.
// The list is the set of scope options for patient reads, so it rides on the
// existing 'network.replica.readonly-patients' capability rather than forcing a
// new capability that every already-paired client would have to re-request.
export async function GET(request: Request) {
    const pairedClient = await authenticateNetworkPairedClient(request);
    if (!pairedClient) return unauthorizedResponse();

    // WUL-307: paired-client tokens are inert while home-base mode is off.
    const modeGateResponse = await getNetworkModeGateResponse();
    if (modeGateResponse) return modeGateResponse;

    if (!pairedClient.grantedCapabilities.includes('network.replica.readonly-patients')) {
        return forbiddenResponse();
    }

    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        return NextResponse.json(await listAmbulatorySummaries());
    } catch (error) {
        console.error('API GET /api/v1/network/ambulatories error:', error);
        return NextResponse.json({ error: 'Failed to fetch ambulatories' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const resolved = await requireNetworkWriteContext(request, NETWORK_AMBULATORY_WRITE_CAPABILITY);
        if (!resolved.ok) return resolved.response;
        const result = await createNetworkAmbulatory(resolved.context, await request.json() as Record<string, unknown>);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API POST /api/v1/network/ambulatories error:', error);
        return NextResponse.json({ error: 'Failed to create ambulatory' }, { status: 500 });
    }
}

/* No policy injection, environment switch, consent ID reuse or provider call. */
import { evaluateEgress } from '../../ai-egress-gate';
import { payloadHash } from './contract';

export async function evaluatePayload(bytes: string): Promise<Readonly<{
    status: 'allowed' | 'denied'; payloadSha256: string;
}>> {
    const result = evaluateEgress({ text: bytes, lane: 'synthetic_mcp_disclosure' });
    // Discard identity maps and redaction spans locally. Altered bytes require
    // a new preparation/disclosure; they never inherit consent for the original.
    return Object.freeze({ status: result.status === 'allowed' && result.redactedText === bytes ? 'allowed' : 'denied',
        payloadSha256: payloadHash(bytes) });
}

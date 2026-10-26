import assert from 'node:assert/strict';
import test from 'node:test';
import { executionQuotaMessage, parseExecutionQuotaView } from './quota-view';
import { parseExecutionDenial } from './execution-contract';
const view = () => ({ primaryUsedPercent: 100, secondaryUsedPercent: null, includedUsage: 'exhausted', creditAvailability: 'available' });
test('quota view is closed, distinguishes included usage and credits, and promises no entitlement or balance', () => {
    const parsed = parseExecutionQuotaView(view());
    const text = executionQuotaMessage(parsed);
    assert.match(text, /Quota inclusa esaurita/u); assert.match(text, /potenzialmente disponibili/u); assert.match(text, /singolo tentativo/u); assert.match(text, /Non garantisce/u);
    assert.doesNotMatch(text, /saldo|dollari|euro|reset|acquista/u);
    for (const bad of [{ ...view(), balance: '9999' }, { ...view(), creditAvailability: 'unavailable' }, { ...view(), includedUsage: 'available' }, { ...view(), primaryUsedPercent: null }, { ...view(), primaryUsedPercent: Infinity }]) assert.throws(() => parseExecutionQuotaView(bad));
});
test('denial receipt accepts only fixed wire categories and actual bounded JSON-RPC codes', () => {
    assert.equal(parseExecutionDenial(null), null);
    assert.deepEqual(parseExecutionDenial({ source: 'rpc_error', method: 'turn/start', rpcCode: -32000, backendCode: 'usageLimitExceeded' }), { source: 'rpc_error', method: 'turn/start', rpcCode: -32000, backendCode: 'usageLimitExceeded' });
    for (const bad of [{ source: 'rpc_error', method: 'turn/start', rpcCode: -32000, backendCode: 'unknown' }, { source: 'rpc_error', method: 'caller', rpcCode: -32000, backendCode: null }, { source: 'rpc_error', method: 'turn/start', rpcCode: 1234567890, backendCode: null }, { source: 'rpc_error', method: 'turn/start', rpcCode: -32000, backendCode: null, raw: 'PRIVATE' }]) assert.throws(() => parseExecutionDenial(bad));
});

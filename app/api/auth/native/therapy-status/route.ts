import { readNativeNetworkJson } from '@/lib/native-network-json-body';
import { requireNetworkCapabilityContext } from '@/lib/network-write-context';
import { chatTherapyStatusService } from '@/lib/chat-therapy-status';
import { COMMAND_UUID } from '@/lib/therapy-status-command-contract';

export const runtime = 'nodejs';
export async function POST(request: Request): Promise<Response> {
    const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
    try {
        const resolved = await requireNetworkCapabilityContext(request, 'network.replica.write-therapies');
        if (!resolved.ok) return reply({ status: 'denied' }, resolved.response.status);
        if (new URL(request.url).search) return reply({ status: 'denied' }, 400);
        const body = await readNativeNetworkJson(request, 4096, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(2000)]), deadline: performance.now() + 2000 }) as Record<string, unknown>;
        if (!body || Array.isArray(body) || typeof body !== 'object') return reply({ status: 'denied' }, 400);
        const keys = Object.keys(body).sort().join(',');
        if (body.operation === 'open' && keys === 'operation,patientId,selectionEpoch') return reply(await chatTherapyStatusService.open(resolved.context, body.patientId as string, body.selectionEpoch as number));
        if (body.operation === 'preview' && keys === 'command,operation,selectionEpoch,viewId' && typeof body.viewId === 'string') return reply(await chatTherapyStatusService.preview(resolved.context, body.command, body.selectionEpoch as number, body.viewId));
        if (typeof body.commandId !== 'string' || !COMMAND_UUID.test(body.commandId)) return reply({ status: 'denied' }, 400);
        if (body.operation === 'execute' && keys === 'commandId,operation,pin' && typeof body.pin === 'string' && /^[0-9]{4,8}$/u.test(body.pin)) return reply(await chatTherapyStatusService.execute(resolved.context, body.commandId, body.pin));
        if (body.operation === 'revoke' && keys === 'commandId,operation') return reply(await chatTherapyStatusService.revoke(resolved.context, body.commandId));
        if (body.operation === 'receipt' && keys === 'commandId,operation') return reply(await chatTherapyStatusService.receipt(resolved.context, body.commandId));
        return reply({ status: 'denied' }, 400);
    } catch { return reply({ status: 'denied' }, 403); }
}

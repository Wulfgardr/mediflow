export type ExecutionQuotaView = Readonly<{
    primaryUsedPercent: number | null; secondaryUsedPercent: number | null;
    includedUsage: 'available' | 'exhausted'; creditAvailability: 'available' | 'unavailable' | 'not_reported';
}>;
export function parseExecutionQuotaView(value: unknown): ExecutionQuotaView {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_response');
    const input = value as Record<string, unknown>;
    if (Object.keys(input).length !== 4 || !['available', 'exhausted'].includes(String(input.includedUsage))
        || !['available', 'unavailable', 'not_reported'].includes(String(input.creditAvailability))) throw new Error('invalid_response');
    for (const key of ['primaryUsedPercent', 'secondaryUsedPercent']) if (input[key] !== null
        && (typeof input[key] !== 'number' || !Number.isFinite(input[key]) || (input[key] as number) < 0)) throw new Error('invalid_response');
    if (input.primaryUsedPercent === null && input.secondaryUsedPercent === null) throw new Error('invalid_response');
    if ([input.primaryUsedPercent, input.secondaryUsedPercent].some(used => typeof used === 'number' && used >= 100) && input.includedUsage !== 'exhausted') throw new Error('invalid_response');
    if (input.includedUsage === 'exhausted' && input.creditAvailability !== 'available') throw new Error('invalid_response');
    return Object.freeze({ primaryUsedPercent: input.primaryUsedPercent as number | null, secondaryUsedPercent: input.secondaryUsedPercent as number | null,
        includedUsage: input.includedUsage as ExecutionQuotaView['includedUsage'], creditAvailability: input.creditAvailability as ExecutionQuotaView['creditAvailability'] });
}
export function executionQuotaMessage(view: ExecutionQuotaView): string {
    return view.includedUsage === 'exhausted'
        ? 'Quota inclusa esaurita. Sono segnalati crediti potenzialmente disponibili: il singolo tentativo richiede il tuo gesto e resta soggetto alla verifica di OpenAI. Non garantisce accesso o disponibilità.'
        : 'Quota inclusa osservata disponibile. Non garantisce la quota futura; la generazione richiede il tuo gesto.';
}

/* @Codex: WUL-720 patient PUT envelope only; field validation remains with existing normalizers. */
export async function parsePatientJsonObject(read: () => Promise<unknown>): Promise<
    | { ok: true; body: Record<string, unknown> }
    | { ok: false }
> {
    let value: unknown;
    try {
        value = await read();
    } catch (error) {
        if (error instanceof SyntaxError) return { ok: false };
        throw error;
    }

    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? { ok: true, body: value as Record<string, unknown> }
        : { ok: false };
}

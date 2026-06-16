/* @Codex */
export type OllamaPullStreamEvent = {
    status?: string;
    progress?: number;
};

/* @Codex */
export function parseOllamaPullStreamLine(line: string): OllamaPullStreamEvent | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let parsed: unknown;
    try {
        parsed = JSON.parse(trimmed);
    } catch {
        return null;
    }

    if (!parsed || typeof parsed !== 'object') return null;
    const data = parsed as Record<string, unknown>;
    const error = typeof data.error === 'string' ? data.error.trim() : '';
    if (error) throw new Error(error);

    const total = typeof data.total === 'number' ? data.total : undefined;
    const completed = typeof data.completed === 'number' ? data.completed : undefined;

    return {
        ...(typeof data.status === 'string' ? { status: data.status } : {}),
        // @Codex
        ...(typeof total === 'number' && total > 0 && typeof completed === 'number' && completed >= 0 ? { progress: Math.round((completed / total) * 100) } : {}),
    };
}

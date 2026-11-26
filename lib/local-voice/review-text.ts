export type ReviewSuggestion = { start: number; end: number; original: string; replacement: string };

const LABEL = /^(Medico|Paziente):/gmu;

/** Swaps the speaker labels at line starts and moves every suggestion with the text it points to. */
export function swapSpeakers(text: string, suggestions: readonly ReviewSuggestion[]): { text: string; suggestions: ReviewSuggestion[] } {
    const shifts: Array<{ at: number; delta: number }> = [];
    const swapped = text.replace(LABEL, (label: string, speaker: string, offset: number) => {
        const next = speaker === 'Medico' ? 'Paziente:' : 'Medico:';
        shifts.push({ at: offset, delta: next.length - label.length });
        return next;
    });
    const moved = (position: number) => position + shifts.filter((shift) => shift.at < position).reduce((total, shift) => total + shift.delta, 0);
    return { text: swapped, suggestions: suggestions.map((item) => ({ ...item, start: moved(item.start), end: moved(item.end) })) };
}

/** After a free edit, keeps the suggestions outside the changed span, moved by the length difference. */
export function rebaseSuggestions(before: string, after: string, suggestions: readonly ReviewSuggestion[]): ReviewSuggestion[] {
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
    let suffix = 0;
    while (suffix < before.length - prefix && suffix < after.length - prefix
        && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
    const changedEnd = before.length - suffix;
    const delta = after.length - before.length;
    return suggestions.flatMap((item) => item.end <= prefix ? [item]
        : item.start >= changedEnd ? [{ ...item, start: item.start + delta, end: item.end + delta }]
            : []).filter((item) => after.slice(item.start, item.end) === item.original);
}

/** Replaces one occurrence, only if the text still holds the original word there. */
export function applySuggestion(text: string, suggestions: readonly ReviewSuggestion[], index: number): { text: string; suggestions: ReviewSuggestion[] } | null {
    const chosen = suggestions[index];
    if (!chosen || text.slice(chosen.start, chosen.end) !== chosen.original) return null;
    const next = text.slice(0, chosen.start) + chosen.replacement + text.slice(chosen.end);
    return { text: next, suggestions: rebaseSuggestions(text, next, suggestions.filter((_, position) => position !== index)) };
}

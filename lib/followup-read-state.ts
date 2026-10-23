import type { Checkup } from './db';
import { formatCountLabel } from './format-count';
import type { LiveQueryState } from './live-query';

type FollowupViewState = Readonly<{
    state: 'loading' | 'error' | 'unavailable' | 'empty' | 'available';
    summary: string;
    count?: string;
}>;

export function projectFollowupReadState(read: Pick<LiveQueryState<Checkup[]>, 'data' | 'loading' | 'error'>): FollowupViewState {
    if (read.error !== null && read.error !== undefined) return { state: 'error', summary: 'Impossibile leggere i follow-up.' };
    if (read.loading) return { state: 'loading', summary: 'Lettura dei follow-up in corso…' };
    if (read.data === undefined) return { state: 'unavailable', summary: 'La lettura dei follow-up non è disponibile.' };
    return {
        state: read.data.length === 0 ? 'empty' : 'available',
        summary: read.data.length === 0 ? 'Nessun follow-up pianificato.' : 'Apri i prossimi passaggi pianificati.',
        count: formatCountLabel(read.data.length, 'follow-up', 'follow-up'),
    };
}

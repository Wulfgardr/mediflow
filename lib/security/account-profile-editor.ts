import { z } from 'zod';

const profileSchema = z.object({
    userId: z.string().min(1), username: z.string().min(1),
    displayName: z.string().nullable(), ambulatoryName: z.string().nullable(),
    profileVersion: z.string().min(1), archiveGeneration: z.string().min(1),
});
export type AccountProfile = z.infer<typeof profileSchema>;
export type ProfileDraft = { doctorName: string; clinicName: string };
export type ProfileEditorState = {
    draft: ProfileDraft; current: AccountProfile | null; busy: boolean;
    requiresRead: boolean; message: string;
};

export class AccountProfileEditor {
    state: ProfileEditorState = {
        draft: { doctorName: '', clinicName: '' }, current: null,
        busy: false, requiresRead: true, message: '',
    };
    private request = 0;
    private active = true;
    constructor(
        private readonly userId: string,
        private authorityCurrent: () => boolean,
        private readonly changed: (state: ProfileEditorState) => void,
        private readonly apply: (profile: AccountProfile, isCurrent: () => boolean) => void,
        private readonly transport: typeof fetch = fetch,
    ) {}

    replaceAuthority(authorityCurrent: () => boolean) {
        if (!this.active) return;
        this.request++;
        this.authorityCurrent = authorityCurrent;
        this.publish({ busy: false, requiresRead: true,
            message: 'La sessione è cambiata. La bozza è conservata. Rileggi il profilo prima di salvare.' });
    }
    dispose() { this.active = false; this.request++; }
    edit(draft: ProfileDraft) { this.publish({ draft }); }
    resumeDraft(draft: ProfileDraft) {
        if (!this.active || !this.state.current || !this.authorityCurrent()) return;
        this.publish({ draft, requiresRead: true,
            message: 'Bozza recuperata. Rileggi il profilo e confronta i valori salvati prima di salvare.' });
    }
    private publish(patch: Partial<ProfileEditorState>) {
        this.state = { ...this.state, ...patch };
        this.changed(this.state);
    }
    private current(request: number) {
        return this.active && this.request === request && this.authorityCurrent();
    }
    private parse(body: unknown, read: boolean): AccountProfile {
        const profile = (read ? profileSchema.extend({
            operation: z.literal('account-profile.read.v1'), contractVersion: z.literal(1),
        }) : profileSchema).parse(body);
        if (profile.userId !== this.userId || (this.state.current
            && profile.archiveGeneration !== this.state.current.archiveGeneration)) throw new Error('Profilo non valido per questa sessione.');
        return profile;
    }
    async read() {
        if (this.state.busy || !this.active || !this.authorityCurrent()) return;
        const request = ++this.request;
        const initial = this.state.current === null;
        this.publish({ busy: true, requiresRead: true, message: '' });
        try {
            const response = await this.transport('/api/auth/profile', { cache: 'no-store' });
            const body = await response.json();
            if (!this.current(request)) return;
            if (!response.ok) throw new Error('Lettura non riuscita. Verifica l’accesso e rileggi il profilo.');
            const profile = this.parse(body, true);
            this.apply(profile, () => this.current(request));
            this.publish({ current: profile, requiresRead: false,
                ...(initial ? { draft: { doctorName: profile.displayName ?? '', clinicName: profile.ambulatoryName ?? '' } } : {}),
                message: initial ? '' : 'Profilo riletto. Confronta i valori salvati con la tua bozza prima di salvare.',
            });
        } catch {
            if (this.current(request)) this.publish({ requiresRead: true, message: 'Lettura non riuscita. Verifica l’accesso e rileggi il profilo. La bozza è conservata.' });
        } finally {
            if (this.current(request)) this.publish({ busy: false });
        }
    }
    async save() {
        const expected = this.state.current;
        if (!expected || this.state.busy || this.state.requiresRead || !this.active || !this.authorityCurrent()) return;
        const request = ++this.request;
        const draft = this.state.draft;
        this.publish({ busy: true, message: '' });
        try {
            const response = await this.transport('/api/auth/profile', {
                method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-mediflow-archive-generation': expected.archiveGeneration },
                body: JSON.stringify({ expectedVersion: expected.profileVersion, displayName: draft.doctorName, ambulatoryName: draft.clinicName }),
            });
            const body = await response.json();
            if (!this.current(request)) return;
            if (response.status === 409 && body?.code === 'PROFILE_VERSION_CONFLICT') {
                const current = this.parse(body, false);
                this.publish({ current, requiresRead: true, message: 'Il profilo è cambiato su un altro dispositivo. La tua bozza è conservata. Rileggi e confronta i valori prima di salvare.' });
                return;
            }
            if (!response.ok || typeof body?.changed !== 'boolean') throw new Error('Salvataggio non confermato');
            const profile = this.parse(body, false);
            this.apply(profile, () => this.current(request));
            this.publish({ current: profile, draft: { doctorName: profile.displayName ?? '', clinicName: profile.ambulatoryName ?? '' },
                message: body.changed ? 'Profilo aggiornato.' : 'Il profilo è già aggiornato.' });
        } catch {
            if (this.current(request)) this.publish({ requiresRead: true, message: 'Salvataggio non confermato. La bozza è conservata. Verifica l’accesso e rileggi il profilo prima di riprovare.' });
        } finally {
            if (this.current(request)) this.publish({ busy: false });
        }
    }
}

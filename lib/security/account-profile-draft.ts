import type { AccountProfile, ProfileDraft } from './account-profile-editor';

type PendingProfile = { userId: string; archiveGeneration: string; draft: ProfileDraft };

export class AccountProfileDraftMemory {
    private pending: PendingProfile | null = null;
    retain(profile: AccountProfile | null, draft: ProfileDraft) {
        if (!profile) return;
        this.pending = draft.doctorName !== (profile.displayName ?? '') || draft.clinicName !== (profile.ambulatoryName ?? '')
            ? { userId: profile.userId, archiveGeneration: profile.archiveGeneration, draft: { ...draft } } : null;
    }
    resume(profile: AccountProfile): ProfileDraft | null {
        const pending = this.pending;
        this.pending = null;
        return pending?.userId === profile.userId && pending.archiveGeneration === profile.archiveGeneration
            ? { ...pending.draft } : null;
    }
    discard() { this.pending = null; }
}

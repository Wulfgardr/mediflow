type Correction = {
    correctedAt: string;
    correctedBy: string | null;
};

export type EntryRevision = Correction & {
    version: number;
    title: string | null;
    content: string | null;
};

export type EntryRevisionPage = {
    patientId: string;
    entryId: string;
    currentVersion: number;
    availableSince: string | null;
    latestCorrection: Correction | null;
    revisions: EntryRevision[];
    hasMore: boolean;
};

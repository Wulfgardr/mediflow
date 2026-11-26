import type { DossierAcquireOutcome, DossierDraftGroup } from './document-dossier-session';

export interface DossierFolderSettlement { safe: number; total: number }

function verified(outcome: DossierAcquireOutcome | undefined): boolean {
    return (outcome?.status === 'stored' || outcome?.status === 'reused') && outcome.verified;
}

/**
 * Quanti file della cartella scelta hanno l'originale in MediFlow, riletto identico. Conta tutti i gruppi
 * e i file lasciati fuori dalla lettura: un file non conservato tiene `safe` sotto `total`.
 */
export function dossierFolderSettlement(
    groups: readonly DossierDraftGroup[], outcomes: Readonly<Record<string, DossierAcquireOutcome>>, unread: number,
): DossierFolderSettlement {
    const sources = groups.flatMap((group) => group.sources);
    const preserved = new Set(sources.filter((source) => source.status === 'already_imported' || verified(outcomes[source.key])).map((source) => source.key));
    const safe = sources.filter((source) => preserved.has(source.key)
        || (source.status === 'duplicate_in_selection' && source.duplicateOf !== undefined && preserved.has(source.duplicateOf))).length;
    return { safe, total: sources.length + unread };
}

export function dossierFolderDeletionAdvice(settlement: DossierFolderSettlement): string | null {
    const { safe, total } = settlement;
    if (total === 0 || safe !== total) return null;
    const preserved = total === 1 ? 'Il file della cartella è in MediFlow, riletto identico.' : `Tutti i ${total} file della cartella sono in MediFlow, riletti identici.`;
    return `${preserved} Puoi cancellare la cartella dai Download.`;
}

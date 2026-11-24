export type DossierCreation = { groupKey: string; sourceKey: string } | null;

export function dossierCreationSource(creating: DossierCreation, groupKey: string, backupProposed: boolean): string | null {
    if (backupProposed || !creating || creating.groupKey !== groupKey) return null;
    return creating.sourceKey;
}

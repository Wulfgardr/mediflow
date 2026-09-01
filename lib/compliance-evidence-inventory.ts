/* @Codex */
export const COMPLIANCE_EVIDENCE_SCHEMA_VERSION = 'mediflow.compliance-evidence.v1' as const;

export type ComplianceEvidenceStatus =
    | 'source_evidence'
    | 'source_evidence_with_limit'
    | 'external_assessment_required';

export type ComplianceEvidenceReference = Readonly<{
    label: string;
    href: string;
}>;

export type ComplianceEvidenceRecord = Readonly<{
    id:
        | 'data_protection_by_design'
        | 'security_controls'
        | 'backup_and_restore'
        | 'data_subject_workflows'
        | 'ai_transparency'
        | 'legal_applicability';
    label: string;
    summary: string;
    status: ComplianceEvidenceStatus;
    evidence: readonly string[];
    limitation: string;
    owner: string;
    externalReferences: readonly ComplianceEvidenceReference[];
}>;

function evidenceRecord(record: ComplianceEvidenceRecord): ComplianceEvidenceRecord {
    return Object.freeze({
        ...record,
        evidence: Object.freeze([...record.evidence]),
        externalReferences: Object.freeze(
            record.externalReferences.map((reference) => Object.freeze({ ...reference })),
        ),
    });
}

export const COMPLIANCE_EVIDENCE_INVENTORY = Object.freeze({
    schemaVersion: COMPLIANCE_EVIDENCE_SCHEMA_VERSION,
    claimCeiling: 'technical_evidence_inventory_only' as const,
    legalVerdict: 'not_assessed' as const,
    records: Object.freeze([
        evidenceRecord({
            id: 'data_protection_by_design',
            label: 'Protezione dei dati per progettazione e impostazione predefinita',
            summary: 'Confini local-first, minimizzazione ed egress disabilitato per impostazione predefinita sono documentati nel sorgente.',
            status: 'source_evidence',
            evidence: ['SECURITY.md', 'ARCHITECTURE.md', 'docs/STATE_OF_THE_SYSTEM.md'],
            limitation: 'Configurazione del deployment, finalità e procedure dell’organizzazione non sono osservate da questa pagina.',
            owner: 'Responsabile tecnico del deployment',
            externalReferences: [],
        }),
        evidenceRecord({
            id: 'security_controls',
            label: 'Controlli tecnici di sicurezza',
            summary: 'Il sorgente include cifratura per campo, sessione autenticata e confini fail-closed documentati e testabili.',
            status: 'source_evidence_with_limit',
            evidence: ['lib/security/security.ts', 'lib/security/server-auth.ts', 'SECURITY.md'],
            limitation: 'Il file SQLite, i metadati e gli artefatti esportati non condividono tutti un perimetro whole-database verificato.',
            owner: 'Responsabile tecnico e responsabile della sicurezza',
            externalReferences: [],
        }),
        evidenceRecord({
            id: 'backup_and_restore',
            label: 'Backup e ripristino',
            summary: 'Preflight, formato artefatto e drill locale forniscono evidenza tecnica ripetibile sul percorso di ripristino.',
            status: 'source_evidence_with_limit',
            evidence: ['lib/backup-artifact.ts', 'lib/backup-restore-preflight.ts', 'scripts/backup-restore-drill.mjs'],
            limitation: 'Conservazione, copie esterne, frequenza dei drill e continuità operativa restano responsabilità del deployment.',
            owner: 'Operatore e responsabile del deployment',
            externalReferences: [],
        }),
        evidenceRecord({
            id: 'data_subject_workflows',
            label: 'Percorsi di accesso, portabilità ed erasure',
            summary: 'Export, tombstone reversibile e purge amministrativo sono superfici tecniche distinte con limiti documentati.',
            status: 'source_evidence_with_limit',
            evidence: ['lib/patient-cascade.ts', 'docs/COMPLIANCE.md', 'SECURITY.md'],
            limitation: 'Backup già esportati, tempi, identità del richiedente e completezza della risposta richiedono procedure organizzative separate.',
            owner: 'Titolare del trattamento e DPO',
            externalReferences: [],
        }),
        evidenceRecord({
            id: 'ai_transparency',
            label: 'Trasparenza delle funzioni AI',
            summary: 'Il registro Fabric separa dichiarato, osservato, venue, egress e proposte revisionabili senza autorizzare apply clinico.',
            status: 'source_evidence_with_limit',
            evidence: [
                'docs/capability-mapping/fabric-generative-runtime-crosswalk.v1.json',
                'lib/ai-providers/fabric/status.ts',
                'app/settings/ai/fabric/page.tsx',
            ],
            limitation: 'Senza receipt dell’operazione corrente, esecuzione, venue ed egress effettivi restano non osservati.',
            owner: 'Responsabile tecnico e governance clinica',
            externalReferences: [],
        }),
        evidenceRecord({
            id: 'legal_applicability',
            label: 'Applicabilità normativa e valutazione legale',
            summary: 'Le fonti ufficiali sono riferimenti esterni per una valutazione svolta sul deployment e sul caso concreto.',
            status: 'external_assessment_required',
            evidence: ['docs/COMPLIANCE.md'],
            limitation: 'MediFlow non classifica il proprio deployment, non assegna ruoli privacy e non produce una certificazione o un parere legale.',
            owner: 'Organizzazione, referente legale e DPO',
            externalReferences: [
                {
                    label: 'GDPR, articolo 25',
                    href: 'https://eur-lex.europa.eu/eli/reg/2016/679/art_25/oj/eng',
                },
                {
                    label: 'GDPR, articolo 32',
                    href: 'https://eur-lex.europa.eu/eli/reg/2016/679/art_32/oj/eng',
                },
                {
                    label: 'Regolamento (UE) 2024/1689 (AI Act)',
                    href: 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj?locale=en',
                },
            ],
        }),
    ] satisfies readonly ComplianceEvidenceRecord[]),
});

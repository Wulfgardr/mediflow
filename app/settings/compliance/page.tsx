import { Disclosure } from '@/components/disclosure';
import styles from '@/components/settings/evidence-pages.module.css';
import { COMPLIANCE_EVIDENCE_INVENTORY, type ComplianceEvidenceStatus } from '@/lib/compliance-evidence-inventory';

const STATUS_COPY: Readonly<Record<ComplianceEvidenceStatus, string>> = Object.freeze({
    source_evidence: 'Evidenza nel sorgente',
    source_evidence_with_limit: 'Evidenza con limite esplicito',
    external_assessment_required: 'Valutazione esterna necessaria',
});

export default function SettingsCompliancePage() {
    return (
        <section className={styles.page} data-testid="settings-compliance-section">
            <header className={styles.intro}>
                <h2>Evidenze e conformità</h2>
                <p>Inventario di evidenze, non attestazione: mostra cosa documenta il sorgente e cosa resta da valutare nel deployment.</p>
            </header>
            <section className={styles.section} aria-labelledby="compliance-claim-limit">
                <h3 id="compliance-claim-limit" className={styles.heading}>Nessun verdetto legale</h3>
                <p>Lo stato legale non è valutato. Le evidenze tecniche possono supportare una verifica,
                    ma non determinano applicabilità, ruoli, adempimenti o certificazioni.</p>
            </section>
            <div>
                {COMPLIANCE_EVIDENCE_INVENTORY.records.map(record => (
                    <article key={record.id} className={styles.section} data-testid={`compliance-evidence-${record.id}`}>
                        <h3 className={styles.heading}>{record.label}</h3>
                        <p className={styles.recordStatus} data-compliance-status={record.status}>{STATUS_COPY[record.status]}</p>
                        <p>{record.summary}</p>
                        <dl className={styles.definition}>
                            <div><dt>Limite</dt><dd>{record.limitation}</dd></div>
                        </dl>
                        <Disclosure title="Evidenze, responsabile e fonti" className={styles.details}>
                            <p className={styles.detailLabel}>Evidenze consultabili nel repository</p>
                            <ul className={styles.evidence}>
                                {record.evidence.map(evidence => <li key={evidence}>{evidence}</li>)}
                            </ul>
                            <dl className={styles.definition}>
                                <div><dt>Owner della verifica</dt><dd>{record.owner}</dd></div>
                            </dl>
                            {record.externalReferences.length > 0 ? <div>
                                <p className={styles.detailLabel}>Fonti ufficiali esterne</p>
                                <ul className={styles.references}>
                                    {record.externalReferences.map(reference => <li key={reference.href}>
                                        <a href={reference.href} target="_blank" rel="noopener noreferrer">{reference.label}</a>
                                    </li>)}
                                </ul>
                            </div> : null}
                        </Disclosure>
                    </article>
                ))}
            </div>
        </section>
    );
}

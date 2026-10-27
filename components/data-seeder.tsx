'use client';

import { formatCountLabel } from '@/lib/format-count';
import { useState } from 'react';
import { seedDatabase, nukeTestData, SeederIncompleteError } from '@/lib/seeder';
import { Plus } from 'lucide-react';
import { Disclosure } from '@/components/disclosure';
import styles from '@/components/settings/maintenance-pages.module.css';
import { SETTINGS_PRIMARY_BUTTON_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS } from '@/components/settings/settings-ui';
import { useToast } from '@/components/ui/toast-provider';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { RangeInput } from '@/components/range-input';

export default function DataSeeder() {
    const { showToast } = useToast();
    const confirm = useConfirm();
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [nuking, setNuking] = useState(false);
    const [progress, setProgress] = useState({ current: 0, total: 0 });

    const [nukeAll, setNukeAll] = useState(false);

    // Options
    const [patientCount, setPatientCount] = useState(10);
    const [includeEntries, setIncludeEntries] = useState(true);
    const [includeTherapies, setIncludeTherapies] = useState(true);
    const [includeConditions, setIncludeConditions] = useState(true);

    const handleStressTest = () => {
        setPatientCount(50);
        setIncludeEntries(true);
        setIncludeTherapies(true);
        setIncludeConditions(true);
    };

    const handleSeed = async () => {
        console.log("Seeder: Start requested", { patientCount, includeEntries });
        const seedConfirm = await confirm({
            title: 'Genera pazienti di test',
            message: `Stai per generare ${formatCountLabel(patientCount, 'paziente di test', 'pazienti di test')}. Procedere?`,
            confirmLabel: 'Genera',
            tone: 'danger'
        });
        if (!seedConfirm.confirmed) return;

        setLoading(true);
        setProgress({ current: 0, total: patientCount });

        try {
            console.log("Seeder: Calling seedDatabase...");
            const result = await seedDatabase({
                patientCount,
                includeEntries,
                includeTherapies,
                includeConditions,
                onProgress: (current, total) => {
                    console.log(`Seeder Progress: ${current}/${total}`);
                    setProgress({ current, total });
                }
            });
            console.log("Seeder: Success", result);
            showToast({ tone: 'success', title: 'Pazienti di test generati', description: formatCountLabel(result.count, 'Generato {count} paziente di test.', 'Generati {count} pazienti di test.', { template: true }) });
            window.setTimeout(() => window.location.reload(), 1200);
        } catch (e) {
            console.error("Seeder Error Caught:", e);
            const msg = e instanceof SeederIncompleteError ? e.message : 'Generazione non completata. Alcuni dati potrebbero essere già stati salvati. Ricarica l’elenco prima di proseguire.';
            showToast({ tone: 'error', title: 'Errore durante la generazione', description: msg });
            // Do not clear progress on error so user can see where it failed
        } finally {
            console.log("Seeder: finally block");
            setLoading(false);
            // Only clear progress if successful (handled by reload) or if we want to reset manually. 
            // We leave it visible for debug.
        }
    };

    const handleNuke = async () => {
        const nukeConfirm = await confirm({
            title: nukeAll ? 'Eliminazione estesa' : 'Elimina dati di test',
            message: nukeAll
                ? 'Elimina tutti i pazienti, inclusi quelli reali, e tutte le voci, terapie, controlli, allegati, conversazioni e messaggi.'
                : 'Elimina i pazienti identificati come test e i dati collegati previsti dalla pulizia.',
            confirmLabel: 'Elimina',
            tone: 'danger'
        });
        if (!nukeConfirm.confirmed) return;

        setNuking(true);
        try {
            const result = await nukeTestData(nukeAll);
            showToast({ tone: 'success', title: 'Eliminazione completata', description: result.mode === 'full'
                ? 'Reset totale completato.'
                : `${formatCountLabel(result.deleted, 'Eliminato {count} paziente', 'Eliminati {count} pazienti', { template: true })} e completata la pulizia dei dati collegati.` });
            window.setTimeout(() => window.location.reload(), 1200);
        } catch (e) {
            console.error(e);
            showToast({ tone: 'error', title: "Eliminazione non completata", description: e instanceof SeederIncompleteError ? e.message : "Alcuni dati potrebbero essere già stati eliminati. Ricarica l’elenco prima di riprovare." });
        } finally {
            setNuking(false);
        }
    };

    return (
        <section className={styles.section} data-testid="settings-data-seeder">
            <Disclosure title="Generatore di dati di test" headingLevel={3} open={isOpen} onOpenChange={setIsOpen}>
                <div className={styles.seederForm}>
                    <p>Genera pazienti e documenti sintetici per verificare la postazione.</p>
                    <label className={styles.rangeLabel}>Numero Pazienti <span>{patientCount}</span>
                        <RangeInput min={1} max={500} value={patientCount} onChange={e => setPatientCount(Number(e.target.value))} title="Numero Pazienti" aria-label="Seleziona il numero di pazienti da generare" />
                    </label>
                    <button onClick={handleStressTest} className={SETTINGS_SECONDARY_BUTTON_CLASS}>Preset: Stress Test (50 pazienti complessi)</button>
                    <div className={styles.options}>
                        <label><input type="checkbox" checked={includeEntries} onChange={e => setIncludeEntries(e.target.checked)} />Diario</label>
                        <label><input type="checkbox" checked={includeTherapies} onChange={e => setIncludeTherapies(e.target.checked)} />Terapie</label>
                        <label><input type="checkbox" checked={includeConditions} onChange={e => setIncludeConditions(e.target.checked)} />ICD-11</label>
                    </div>
                    <div className={styles.actions}><button onClick={handleSeed} disabled={loading || nuking} className={SETTINGS_PRIMARY_BUTTON_CLASS} data-settings-primary="true"><Plus aria-hidden />{loading ? `Generazione... (${progress.current}/${progress.total})` : 'Genera'}</button></div>
                    <section className={styles.section}>
                        <h4 className={styles.heading}>{nukeAll ? 'Eliminazione estesa' : 'Elimina dati di test'}</h4>
                        <p>{nukeAll ? 'Elimina tutti i pazienti, inclusi quelli reali, e tutte le voci, terapie, controlli, allegati, conversazioni e messaggi.' : 'Elimina i pazienti identificati come test e i dati collegati previsti dalla pulizia.'}</p>
                        <label className={styles.checkLabel}><input type="checkbox" checked={nukeAll} onChange={e => setNukeAll(e.target.checked)} />Eliminazione estesa</label>
                        <div className={styles.actions}><button onClick={handleNuke} disabled={loading || nuking} className={SETTINGS_SECONDARY_BUTTON_CLASS}>{nuking ? 'Eliminazione...' : 'Elimina'}</button></div>
                    </section>
                    <p className={styles.meta}>I pazienti generati avranno codice fiscale che inizia con &quot;TEST-&quot; per distinguerli dai reali.</p>
                </div>
            </Disclosure>
            {loading && <div role="status" className={styles.progress}><p>Generazione in corso...</p><p>{progress.current} / {progress.total}</p><progress max={progress.total} value={progress.current} aria-label="Generazione in corso..." /></div>}
            {nuking && <p role="status">Eliminazione...</p>}
        </section>
    );
}

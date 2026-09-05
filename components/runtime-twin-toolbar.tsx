'use client';

/* @Codex WUL-676: local design comparison; never changes clinical state. */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './runtime-twin-toolbar.module.css';

export function RuntimeTwinToolbar() {
    const [proposal, setProposal] = useState(true);

    useEffect(() => {
        document.documentElement.dataset.runtimeTwinDesign = proposal ? 'proposal' : 'original';
    }, [proposal]);

    return (
        <aside className={styles.toolbar} aria-label="Confronto del prototipo" data-testid="runtime-twin-toolbar">
            <span className={styles.identity}><strong>MediFlow 0.8.6</strong><span>Prototipo · dati sintetici</span></span>
            <nav className={styles.destinations} aria-label="Esplora il prototipo">
                <Link href="/?area=incarico">Pazienti</Link>
                <Link href="/settings">Impostazioni</Link>
                <Link href="/analytics">Analisi</Link>
                <Link href="/scales">Scale</Link>
            </nav>
            <div className={styles.comparison} role="group" aria-label="Versione del design">
                <button type="button" aria-pressed={!proposal} onClick={() => setProposal(false)}>Originale</button>
                <button type="button" aria-pressed={proposal} onClick={() => setProposal(true)}>Proposta</button>
            </div>
        </aside>
    );
}

'use client';

/* @Codex WUL-676: local design comparison; never changes clinical state. */
import { useRuntimeTwinDesign } from './runtime-twin-design';
import styles from './runtime-twin-toolbar.module.css';

export function RuntimeTwinToolbar() {
    const { proposal, setProposal, composition, setComposition } = useRuntimeTwinDesign();

    return (
        <aside className={styles.toolbar} aria-label="Confronto del prototipo" data-testid="runtime-twin-toolbar">
            <span className={styles.identity}><strong>MediFlow 0.8.6</strong><span>Studio di interfaccia · dati sintetici</span></span>
            <div className={styles.comparison} role="group" aria-label="Versione del design">
                <button type="button" aria-pressed={!proposal} onClick={() => setProposal(false)}>Originale</button>
                <button type="button" aria-pressed={proposal && composition === 'workbench'} onClick={() => { setComposition('workbench'); setProposal(true); }}>A · Postazione</button>
                <button type="button" aria-pressed={proposal && composition === 'stream'} onClick={() => { setComposition('stream'); setProposal(true); }}>B · Diario</button>
            </div>
        </aside>
    );
}

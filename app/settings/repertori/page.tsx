'use client';

import { useEffect, useState } from 'react';
import AifaCatalogManager from '@/components/settings/aifa-catalog-manager';
import DrugCatalogImportPanel from '@/components/settings/drug-catalog-import-panel';
import ExemptionDbManager from '@/components/settings/exemption-db-manager';
import ProstheticsCatalogManager from '@/components/prosthetics-catalog-manager';
import { WhoSetupPanel } from '@/components/settings/who-setup-panel';
import styles from './repertori.module.css';

export default function SettingsRepertoriPage() {
    const [active, setActive] = useState<string | null>(null);
    useEffect(() => {
        const followAnchor = () => { if (window.location.hash === '#who-setup') setActive('who'); };
        followAnchor(); window.addEventListener('hashchange', followAnchor);
        return () => window.removeEventListener('hashchange', followAnchor);
    }, []);
    const panel = (id: string) => ({ expanded: active === id, onExpandedChange: (value: boolean) => setActive(value ? id : null) });
    return <section className={styles.page} data-testid="settings-repertori-section">
        <header className={styles.intro}>
            <h2 className="type-section">Repertori</h2>
            <p>Farmaci (AIFA o altra agenzia), esenzioni, protesica e codici ICD-11: fonti e aggiornamenti dei repertori.</p>
        </header>
        <div className={styles.rows}>
            <AifaCatalogManager {...panel('aifa')} />
            <DrugCatalogImportPanel {...panel('farmaci-altra-fonte')} />
            <ExemptionDbManager {...panel('esenzioni')} />
            <ProstheticsCatalogManager {...panel('protesica')} />
            <WhoSetupPanel {...panel('who')} />
        </div>
    </section>;
}

'use client';

import { useEffect, useState } from 'react';
import AifaCatalogManager from '@/components/settings/aifa-catalog-manager';
import DrugCatalogImportPanel from '@/components/settings/drug-catalog-import-panel';
import ExemptionDbManager from '@/components/settings/exemption-db-manager';
import ProstheticsCatalogManager from '@/components/prosthetics-catalog-manager';
import { ServicePackageCandidatesPanel } from '@/components/settings/service-package-candidates-panel';
import { WhoSetupPanel } from '@/components/settings/who-setup-panel';
import styles from './repertori.module.css';

export default function SettingsRepertoriPage() {
    const [active, setActive] = useState<string | null>(null);
    useEffect(() => {
        const followAnchor = () => {
            if (window.location.hash === '#who-setup') setActive('who');
            else if (window.location.hash === '#candidati-pacchetti') setActive('candidati-pacchetti');
        };
        followAnchor(); window.addEventListener('hashchange', followAnchor);
        return () => window.removeEventListener('hashchange', followAnchor);
    }, []);
    const panel = (id: string) => ({ expanded: active === id, onExpandedChange: (value: boolean) => setActive(value ? id : null) });
    return <section className={styles.page} data-testid="settings-repertori-section">
        <header className={styles.intro}>
            <h2>Repertori</h2>
            <p>Farmaci (AIFA o altra agenzia), esenzioni, protesica, codici ICD-11 e gruppi di prestazioni ricorrenti.</p>
        </header>
        <div className={styles.rows}>
            <AifaCatalogManager {...panel('aifa')} />
            <DrugCatalogImportPanel {...panel('farmaci-altra-fonte')} />
            <ExemptionDbManager {...panel('esenzioni')} />
            <ProstheticsCatalogManager {...panel('protesica')} />
            <WhoSetupPanel {...panel('who')} />
            <ServicePackageCandidatesPanel {...panel('candidati-pacchetti')} />
        </div>
    </section>;
}

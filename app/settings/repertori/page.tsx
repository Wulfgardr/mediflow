'use client';

/* @Codex: each guided surface owns its UI lifecycle; no installation is triggered here. */
import AifaCatalogManager from '@/components/settings/aifa-catalog-manager';
import ExemptionDbManager from '@/components/settings/exemption-db-manager';
import ProstheticsCatalogManager from '@/components/prosthetics-catalog-manager';
import { WhoSetupPanel } from '@/components/settings/who-setup-panel';
import { SettingsSectionIntro } from '@/components/settings/settings-ui';

export default function SettingsRepertoriPage() {
    return <section className="space-y-4" data-testid="settings-repertori-section">
        <SettingsSectionIntro kicker="Dati e sicurezza" title="Repertori"
            description="Farmaci AIFA, esenzioni, protesica e codici ICD-11: fonti e aggiornamenti dei repertori." />
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
            <AifaCatalogManager />
            <ExemptionDbManager />
            <ProstheticsCatalogManager />
            <WhoSetupPanel />
        </div>
    </section>;
}

import { SettingsMigrationPlaceholder } from '@/components/settings/settings-ui';

// WUL-297 — skeleton sub-route, populated in a later migration phase.
export default function Page() {
    return (
        <SettingsMigrationPlaceholder
            kicker="Sicurezza e Dati"
            title="Repertori"
            legacyHref="/settings#data"
            legacyLabel="Apri repertori nelle impostazioni complete"
        />
    );
}

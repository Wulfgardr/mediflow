import { SettingsMigrationPlaceholder } from '@/components/settings/settings-ui';

// WUL-297 — skeleton sub-route, populated in a later migration phase.
export default function Page() {
    return (
        <SettingsMigrationPlaceholder
            kicker="Avanzate"
            title="Zona Pericolo"
            legacyHref="/settings#operations"
            legacyLabel="Apri zona pericolo nelle impostazioni complete"
        />
    );
}

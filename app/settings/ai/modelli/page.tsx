import { SettingsMigrationPlaceholder } from '@/components/settings/settings-ui';

// WUL-297 — skeleton sub-route, populated in a later migration phase.
export default function Page() {
    return (
        <SettingsMigrationPlaceholder
            kicker="Intelligenza Artificiale"
            title="Modelli e Hardware"
            legacyHref="/settings#ai"
            legacyLabel="Apri AI locale nelle impostazioni complete"
        />
    );
}

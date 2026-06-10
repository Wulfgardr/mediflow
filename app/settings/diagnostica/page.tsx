'use client';

// WUL-297 — Diagnostica: moved from the monolithic settings page.

import DiagnosticHub from '@/components/diagnostic-hub';
import ServiceArchitecturePanel from '@/components/service-architecture-panel';
/* @Codex */
import UpdateAwarenessPanel from '@/components/settings/update-awareness-panel';
import { SettingsSectionIntro } from '@/components/settings/settings-ui';

export default function SettingsDiagnosticsPage() {
    return (
        <section className="space-y-4" data-testid="settings-diagnostics-section">
            <SettingsSectionIntro
                kicker="Avanzate"
                title="Diagnostica"
                description="Stato dei servizi locali, architettura della postazione e aggiornamenti software."
            />

            <div className="space-y-6">
                <ServiceArchitecturePanel />
                <DiagnosticHub />
                <UpdateAwarenessPanel />
            </div>
        </section>
    );
}

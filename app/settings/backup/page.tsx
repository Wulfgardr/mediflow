'use client';

// WUL-297 Backup e Ripristino: moved from the monolithic settings page.

import BackupRestoreUI from '@/components/backup-restore-ui';
import BackupSchedulerUI from '@/components/backup-scheduler-ui';
import { SettingsSectionIntro } from '@/components/settings/settings-ui';

export default function SettingsBackupPage() {
    return (
        <section className="space-y-4" data-testid="settings-backup-section">
            <SettingsSectionIntro
                kicker="Backup"
                title="Continuità e ripristino"
                description="Schedulazione automatica e ripristino manuale degli archivi cifrati locali."
            />
            <div className="space-y-6">
                <BackupSchedulerUI />
                <BackupRestoreUI />
            </div>
        </section>
    );
}

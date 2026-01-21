import BackupRestoreUI from '@/components/backup-restore-ui';

export default function SettingsPage() {
    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold text-gray-800 dark:text-white tracking-tight">Impostazioni</h1>
            <p className="text-gray-500 dark:text-gray-400">
                Gestisci la sicurezza e i dati della tua cartella clinica.
            </p>

            <div className="max-w-3xl">
                <BackupRestoreUI />
            </div>
        </div>
    );
}

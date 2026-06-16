import { redirect } from 'next/navigation';

// WUL-297: /settings/ai defaults to the models surface.
export default function SettingsAiIndexPage() {
    redirect('/settings/ai/modelli');
}

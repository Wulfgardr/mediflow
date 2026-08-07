import { redirect } from 'next/navigation';

// @Codex WUL-522: the read-only Fabric registry is the AI settings entrypoint.
export default function SettingsAiIndexPage() {
    redirect('/settings/ai/fabric');
}

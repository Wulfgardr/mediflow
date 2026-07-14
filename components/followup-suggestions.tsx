'use client';

import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { CalendarPlus } from 'lucide-react';
import { db } from '@/lib/db';
import PrivacyBlur from '@/components/privacy-blur';
import type { FollowupSuggestion } from '@/lib/patient-followup-projection';

interface FollowupSuggestionsProps {
    patientId: string;
    suggestions: FollowupSuggestion[];
    /* Titoli dei checkup gia presenti (normalizzati) per nascondere i suggeriti gia accettati. */
    existingTitles: string[];
}

function todayInputValue(): string {
    // La data odierna in formato yyyy-mm-dd per l'input date, calcolata localmente.
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export default function FollowupSuggestions({ patientId, suggestions, existingTitles }: FollowupSuggestionsProps) {
    const [openId, setOpenId] = useState<string | null>(null);
    const [title, setTitle] = useState('');
    const [date, setDate] = useState('');
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const existing = new Set(existingTitles.map((t) => t.trim().toLowerCase()));
    const visible = suggestions.filter((s) => !existing.has(s.label.trim().toLowerCase()));
    if (visible.length === 0) return null;

    const openForm = (suggestion: FollowupSuggestion) => {
        setOpenId(suggestion.id);
        setTitle(suggestion.label);
        setDate(todayInputValue());
        setNotes(`${suggestion.excerpt}\nSuggerito da ${suggestion.citation.fileName}`);
        setError(null);
    };

    const confirm = async () => {
        if (!title.trim() || !date) {
            setError('Inserisci titolo e data.');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await db.checkups.add({
                id: uuidv4(),
                patientId,
                date: new Date(date),
                title: title.trim(),
                notes: notes.trim() || undefined,
                status: 'pending',
                source: 'ai_suggestion',
                createdAt: new Date(),
            });
            setOpenId(null);
        } catch {
            setError('Non e stato possibile creare il follow-up. Riprova.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="mt-3 space-y-2 border-t border-[color:rgba(112,106,100,0.12)] pt-3 dark:border-[color:rgba(255,247,240,0.08)]">
            <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--lume-ink-muted)]">
                Trovati nei documenti, da valutare
            </p>
            {visible.map((suggestion) => (
                <div
                    key={suggestion.id}
                    className="rounded-[12px] border border-dashed border-[color:rgba(112,106,100,0.2)] px-4 py-3 dark:border-[color:rgba(255,247,240,0.14)]"
                >
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-sm font-medium text-[color:var(--lume-ink)]">{suggestion.label}</p>
                            {suggestion.excerpt ? (
                                <p className="mt-1 text-xs leading-5 text-[color:var(--lume-ink-muted)]">
                                    <PrivacyBlur intensity="sm">{suggestion.excerpt}</PrivacyBlur>
                                </p>
                            ) : null}
                            <p className="mt-1.5 text-[11px] text-[color:var(--lume-ink-muted)]">
                                Trovato in {suggestion.citation.fileName}
                                {suggestion.citation.documentDate ? ` · ${new Date(suggestion.citation.documentDate).toLocaleDateString('it-IT')}` : ''}
                            </p>
                        </div>
                        {openId !== suggestion.id ? (
                            <button
                                type="button"
                                onClick={() => openForm(suggestion)}
                                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[color:rgba(112,106,100,0.2)] px-3 py-1.5 text-xs font-medium text-[color:var(--lume-ink)] transition-colors hover:bg-white/60 dark:border-[color:rgba(255,247,240,0.14)] dark:hover:bg-white/5"
                            >
                                <CalendarPlus className="h-3.5 w-3.5" />
                                Crea follow-up
                            </button>
                        ) : null}
                    </div>

                    {openId === suggestion.id ? (
                        <div className="mt-3 space-y-2 border-t border-[color:rgba(112,106,100,0.12)] pt-3">
                            <label className="block text-[11px] font-medium text-[color:var(--lume-ink-muted)]">
                                Titolo
                                <input
                                    className="input-field mt-1 w-full"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                />
                            </label>
                            <label className="block text-[11px] font-medium text-[color:var(--lume-ink-muted)]">
                                Data
                                <input
                                    type="date"
                                    className="input-field mt-1 w-full"
                                    value={date}
                                    onChange={(e) => setDate(e.target.value)}
                                />
                            </label>
                            <label className="block text-[11px] font-medium text-[color:var(--lume-ink-muted)]">
                                Note
                                <textarea
                                    className="input-field mt-1 w-full"
                                    rows={2}
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                />
                            </label>
                            {error ? <p className="text-xs text-[color:var(--lume-signal-critical)]">{error}</p> : null}
                            <div className="flex items-center gap-2 pt-1">
                                <button
                                    type="button"
                                    onClick={confirm}
                                    disabled={saving}
                                    className="rounded-full bg-[color:var(--lume-ink)] px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                                >
                                    {saving ? 'Creazione...' : 'Conferma'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setOpenId(null)}
                                    disabled={saving}
                                    className="rounded-full px-3 py-1.5 text-xs font-medium text-[color:var(--lume-ink-muted)] hover:text-[color:var(--lume-ink)]"
                                >
                                    Annulla
                                </button>
                            </div>
                        </div>
                    ) : null}
                </div>
            ))}
        </div>
    );
}

'use client';

/* @Codex */
import { type FormEvent, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { db, type SissHandoffEvent, type SissHandoffOutcome } from '@/lib/db';
import { useLiveQuery } from '@/lib/live-query';

type Props = {
    patientId: string;
    embedded?: boolean;
};

type FormState = {
    action: string;
    moduleLabel: string;
    reason: string;
    outcome: SissHandoffOutcome;
    nextAction: string;
    notes: string;
};

const MODULE_OPTIONS = [
    { action: 'registry.lookup', label: 'Anagrafe' },
    { action: 'fse.lookup', label: 'FSE' },
    { action: 'prescription.create', label: 'Modulo prescrittivo' },
    { action: 'prosthetics.open', label: 'Protesica-RL' },
    { action: 'menu.open', label: 'Menu SISS' },
];

const OUTCOME_OPTIONS: Array<{ value: SissHandoffOutcome; label: string }> = [
    { value: 'started', label: 'Avviato' },
    { value: 'completed', label: 'Completato' },
    { value: 'blocked', label: 'Bloccato' },
    { value: 'cancelled', label: 'Annullato' },
];

function emptyForm(): FormState {
    return {
        action: 'registry.lookup',
        moduleLabel: 'Anagrafe',
        reason: '',
        outcome: 'completed',
        nextAction: '',
        notes: '',
    };
}

function optionalValue(value: string): string | undefined {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function formatDate(value: Date | string | undefined): string {
    if (!value) return 'Non indicato';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('it-IT', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

function outcomeLabel(value: SissHandoffOutcome): string {
    return OUTCOME_OPTIONS.find((item) => item.value === value)?.label ?? value;
}

export default function SissHandoffDiary({ patientId, embedded = false }: Props) {
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState<FormState>(() => emptyForm());
    const [closureNotes, setClosureNotes] = useState('');
    const [closureNextAction, setClosureNextAction] = useState('');
    const [closureOutcome, setClosureOutcome] = useState<SissHandoffOutcome>('completed');

    const handoffs = useLiveQuery(
        async () => {
            const items = await db.sissHandoffs
                .filter((item: SissHandoffEvent) => item.patientId === patientId)
                .toArray();
            return items.sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime());
        },
        [patientId],
    );

    const pendingHandoff = useMemo(
        () => handoffs?.find((item) => item.outcome === 'started') ?? null,
        [handoffs],
    );

    const updateForm = <K extends keyof FormState>(key: K, value: FormState[K]) => {
        setForm((current) => ({ ...current, [key]: value }));
    };

    const handleModuleChange = (action: string) => {
        const option = MODULE_OPTIONS.find((item) => item.action === action);
        setForm((current) => ({
            ...current,
            action,
            moduleLabel: option?.label ?? current.moduleLabel,
        }));
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError(null);
        setIsSaving(true);
        try {
            const now = new Date();
            await db.sissHandoffs.add({
                id: crypto.randomUUID(),
                patientId,
                action: form.action,
                moduleLabel: form.moduleLabel,
                reason: optionalValue(form.reason),
                startedAt: now,
                completedAt: form.outcome === 'started' ? undefined : now,
                outcome: form.outcome,
                nextAction: optionalValue(form.nextAction),
                notes: optionalValue(form.notes),
                createdAt: now,
                updatedAt: now,
            });
            setForm(emptyForm());
            setIsFormOpen(false);
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : 'Salvataggio passaggio SISS non riuscito.');
        } finally {
            setIsSaving(false);
        }
    };

    const closePendingHandoff = async () => {
        if (!pendingHandoff) return;
        setError(null);
        setIsSaving(true);
        try {
            await db.sissHandoffs.update(pendingHandoff.id, {
                outcome: closureOutcome,
                completedAt: new Date(),
                nextAction: optionalValue(closureNextAction),
                notes: optionalValue(closureNotes),
                updatedAt: new Date(),
            });
            setClosureNotes('');
            setClosureNextAction('');
            setClosureOutcome('completed');
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : 'Chiusura passaggio SISS non riuscita.');
        } finally {
            setIsSaving(false);
        }
    };

    const deleteItem = async (item: SissHandoffEvent) => {
        const confirmed = confirm(`Eliminare la voce SISS "${item.moduleLabel}"?`);
        if (!confirmed) return;
        await db.sissHandoffs.delete(item.id);
    };

    const headerActions = (
        <>
            <span className="apple-chip">{handoffs?.length ?? 0} passaggi</span>
            <span className="apple-chip">{handoffs?.filter((item) => item.outcome === 'started').length ?? 0} aperti</span>
            <button
                type="button"
                onClick={() => setIsFormOpen((value) => !value)}
                className="ui-btn-primary h-10 px-4 text-sm font-semibold"
            >
                <Plus className="h-4 w-4" />
                Registra
            </button>
        </>
    );

    return (
        <section className={embedded ? '' : 'patient-detail-section rounded-[20px] border p-5 md:p-6'}>
            {embedded ? (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <p className="section-kicker">Diario portali regionali</p>
                    <div className="flex flex-wrap items-center gap-2">{headerActions}</div>
                </div>
            ) : (
                <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                        <p className="section-kicker">SISS</p>
                        <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold text-[color:var(--mf-ink)]">
                            <ClipboardCheck className="h-5 w-5 text-[color:var(--mf-primary)]" />
                            Diario portali regionali
                        </h2>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--mf-muted)]">
                            Registra il motivo dell&apos;apertura del portale, l&apos;esito e il prossimo passo. Il dato resta locale: l&apos;atto regionale avviene nel portale ufficiale.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">{headerActions}</div>
                </div>
            )}

            {pendingHandoff ? (
                <div className="mb-5 rounded-[18px] border border-amber-200 bg-amber-50/80 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-amber-700">Da chiudere</p>
                            <h3 className="mt-1 text-sm font-semibold text-[color:var(--mf-ink)]">
                                {pendingHandoff.moduleLabel} aperto {formatDate(pendingHandoff.startedAt)}
                            </h3>
                            {pendingHandoff.reason ? (
                                <p className="mt-1 text-xs leading-5 text-[color:var(--mf-muted)]">{pendingHandoff.reason}</p>
                            ) : null}
                        </div>
                        <select
                            className="input-field h-10 max-w-44"
                            value={closureOutcome}
                            onChange={(event) => setClosureOutcome(event.target.value as SissHandoffOutcome)}
                        >
                            {OUTCOME_OPTIONS.filter((item) => item.value !== 'started').map((item) => (
                                <option key={item.value} value={item.value}>{item.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--mf-muted)]">
                            Cosa va ricordato
                            <textarea className="input-field min-h-20" value={closureNotes} onChange={(event) => setClosureNotes(event.target.value)} />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--mf-muted)]">
                            Prossima azione
                            <textarea className="input-field min-h-20" value={closureNextAction} onChange={(event) => setClosureNextAction(event.target.value)} />
                        </label>
                    </div>
                    <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => void closePendingHandoff()}
                        className="mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-[12px] bg-[color:var(--mf-ink)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[color:var(--mf-primary)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {isSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        Chiudi passaggio
                    </button>
                </div>
            ) : null}

            {isFormOpen && (
                <form onSubmit={handleSubmit} className="mb-5 rounded-[18px] border border-[color:rgba(112,106,100,0.12)] bg-white/78 p-4">
                    <div className="grid gap-3 md:grid-cols-2">
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--mf-muted)]">
                            Modulo
                            <select className="input-field" value={form.action} onChange={(event) => handleModuleChange(event.target.value)}>
                                {MODULE_OPTIONS.map((item) => <option key={item.action} value={item.action}>{item.label}</option>)}
                            </select>
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--mf-muted)]">
                            Esito
                            <select className="input-field" value={form.outcome} onChange={(event) => updateForm('outcome', event.target.value as SissHandoffOutcome)}>
                                {OUTCOME_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                            </select>
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--mf-muted)] md:col-span-2">
                            Perché ho aperto il portale
                            <input className="input-field" value={form.reason} onChange={(event) => updateForm('reason', event.target.value)} placeholder="Verifica anagrafica, prescrizione, consultazione FSE..." />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--mf-muted)]">
                            Cosa va ricordato
                            <textarea className="input-field min-h-24" value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--mf-muted)]">
                            Prossima azione
                            <textarea className="input-field min-h-24" value={form.nextAction} onChange={(event) => updateForm('nextAction', event.target.value)} />
                        </label>
                    </div>
                    {error ? <p className="mt-3 text-xs font-semibold text-rose-700">{error}</p> : null}
                    <div className="mt-4 flex justify-end">
                        <button type="submit" disabled={isSaving} className="ui-btn-primary h-10 px-4 text-sm font-semibold">
                            {isSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                            Salva voce
                        </button>
                    </div>
                </form>
            )}

            {error && !isFormOpen ? <p className="mb-3 text-xs font-semibold text-rose-700">{error}</p> : null}

            {!handoffs || handoffs.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-[color:rgba(112,106,100,0.18)] px-4 py-6 text-center">
                    <p className="text-sm text-[color:var(--mf-muted)]">
                        Nessun passaggio SISS registrato per questo paziente.
                    </p>
                </div>
            ) : (
                <div className="grid gap-3">
                    {handoffs.slice(0, 6).map((item) => (
                        <div key={item.id} className="rounded-[18px] border border-[color:rgba(112,106,100,0.12)] bg-white/78 px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-sm font-semibold text-[color:var(--mf-ink)]">{item.moduleLabel}</p>
                                    <p className="mt-1 text-xs text-[color:var(--mf-muted)]">
                                        {formatDate(item.startedAt)} · {outcomeLabel(item.outcome)}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void deleteItem(item)}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] border border-[color:rgba(112,106,100,0.12)] text-[color:var(--mf-muted)] transition-colors hover:border-rose-200 hover:text-rose-700"
                                    aria-label="Elimina passaggio SISS"
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            </div>
                            {item.reason ? <p className="mt-2 text-xs leading-5 text-[color:var(--mf-muted)]">{item.reason}</p> : null}
                            {item.notes ? <p className="mt-2 text-sm leading-6 text-[color:var(--mf-ink)]">{item.notes}</p> : null}
                            {item.nextAction ? (
                                <p className="mt-2 text-xs font-semibold text-[color:var(--mf-primary)]">Prossimo passo: {item.nextAction}</p>
                            ) : null}
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}

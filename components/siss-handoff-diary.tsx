'use client';

import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { CheckCircle2, LoaderCircle, MoreHorizontal, Plus } from 'lucide-react';
import { db, captureSissHandoffWritePrecondition, resolveSissHandoffDraftPrecondition, type SissHandoffWritePrecondition, type SissHandoffEvent, type SissHandoffOutcome } from '@/lib/db';
import { useLiveQuery } from '@/lib/live-query';
import { Button } from '@/components/ui/button';
import { PatientSheetMenu } from '@/components/patient-sheet-menu';
import { CollapsibleSection } from '@/components/kree8/collapsible-section';
import { Disclosure } from '@/components/disclosure';
import { formatCountLabel } from '@/lib/format-count';
import { useRuntimeTwinPendingForm } from '@/components/runtime-twin-design';
import styles from './clinical-register.module.css';
import local from './siss-workspace.module.css';
import { useConfirm } from '@/components/ui/confirm-dialog';

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
    { action: 'prescription.create', label: 'Prescrittivo Regionale (PRREG)' },
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
    const confirm = useConfirm();
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState<FormState>(() => emptyForm());
    const closurePrecondition = useRef<SissHandoffWritePrecondition | null>(null);
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
        undefined,
        ['siss_handoff_events'],
    );

    const formId = useId();
    const createRef = useRef<HTMLButtonElement>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const closureDraftDirty = Boolean(closureNotes || closureNextAction || closureOutcome !== 'completed');
    useRuntimeTwinPendingForm(isFormOpen || closureDraftDirty);
    useEffect(() => { if (isFormOpen) formRef.current?.querySelector<HTMLSelectElement>('select')?.focus(); }, [isFormOpen]);

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

    const beginClosureDraft = () => {
        if (!pendingHandoff) return false;
        try {
            closurePrecondition.current = resolveSissHandoffDraftPrecondition(closurePrecondition.current, pendingHandoff);
            return true;
        } catch (draftError) {
            setError(draftError instanceof Error ? draftError.message : 'Ricarica il diario SISS.');
            return false;
        }
    };

    const closePendingHandoff = async () => {
        if (!pendingHandoff) return;
        setError(null);
        setIsSaving(true);
        try {
            const sissPrecondition = resolveSissHandoffDraftPrecondition(closurePrecondition.current, pendingHandoff);
            await db.sissHandoffs.update(sissPrecondition.id, {
                outcome: closureOutcome,
                completedAt: new Date(),
                nextAction: optionalValue(closureNextAction),
                notes: optionalValue(closureNotes),
                updatedAt: new Date(),
            }, { sissPrecondition });
            closurePrecondition.current = null;
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
        setError(null);
        try {
            const sissPrecondition = captureSissHandoffWritePrecondition(item);
            const { confirmed } = await confirm({
                title: `Eliminare la voce SISS "${item.moduleLabel}"?`,
                confirmLabel: 'Elimina',
                tone: 'danger'
            });
            if (!confirmed) return;
            await db.sissHandoffs.delete(sissPrecondition.id, { sissPrecondition });
        } catch {
            setError('Eliminazione non riuscita. La voce potrebbe essere cambiata: ricarica il diario prima di riprovare.');
        }
    };

    const createButton = <Button ref={createRef} variant="text" disabled={isSaving} aria-expanded={isFormOpen} aria-controls={isFormOpen ? formId : undefined}
        onClick={() => { setIsFormOpen(value => !value); }}><Plus size={16} aria-hidden />Registra passaggio</Button>;
    const content = (
        <section className={styles.register}>
            {!embedded ? <div className={styles.toolbar}><h2>Diario locale dei passaggi</h2>{createButton}</div> : null}
            <p className={local.caption}>Registro locale: l’atto regionale e il suo esito si verificano nel portale ufficiale.</p>
            {pendingHandoff ? (
                <div className={local.pending} aria-label="Chiusura del passaggio aperto">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:color-mix(in_srgb,var(--lume-signal-warning)_60%,var(--lume-ink))]">Da chiudere</p>
                            <h3 className="mt-1 text-sm font-semibold text-[color:var(--lume-ink)]">
                                {pendingHandoff.moduleLabel} aperto {formatDate(pendingHandoff.startedAt)}
                            </h3>
                            {pendingHandoff.reason ? (
                                <p className="mt-1 text-xs leading-5 text-[color:var(--lume-ink-muted)]">{pendingHandoff.reason}</p>
                            ) : null}
                        </div>
                        <select
                            className="input-field h-10 max-w-44" aria-label="Esito del passaggio aperto"
                            value={closureOutcome}
                            onChange={(event) => { if (beginClosureDraft()) setClosureOutcome(event.target.value as SissHandoffOutcome); }}
                        >
                            {OUTCOME_OPTIONS.filter((item) => item.value !== 'started').map((item) => (
                                <option key={item.value} value={item.value}>{item.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Cosa va ricordato
                            <textarea className="input-field min-h-20" value={closureNotes} onChange={(event) => { if (beginClosureDraft()) setClosureNotes(event.target.value); }} />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Prossima azione
                            <textarea className="input-field min-h-20" value={closureNextAction} onChange={(event) => { if (beginClosureDraft()) setClosureNextAction(event.target.value); }} />
                        </label>
                    </div>
                    <Button variant={isFormOpen ? 'secondary' : closureDraftDirty ? 'primary' : 'text'}
                        disabled={isSaving} onClick={() => void closePendingHandoff()} className="mt-3">
                        {isSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        Chiudi passaggio
                    </Button>
                </div>
            ) : null}

            {isFormOpen && (
                <form id={formId} ref={formRef} onSubmit={handleSubmit} aria-label="Registra passaggio locale" className={styles.form}>
                    <div className="grid gap-3 md:grid-cols-2">
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Modulo
                            <select className="input-field" value={form.action} onChange={(event) => handleModuleChange(event.target.value)}>
                                {MODULE_OPTIONS.map((item) => <option key={item.action} value={item.action}>{item.label}</option>)}
                            </select>
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Esito
                            <select className="input-field" value={form.outcome} onChange={(event) => updateForm('outcome', event.target.value as SissHandoffOutcome)}>
                                {OUTCOME_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                            </select>
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)] md:col-span-2">
                            Perché ho aperto il portale
                            <input className="input-field" value={form.reason} onChange={(event) => updateForm('reason', event.target.value)} placeholder="Verifica anagrafica, prescrizione, consultazione FSE..." />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Cosa va ricordato
                            <textarea className="input-field min-h-24" value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Prossima azione
                            <textarea className="input-field min-h-24" value={form.nextAction} onChange={(event) => updateForm('nextAction', event.target.value)} />
                        </label>
                    </div>
                    {error ? <p className="mt-3 text-xs font-semibold text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]">{error}</p> : null}
                    <div className="mt-4 flex flex-wrap justify-end gap-3">
                        <Button variant="secondary" disabled={isSaving} onClick={() => { setIsFormOpen(false); createRef.current?.focus(); }}>Annulla</Button>
                        <Button type="submit" disabled={isSaving}>
                            {isSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                            Salva voce
                        </Button>
                    </div>
                </form>
            )}

            {error && !isFormOpen ? <p className="mb-3 text-xs font-semibold text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]">{error}</p> : null}

            {!handoffs ? <p className={styles.empty} role="status">Caricamento del diario locale…</p> : handoffs.length === 0 ? (
                <p className={styles.empty}>Nessun passaggio SISS registrato per questo paziente.</p>
            ) : (
                <table className={`${styles.table} ${styles.therapyTable}`}>
                    <thead><tr><th>Passaggio</th><th>Esito dichiarato</th><th>Azioni</th></tr></thead>
                    <tbody>{handoffs.slice(0, 6).map(item => <tr key={item.id} data-siss-handoff-id={item.id}>
                        <td><strong>{item.moduleLabel}</strong><small className="lume-registro">{formatDate(item.startedAt)}</small>
                            <Disclosure title="Dettagli del passaggio">
                                {item.reason ? <p className="mt-2">{item.reason}</p> : null}
                                {item.notes ? <p className="mt-2">{item.notes}</p> : null}
                                {item.nextAction ? <p className="mt-2">Prossimo passo: {item.nextAction}</p> : null}
                                {!item.reason && !item.notes && !item.nextAction ? <p className={local.caption}>Nessun dettaglio registrato.</p> : null}
                            </Disclosure>
                        </td>
                        <td>{outcomeLabel(item.outcome)}</td>
                        <td><PatientSheetMenu label={`Azioni passaggio ${item.moduleLabel}`}
                            trigger={props => <Button {...props} variant="icon" aria-label={`Azioni passaggio ${item.moduleLabel}`}><MoreHorizontal size={16} aria-hidden /></Button>}>
                            <button type="button" role="menuitem" onClick={() => void deleteItem(item)}>Elimina passaggio SISS</button>
                        </PatientSheetMenu></td>
                    </tr>)}</tbody>
                </table>
            )}
        </section>
    );
    return embedded ? <CollapsibleSection title="Diario locale dei passaggi"
        count={handoffs ? formatCountLabel(handoffs.length, 'passaggio', 'passaggi') : undefined}
        headerAction={createButton} defaultOpen={isFormOpen} keepMounted surfaceClassName={styles.therapySection}>
        {content}
    </CollapsibleSection> : content;
}

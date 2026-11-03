'use client';

// ADR 0176: conservazione dei fascicoli. Profilo dal pacchetto territoriale,
// finestre del titolare, elenco da rivedere, blocchi e scarto confermato.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import styles from '@/components/settings/maintenance-pages.module.css';
import panel from '@/components/settings/retention-panel.module.css';
import { SETTINGS_INPUT_CLASS, SETTINGS_PRIMARY_BUTTON_CLASS, SETTINGS_SECONDARY_BUTTON_CLASS } from '@/components/settings/settings-ui';
import { ViewState } from '@/components/ui/view-state';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast-provider';
import { db, type Attachment, type Patient } from '@/lib/db';
import { clientArchiveGeneration } from '@/lib/security/client-auth-api';
import {
    RETENTION_CATEGORIES, RETENTION_CATEGORY_LABELS, RETENTION_HOLD_REASONS, RETENTION_MAX_YEARS, RETENTION_PROFILES,
    RETENTION_SOURCES, effectiveRetentionTerm, type RetentionCategory, type RetentionHoldReason, type RetentionSourceId,
    type RetentionWindow, type RetentionWindows, type EffectiveTerm, type FascicoloEvaluation, type ProfileTerm,
} from '@/lib/retention-policy';
import type { RetentionOverview } from '@/lib/retention-store';

const ENDPOINT = '/api/system/retention';
const HOLD_REASON_LABELS: Record<RetentionHoldReason, string> = {
    litigation: 'Contenzioso',
    access_request: 'Richiesta dell’interessato o di accesso',
    inspection: 'Ispezione o richiesta di un’autorità',
    other: 'Altro motivo documentato',
};
const ERROR_COPY: Record<string, string> = {
    below_minimum: 'La finestra è più breve del minimo del profilo attivo.',
    conflict: 'I dati sono cambiati nel frattempo. Ricarica e riprova.',
    legal_hold: 'Il fascicolo è sospeso da un blocco.',
    not_expired: 'Il fascicolo non risulta più scaduto.',
    expiry_changed: 'La scadenza è cambiata. Ricarica e verifica di nuovo.',
    not_found: 'Paziente o documento non trovato.',
    configuration_error: 'Lo stato della conservazione non è leggibile.',
};
const dateFormat = new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const formatDate = (seconds: number | null) => seconds === null ? 'non disponibile' : dateFormat.format(new Date(seconds * 1000));

function termCopy(term: ProfileTerm['term'] | EffectiveTerm): string {
    if (term.kind === 'years') return `${term.years} anni`;
    if (term.kind === 'unlimited') return 'Illimitata';
    return 'Da fissare';
}
function sourceLabel(id: RetentionSourceId | null): string {
    return id ? RETENTION_SOURCES[id].label : 'Nessuna fonte di profilo';
}
const BASIS_COPY: Record<ProfileTerm['basis'], string> = {
    source: 'Termine indicato dalla fonte.',
    prudence: 'Estensione prudente: il dato potrebbe rientrare in una classe a conservazione illimitata.',
    owner: 'Nessun termine verificato: lo fissa il titolare.',
};

async function send(method: 'PUT' | 'POST', body: Record<string, unknown>): Promise<{ ok: true; value: unknown } | { ok: false; code: string }> {
    try {
        const response = await fetch(ENDPOINT, { method, credentials: 'same-origin', cache: 'no-store',
            headers: { 'Content-Type': 'application/json', 'x-mediflow-archive-generation': clientArchiveGeneration() },
            body: JSON.stringify({ ...body, confirmed: true }) });
        const value = await response.json().catch(() => null) as { code?: string } | null;
        return response.ok ? { ok: true, value } : { ok: false, code: value?.code ?? 'internal_error' };
    } catch { return { ok: false, code: 'internal_error' }; }
}

type Draft = Partial<Record<RetentionCategory, string>>;
function draftFromWindows(windows: RetentionWindows): Draft {
    return Object.fromEntries(Object.entries(windows).map(([category, window]) =>
        [category, window.kind === 'unlimited' ? 'unlimited' : String(window.years)]));
}
function windowsFromDraft(draft: Draft): RetentionWindows | null {
    const windows: RetentionWindows = {};
    for (const [category, raw] of Object.entries(draft) as [RetentionCategory, string][]) {
        const value = raw.trim();
        if (!value) continue;
        if (value === 'unlimited') { windows[category] = { kind: 'unlimited' }; continue; }
        const years = Number(value);
        if (!Number.isInteger(years) || years < 1 || years > RETENTION_MAX_YEARS) return null;
        windows[category] = { kind: 'years', years } satisfies RetentionWindow;
    }
    return windows;
}

export function RetentionPanel() {
    const [overview, setOverview] = useState<RetentionOverview | null>(null);
    const [loadFailed, setLoadFailed] = useState(false);
    const [patients, setPatients] = useState<Map<string, Patient>>(new Map());
    const [draft, setDraft] = useState<Draft>({});
    const [busy, setBusy] = useState(false);
    const [holdPatientId, setHoldPatientId] = useState('');
    const [holdDocuments, setHoldDocuments] = useState<Attachment[]>([]);
    const [holdDocumentId, setHoldDocumentId] = useState('');
    const [holdReason, setHoldReason] = useState<RetentionHoldReason>('litigation');
    const confirm = useConfirm();
    const { showToast } = useToast();

    const load = useCallback(async () => {
        setLoadFailed(false);
        try {
            const response = await fetch(ENDPOINT, { credentials: 'same-origin', cache: 'no-store' });
            if (!response.ok) throw new Error('retention unavailable');
            const value = await response.json() as RetentionOverview;
            setOverview(value);
            if (value.status === 'ready') setDraft(draftFromWindows(value.windows));
        } catch { setLoadFailed(true); }
        try {
            const rows = await db.patients.toArray();
            setPatients(new Map(rows.map(row => [row.id, row])));
        } catch { setPatients(new Map()); }
    }, []);
    useEffect(() => { void load(); }, [load]);

    useEffect(() => {
        setHoldDocumentId('');
        if (!holdPatientId) { setHoldDocuments([]); return; }
        let cancelled = false;
        db.attachments.query({ patientId: holdPatientId, metadataOnly: true }).toArray()
            .then(rows => { if (!cancelled) setHoldDocuments(rows); })
            .catch(() => { if (!cancelled) setHoldDocuments([]); });
        return () => { cancelled = true; };
    }, [holdPatientId]);

    const patientName = useCallback((id: string) => {
        const patient = patients.get(id);
        return patient ? `${patient.lastName} ${patient.firstName}`.trim() : 'Scheda non leggibile in questa sessione';
    }, [patients]);
    const sortedPatients = useMemo(() => [...patients.values()]
        .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'it')), [patients]);

    const fail = (code: string) => showToast({ tone: 'error', title: ERROR_COPY[code] ?? 'Operazione non riuscita.' });

    if (loadFailed) return <ViewState state="error" title="Conservazione non disponibile." action={{ label: 'Riprova', onClick: () => void load() }} />;
    if (!overview) return <ViewState state="loading" title="Caricamento della conservazione" />;
    if (overview.status !== 'ready') return <ViewState state="error" title="Lo stato della conservazione non è leggibile: nessun fascicolo viene proposto per lo scarto." />;

    const profile = RETENTION_PROFILES[overview.profileId];
    const usedSources = [...new Set(RETENTION_CATEGORIES.map(category => profile.terms[category].sourceId).filter((id): id is RetentionSourceId => id !== null))];
    const parsedDraft = windowsFromDraft(draft);

    const saveWindows = async () => {
        if (!parsedDraft || busy) return;
        const { confirmed } = await confirm({ title: 'Salvare le finestre di conservazione?',
            message: 'Le finestre si applicano a tutti i fascicoli chiusi. Possono solo allungare il minimo del profilo.', confirmLabel: 'Salva finestre' });
        if (!confirmed) return;
        setBusy(true);
        const result = await send('PUT', { expectedRevision: overview.windowsRevision, windows: parsedDraft });
        setBusy(false);
        if (!result.ok) return fail(result.code);
        showToast({ tone: 'success', title: 'Finestre salvate' });
        await load();
    };

    const placeHold = async (patientId: string, attachmentId: string | null) => {
        if (busy || !patientId) return;
        setBusy(true);
        const result = await send('POST', { action: 'hold.place', expectedRevision: overview.holdsRevision, patientId, attachmentId, reason: holdReason });
        setBusy(false);
        if (!result.ok) return fail(result.code);
        showToast({ tone: 'success', title: 'Blocco registrato' });
        setHoldPatientId('');
        await load();
    };

    const releaseHold = async (holdId: string) => {
        if (busy) return;
        const { confirmed } = await confirm({ title: 'Revocare il blocco?',
            message: 'Senza blocco, il fascicolo torna nell’elenco da rivedere se la conservazione è scaduta.', confirmLabel: 'Revoca blocco' });
        if (!confirmed) return;
        setBusy(true);
        const result = await send('POST', { action: 'hold.release', expectedRevision: overview.holdsRevision, holdId });
        setBusy(false);
        if (!result.ok) return fail(result.code);
        showToast({ tone: 'success', title: 'Blocco revocato' });
        await load();
    };

    const discard = async (item: FascicoloEvaluation) => {
        if (busy || !item.governing || item.expiresAt === null) return;
        const { confirmed } = await confirm({
            title: `Scartare il fascicolo di ${patientName(item.patientId)}?`,
            message: `Termine applicato: ${termCopy(item.governing.term)} dalla chiusura, ${RETENTION_CATEGORY_LABELS[item.governing.category].toLowerCase()}. `
                + `Fonte: ${sourceLabel(item.governing.sourceId)}. Scheda, voci, terapie, prescrizioni e documenti vengono eliminati dall’archivio e non sono recuperabili da MediFlow. `
                + 'I backup già prodotti non vengono modificati.',
            confirmLabel: 'Scarta definitivamente', tone: 'danger',
        });
        if (!confirmed) return;
        setBusy(true);
        const result = await send('POST', { action: 'discard', patientId: item.patientId, expectedVersion: item.version, expectedExpiresAt: item.expiresAt });
        setBusy(false);
        if (!result.ok) return fail(result.code);
        showToast({ tone: 'success', title: 'Fascicolo scartato', description: 'Lo scarto è registrato nell’audit.' });
        await load();
    };

    return (
        <section className={styles.page} data-testid="settings-retention-section">
            <header className={styles.intro}>
                <h2>Conservazione</h2>
                <p>Termini di conservazione dei fascicoli chiusi, con la fonte di ciascun termine. Le durate vanno validate dal titolare del trattamento: MediFlow non attesta la conformità legale e non cancella nulla senza conferma.</p>
            </header>

            <section className={styles.section} aria-labelledby="retention-profile" data-testid="retention-profile">
                <h3 id="retention-profile" className={styles.heading}>Profilo attivo</h3>
                <p><strong>{profile.label}</strong></p>
                <p className={styles.meta}>Segue l’assetto territoriale dell’installazione.{overview.profileId === 'none' ? ' Senza profilo, nessun fascicolo scade finché il titolare non fissa le finestre.' : ''}</p>
                {usedSources.length > 0 ? <ul className={panel.sources}>
                    {usedSources.map(id => <li key={id}><a href={RETENTION_SOURCES[id].href} target="_blank" rel="noopener noreferrer">{RETENTION_SOURCES[id].label}</a></li>)}
                </ul> : null}
            </section>

            <section className={styles.section} aria-labelledby="retention-terms">
                <h3 id="retention-terms" className={styles.heading}>Termini per categoria</h3>
                <p className={styles.meta}>Ogni termine decorre dalla chiusura del fascicolo. MediFlow non registra la data di archiviazione: usa l’ultima data nota del fascicolo, che non anticipa mai la scadenza.</p>
                <div className={panel.terms} role="list">
                    {RETENTION_CATEGORIES.map(category => {
                        const minimum = profile.terms[category];
                        const raw = draft[category] ?? '';
                        const window = windowsFromDraft({ [category]: raw })?.[category];
                        const effective = effectiveRetentionTerm(overview.profileId, category, window);
                        const locked = minimum.term.kind === 'unlimited';
                        return <div key={category} role="listitem" className={panel.termRow} data-testid={`retention-term-${category}`}>
                            <div className={panel.termIdentity}>
                                <strong>{RETENTION_CATEGORY_LABELS[category]}</strong>
                                <span className={styles.meta}>Minimo: {termCopy(minimum.term)}. {BASIS_COPY[minimum.basis]} {minimum.sourceId ? sourceLabel(minimum.sourceId) : ''}</span>
                            </div>
                            <label className={panel.termField}>
                                <span className={styles.meta}>Finestra del titolare, anni</span>
                                {locked ? <span>Non modificabile</span> : <span className={panel.termInputs}>
                                    <input type="number" min={minimum.term.kind === 'years' ? minimum.term.years : 1} max={RETENTION_MAX_YEARS} step={1}
                                        inputMode="numeric" className={SETTINGS_INPUT_CLASS} value={raw === 'unlimited' ? '' : raw} disabled={raw === 'unlimited' || busy}
                                        onChange={event => setDraft(current => ({ ...current, [category]: event.target.value }))}
                                        aria-label={`Finestra in anni per ${RETENTION_CATEGORY_LABELS[category]}`} />
                                    <label className={panel.check}>
                                        <input type="checkbox" checked={raw === 'unlimited'} disabled={busy}
                                            onChange={event => setDraft(current => ({ ...current, [category]: event.target.checked ? 'unlimited' : '' }))} />
                                        Illimitata
                                    </label>
                                </span>}
                            </label>
                            <span className={panel.termApplied}>Applicato: {termCopy(effective)}</span>
                        </div>;
                    })}
                </div>
                {!parsedDraft ? <p className={styles.meta} role="alert">Indica un numero intero di anni fra 1 e {RETENTION_MAX_YEARS}.</p> : null}
                <div className={styles.actions}>
                    <button type="button" className={SETTINGS_PRIMARY_BUTTON_CLASS} disabled={!parsedDraft || busy} onClick={() => void saveWindows()} data-testid="retention-save-windows">Salva finestre</button>
                </div>
            </section>

            <section className={styles.section} aria-labelledby="retention-review" data-testid="retention-review">
                <h3 id="retention-review" className={styles.heading}>Da rivedere</h3>
                <p className={styles.meta}>
                    Fascicoli chiusi: {overview.counts.in_retention} in conservazione, {overview.counts.expired} con conservazione scaduta,
                    {' '}{overview.counts.held} sospesi da un blocco, {overview.counts.unlimited} a conservazione illimitata, {overview.counts.unset} senza finestra.
                    Valutazione del {formatDate(overview.evaluatedAt)}.
                </p>
                {overview.review.length === 0 ? <ViewState state="empty" title="Nessun fascicolo con conservazione scaduta." /> : <ul className={panel.review}>
                    {overview.review.map(item => <li key={item.patientId} className={styles.siteRow} data-testid="retention-review-item" data-status={item.status}>
                        <div className={styles.siteIdentity}>
                            <h3><Link href={`/patients/${encodeURIComponent(item.patientId)}`}>{patientName(item.patientId)}</Link></h3>
                            <p>{item.status === 'held' ? 'Sospeso da un blocco' : 'Conservazione scaduta'} · chiusura stimata {formatDate(item.closureEstimate)} · scadenza {formatDate(item.expiresAt)}</p>
                            {item.governing ? <p>Termine applicato: {termCopy(item.governing.term)}, {RETENTION_CATEGORY_LABELS[item.governing.category].toLowerCase()}. Fonte: {sourceLabel(item.governing.sourceId)}</p> : null}
                        </div>
                        <div className={styles.siteActions}>
                            {item.status === 'expired' ? <>
                                <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy} onClick={() => void placeHold(item.patientId, null)}>Blocca</button>
                                <button type="button" className="mf-button-destructive" disabled={busy} onClick={() => void discard(item)} data-testid="retention-discard">Scarta</button>
                            </> : null}
                        </div>
                    </li>)}
                </ul>}
            </section>

            <section className={styles.section} aria-labelledby="retention-holds" data-testid="retention-holds">
                <h3 id="retention-holds" className={styles.heading}>Blocchi per contenzioso o richiesta</h3>
                <p className={styles.meta}>Un blocco sospende lo scarto e la cancellazione definitiva del paziente finché non viene revocato.</p>
                {overview.holds.length === 0 ? <ViewState state="empty" title="Nessun blocco attivo." /> : <ul className={panel.review}>
                    {overview.holds.map(hold => <li key={hold.id} className={styles.siteRow}>
                        <div className={styles.siteIdentity}>
                            <h3>{patientName(hold.patientId)}</h3>
                            <p>{HOLD_REASON_LABELS[hold.reason]} · {hold.scope === 'document' ? 'documento' : 'intero fascicolo'} · dal {formatDate(hold.placedAt)}</p>
                        </div>
                        <div className={styles.siteActions}>
                            <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy} onClick={() => void releaseHold(hold.id)}>Revoca</button>
                        </div>
                    </li>)}
                </ul>}
                <div className={styles.fields}>
                    <label><span>Paziente</span>
                        <select className={SETTINGS_INPUT_CLASS} value={holdPatientId} onChange={event => setHoldPatientId(event.target.value)} disabled={busy} data-testid="retention-hold-patient">
                            <option value="">Scegli il paziente</option>
                            {sortedPatients.map(patient => <option key={patient.id} value={patient.id}>{patient.lastName} {patient.firstName}</option>)}
                        </select>
                    </label>
                    <label><span>Documento</span>
                        <select className={SETTINGS_INPUT_CLASS} value={holdDocumentId} onChange={event => setHoldDocumentId(event.target.value)} disabled={busy || !holdPatientId}>
                            <option value="">Intero fascicolo</option>
                            {holdDocuments.map(document => <option key={document.id} value={document.id}>{document.name}</option>)}
                        </select>
                    </label>
                    <label><span>Motivo</span>
                        <select className={SETTINGS_INPUT_CLASS} value={holdReason} onChange={event => setHoldReason(event.target.value as RetentionHoldReason)} disabled={busy}>
                            {RETENTION_HOLD_REASONS.map(reason => <option key={reason} value={reason}>{HOLD_REASON_LABELS[reason]}</option>)}
                        </select>
                    </label>
                </div>
                <div className={styles.actions}>
                    <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy || !holdPatientId}
                        onClick={() => void placeHold(holdPatientId, holdDocumentId || null)} data-testid="retention-place-hold">Registra blocco</button>
                </div>
            </section>

            <section className={styles.section} aria-labelledby="retention-limits">
                <h3 id="retention-limits" className={styles.heading}>Limiti noti</h3>
                <ul className={panel.sources}>
                    <li>Lo scarto non riscrive i backup già prodotti né le esportazioni consegnate: un ripristino da un backup precedente riporta il fascicolo.</li>
                    <li>Il registro di audit resta integro e non è soggetto a scarto.</li>
                    <li>I documenti allegati non hanno ancora una classificazione per tipo: restano a conservazione illimitata nei profili italiani.</li>
                    <li>L’attività chirurgica, con termine di 30 anni nel massimario lombardo, non è distinta.</li>
                </ul>
            </section>
        </section>
    );
}

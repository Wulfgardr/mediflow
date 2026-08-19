'use client';

/* @Codex WUL-518: mock locale non autenticato della prima slice AIP.
   Mostra solo fixture sintetiche e un flusso read-only; non invoca route,
   database, modelli o capability cliniche reali. */

import { useEffect, useState } from 'react';
import {
    Activity,
    ArrowRight,
    Bot,
    Check,
    CirclePause,
    CirclePlay,
    Clock3,
    FileCheck2,
    Fingerprint,
    LockKeyhole,
    RotateCcw,
    ShieldCheck,
    UserRound,
} from 'lucide-react';

import styles from './page.module.css';

type StageId = 'context' | 'lease' | 'projection' | 'receipt';
type Stage = { id: StageId; kicker: string; label: string; detail: string; status: string };

const stages: Stage[] = [
    { id: 'context', kicker: '01 · fixture', label: 'Contesto', detail: 'La scena mostra un solo paziente sintetico e uno scopo esplicito.', status: 'contesto sintetico selezionato' },
    { id: 'lease', kicker: '02 · contratto', label: 'Context lease', detail: 'Il contratto valuta un oggetto lease sintetico; nessun servizio lo emette.', status: 'lease sintetico valutato' },
    { id: 'projection', kicker: '03 · esempio', label: 'Projection', detail: 'La fixture rispecchia la projection deterministica pubblica, senza esecuzione.', status: 'projection di esempio visualizzata' },
    { id: 'receipt', kicker: '04 · forma', label: 'Receipt proposta', detail: 'La scena mostra una forma attesa di receipt; nessuna receipt viene emessa.', status: 'receipt-shaped fixture visualizzata' },
];

const loops = [
    ['results_pending', 'Glicemia · insert_results'],
];

const logItems = [
    ['08:41:12', 'context.fixture', 'nessuna selezione reale'],
    ['08:41:13', 'lease.example', 'scope di esempio'],
    ['08:41:14', 'projection.fixture', 'contratto sintetico'],
    ['08:41:15', 'receipt.shape', 'non emessa'],
];

function StageIcon({ id }: { id: StageId }) {
    if (id === 'context') return <UserRound aria-hidden="true" />;
    if (id === 'lease') return <LockKeyhole aria-hidden="true" />;
    if (id === 'projection') return <Activity aria-hidden="true" />;
    return <FileCheck2 aria-hidden="true" />;
}

function Kicker({ children }: { children: React.ReactNode }) {
    return <p className="text-[.66rem] font-extrabold uppercase tracking-[.16em] text-[color:var(--lume-ink-muted)]">{children}</p>;
}

export default function AgentInterfaceMockPage() {
    const [activeIndex, setActiveIndex] = useState(0);
    const [playing, setPlaying] = useState(false);
    const active = stages[activeIndex];
    const ready = activeIndex >= 2;

    useEffect(() => {
        const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
        const pauseForReducedMotion = () => {
            if (motionPreference.matches) setPlaying(false);
        };
        if (motionPreference.matches) pauseForReducedMotion();
        else setPlaying(true);
        motionPreference.addEventListener('change', pauseForReducedMotion);
        return () => motionPreference.removeEventListener('change', pauseForReducedMotion);
    }, []);

    useEffect(() => {
        if (!playing) return undefined;
        const timer = window.setInterval(() => setActiveIndex((current) => (current + 1) % stages.length), 1600);
        return () => window.clearInterval(timer);
    }, [playing]);

    return (
        <main className={`${styles.page} min-h-screen p-6 text-[color:var(--lume-ink)]`}>
            <div className="mx-auto max-w-[1480px]">
                <header className="flex items-center justify-between gap-5 pb-6">
                    <div className="flex items-center gap-3">
                        <span className="grid size-10 place-items-center rounded-xl bg-[color:var(--lume-accent)] text-xs font-extrabold text-[color:var(--lume-surface-focal)]">MF</span>
                        <div><p className="text-sm font-extrabold uppercase tracking-[.08em]">MediFlow</p><p className="text-xs text-[color:var(--lume-ink-muted)]">Agent Interface Plane · mock · ADR Proposed</p></div>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                        <span className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[color:var(--lume-border-color)] px-3">mock · nessuna esecuzione</span>
                        <button type="button" aria-pressed={!playing} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[color:var(--lume-border-color)] px-3 transition-[background-color,color,transform] duration-150 hover:bg-[color:var(--lume-surface-focal)] hover:text-[color:var(--lume-ink)] active:scale-[.97]" onClick={() => setPlaying((value) => !value)}>
                            {playing ? <CirclePause aria-hidden="true" className="size-4" /> : <CirclePlay aria-hidden="true" className="size-4" />}{playing ? 'Pausa' : 'Riprendi'}
                        </button>
                        <button type="button" aria-label="Riavvia la simulazione" className="grid size-9 place-items-center rounded-full border border-[color:var(--lume-border-color)] transition-[background-color,transform] duration-150 hover:bg-[color:var(--lume-surface-focal)] active:scale-[.97]" onClick={() => { setActiveIndex(0); setPlaying(!window.matchMedia('(prefers-reduced-motion: reduce)').matches); }}><RotateCcw aria-hidden="true" className="size-4" /></button>
                    </div>
                </header>

                <section className="flex flex-col items-start justify-between gap-5 pb-8 pt-6 lg:flex-row lg:items-end">
                    <div><Kicker>Visualizzazione contrattuale</Kicker><h1 className="mt-2 max-w-3xl text-4xl font-medium leading-[.98] tracking-[-.055em] sm:text-6xl">Un agente vede il contesto giusto, non tutto MediFlow.</h1><p className="mt-5 max-w-2xl text-sm leading-6 text-[color:var(--lume-ink-muted)]">La scena illustra un contratto proposto da contesto sintetico a projection read-only. Non dimostra un runtime: nessun dato reale, nessuna route invocata, nessun lease o receipt emessi, nessun <code className="rounded bg-[color:var(--lume-surface-field)] px-1 py-0.5 font-mono text-xs">apply</code>.</p></div>
                    <div className="flex max-w-[230px] items-start gap-2.5 rounded-[14px] border border-[color:var(--lume-border-color)] bg-[color:var(--lume-surface-field)] p-3 text-xs"><Bot aria-hidden="true" className="mt-0.5 size-5 text-[color:var(--lume-accent)]" /><span><strong className="block">Sequenza simulata</strong><small className="mt-1 block text-[color:var(--lume-ink-muted)]">4 stati proposti · pausa disponibile</small></span></div>
                </section>

                <div className="grid gap-3 lg:grid-cols-[minmax(215px,.78fr)_minmax(420px,1.55fr)_minmax(245px,.88fr)]">
                    <aside className={`${styles.panel} flex flex-col p-5`}>
                        <div className="mb-6 flex items-start justify-between"><div><Kicker>Fixture di contesto</Kicker><h2 className="mt-1 text-base font-medium">Mandato di esempio</h2></div><ShieldCheck aria-hidden="true" className="size-5 text-[color:var(--lume-accent)]" /></div>
                        <div className="flex items-start gap-2.5 rounded-[14px] border border-[color:var(--lume-border-color)] bg-[color:var(--lume-surface-focal)] p-3"><span className="grid size-9 place-items-center rounded-[11px] bg-[color:var(--lume-ink)] text-[.68rem] font-extrabold text-[color:var(--lume-surface-focal)]">GR</span><div><p className="text-[.68rem] text-[color:var(--lume-ink-muted)]">Paziente selezionato</p><p className="mt-0.5 text-sm font-bold">Giorgia Rossi</p><p className="mt-1 font-mono text-[.61rem] text-[color:var(--lume-ink-muted)]">Fixture sintetica · ID PAT-042</p></div><span className="ml-auto grid size-5 place-items-center rounded-full bg-[color:var(--lume-signal-success)] text-[color:var(--lume-surface-focal)]"><Check aria-hidden="true" className="size-3" /></span></div>
                        <dl className="mt-4 text-xs"><div className="flex justify-between border-b border-[color:var(--lume-border-color)] py-2.5"><dt className="text-[color:var(--lume-ink-muted)]">Scopo</dt><dd className="font-mono text-[.65rem]">patient.open-loops</dd></div><div className="flex justify-between border-b border-[color:var(--lume-border-color)] py-2.5"><dt className="text-[color:var(--lume-ink-muted)]">Stadio</dt><dd className="font-mono text-[.65rem]">read · observe</dd></div><div className="flex justify-between border-b border-[color:var(--lume-border-color)] py-2.5"><dt className="text-[color:var(--lume-ink-muted)]">Autorità</dt><dd className="font-mono text-[.65rem]">nessuna scrittura</dd></div></dl>
                        <div className="mt-auto grid gap-3 pt-7"><Kicker>Confini dichiarati</Kicker><span className="flex items-center gap-2 text-[.69rem] text-[color:var(--lume-ink-muted)]"><LockKeyhole className="size-3.5 text-[color:var(--lume-accent)]" />Nessun accesso a SQLite</span><span className="flex items-center gap-2 text-[.69rem] text-[color:var(--lume-ink-muted)]"><Fingerprint className="size-3.5 text-[color:var(--lume-accent)]" />Oggetto lease per un paziente</span><span className="flex items-center gap-2 text-[.69rem] text-[color:var(--lume-ink-muted)]"><ShieldCheck className="size-3.5 text-[color:var(--lume-accent)]" />Profilo proposto: egress none</span></div>
                    </aside>

                    <section className={`${styles.panel} ${styles.flowPanel} order-first flex min-h-[560px] flex-col p-5 lg:order-none`}>
                        <div className="mb-6 flex items-start justify-between"><div><Kicker>Narrativa proposta</Kicker><h2 className="mt-1 text-base font-medium">Dal contesto alla forma di receipt</h2></div><span className="rounded-full border border-[color:var(--lume-border-color)] px-2 py-1 font-mono text-[.65rem] text-[color:var(--lume-ink-muted)]">{String(activeIndex + 1).padStart(2, '0')} / 04</span></div>
                        <p className="sr-only" aria-live={playing ? 'off' : 'polite'} aria-atomic="true">{active.status}. {ready ? 'La fixture projection è visibile.' : 'La fixture projection non è ancora visibile.'} {activeIndex === 3 ? 'La forma proposta di receipt è visibile; nessuna receipt è stata emessa.' : 'Nessuna receipt è stata emessa.'}</p>
                        <div className={styles.rail}><span className={styles.railTrack} /><span className={styles.railProgress} style={{ transform: `scaleX(${activeIndex / (stages.length - 1)})` }} /><div className="relative grid grid-cols-4 gap-1">
                            {stages.map((stage, index) => { const state = index < activeIndex ? 'complete' : index === activeIndex ? 'active' : 'upcoming'; return <button key={stage.id} type="button" className={`${styles.stage} ${styles[`stage_${state}`]}`} onClick={() => { setActiveIndex(index); setPlaying(false); }} aria-current={state === 'active' ? 'step' : undefined}><span className={styles.node}><StageIcon id={stage.id} /></span><span className="grid gap-1"><small className="font-mono text-[.59rem]">{stage.kicker}</small><strong className="text-[.75rem]">{stage.label}</strong></span></button>; })}
                        </div></div>
                        <div key={active.id} className={`${styles.detail} mt-9 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] border border-[color:var(--lume-border-color)] bg-[color:var(--lume-surface-field)] p-4`}><span className="grid size-9 place-items-center rounded-xl bg-[color:color-mix(in_srgb,var(--lume-accent)_12%,transparent)] text-[color:var(--lume-accent)]"><StageIcon id={active.id} /></span><div><Kicker>Stato simulato</Kicker><h3 className="mt-1 text-sm font-medium">{active.status}</h3><p className="mt-1 text-xs leading-5 text-[color:var(--lume-ink-muted)]">{active.detail}</p></div><ArrowRight aria-hidden="true" className="size-4 text-[color:var(--lume-ink-muted)]" /></div>
                        <div className="mt-auto pt-7"><div className="flex items-center justify-between"><Kicker>Sequenza eventi simulata</Kicker><span className="font-mono text-[.62rem] text-[color:var(--lume-ink-muted)]">non eseguita</span></div><div className="mt-2 grid gap-0 border-t border-[color:var(--lume-border-color)] pt-1">{logItems.map(([time, label, meta], index) => <div key={label} className={`${styles.log} ${index <= activeIndex ? styles.logVisible : ''}`}><span>{time}</span><strong>{label}</strong><small>{meta}</small></div>)}</div></div>
                    </section>

                    <aside className={`${styles.panel} flex flex-col p-5`}>
                        <div className="mb-6 flex items-start justify-between"><div><Kicker>Fixture tipizzata</Kicker><h2 className="mt-1 text-base font-medium">Projection paziente</h2></div><span className={`${styles.status} ${ready ? styles.statusReady : ''}`}>{ready ? 'esempio visibile' : 'non mostrata'}</span></div>
                        <div className={`${styles.output} ${ready ? styles.outputReady : ''}`}>{!ready ? <div className="max-w-[180px] text-center"><span className="mx-auto mb-3 grid size-10 place-items-center rounded-xl bg-[color:var(--lume-surface-field)] text-[color:var(--lume-ink-muted)]"><Activity aria-hidden="true" className="size-4" /></span><p className="text-xs font-bold">La fixture non è ancora visualizzata.</p><small className="mt-2 block text-[.68rem] leading-5 text-[color:var(--lume-ink-muted)]">La sequenza non valida né emette un lease.</small></div> : <div className="min-w-0 w-full px-3.5"><div className="flex min-w-0 items-start gap-2.5 border-b border-[color:var(--lume-border-color)] pb-3"><span className="grid size-7 shrink-0 place-items-center rounded-xl bg-[color:var(--lume-signal-success)] text-[color:var(--lume-surface-focal)]"><Check aria-hidden="true" className="size-4" /></span><div className="min-w-0"><strong className="block text-xs">1 open loop di esempio</strong><small className="font-mono text-[.59rem] text-[color:var(--lume-ink-muted)]">patient_open_loops · deterministic · source v7</small></div></div><div className="mt-2">{loops.map(([label, value]) => <div key={label} className="grid gap-1 border-b border-[color:var(--lume-border-color)] py-2 last:border-0"><span className="font-mono text-[.65rem] text-[color:var(--lume-ink-muted)]">{label}</span><strong className="break-words text-[.73rem] leading-5">{value}</strong></div>)}</div></div>}</div>
                        <div className={`${styles.receipt} ${activeIndex === 3 ? styles.receiptReady : ''} mt-3 flex items-start gap-2.5 rounded-[14px] border border-[color:var(--lume-border-color)] p-3`}><span className="grid size-7 place-items-center rounded-xl bg-[color:color-mix(in_srgb,var(--lume-accent)_10%,transparent)] text-[color:var(--lume-accent)]"><FileCheck2 aria-hidden="true" className="size-4" /></span><div><Kicker>Forma di receipt · proposta</Kicker><strong className="mt-1 block text-xs">{activeIndex === 3 ? 'Receipt-shaped fixture visibile' : 'Nessuna receipt emessa'}</strong><small className="mt-1 block font-mono text-[.58rem] text-[color:var(--lume-ink-muted)]">requestId di esempio · aip-demo-7f2</small></div></div>
                        <div className="mt-auto flex items-center gap-2 pt-6 text-[.65rem] text-[color:var(--lume-ink-muted)]"><LockKeyhole className="size-3.5 text-[color:var(--lume-signal-success)]" />read-only · nessun <code className="rounded bg-[color:var(--lume-surface-field)] px-1 font-mono text-[.6rem]">clinical_application</code></div>
                    </aside>
                </div>

                <footer className="flex flex-col gap-2 py-4 text-[.66rem] text-[color:var(--lume-ink-muted)] sm:flex-row sm:items-center sm:justify-between"><span>route statica non autorevole · fixture sintetiche</span><span className="flex items-center gap-2"><Clock3 aria-hidden="true" className="size-3.5" />durata ciclo simulato 6,4 s</span><span className="flex items-center gap-2"><ShieldCheck aria-hidden="true" className="size-3.5" />runtime unavailable · ADR Proposed</span></footer>
            </div>
        </main>
    );
}

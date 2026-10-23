type ViewStateProps = Readonly<{
    state: 'loading' | 'empty' | 'error' | 'unavailable';
    title: string;
    detail?: string;
    action?: Readonly<{ label: string; onClick: () => void }>;
}>;

export function ViewState({ state, title, detail, action }: ViewStateProps) {
    const failed = state === 'error' || state === 'unavailable';
    return <div className="min-w-0 py-4 type-body" role={failed ? 'alert' : 'status'} data-view-state={state}>
        <p className={`type-strong ${state === 'error' ? 'text-[color:var(--lume-signal-critical)]' : state === 'unavailable' ? 'text-[color:var(--lume-signal-warning)]' : 'text-ink'}`}>
            {failed ? <span aria-hidden="true">{state === 'error' ? '◆ ' : '▲ '}</span> : null}{title}
        </p>
        {detail ? <p className="mt-2 type-meta text-muted">{detail}</p> : null}
        {action ? <button type="button" className="mf-button-text mt-2" onClick={action.onClick}>{action.label}</button> : null}
    </div>;
}

type ViewStateProps = Readonly<{
    state: 'loading' | 'empty' | 'error' | 'unavailable';
    title: string;
    detail?: string;
    action?: Readonly<{ label: string; onClick: () => void }>;
}>;

export function ViewState({ state, title, detail, action }: ViewStateProps) {
    const failed = state === 'error' || state === 'unavailable';
    const titleClassName = state === 'empty' ? 'type-body text-[color:var(--lume-ink-muted)]'
        : `type-strong ${state === 'error' ? 'text-[color:var(--lume-signal-critical)]' : state === 'unavailable' ? 'text-[color:var(--lume-signal-warning)]' : 'text-ink'}`;
    return <div className="min-w-0 py-4 type-body" role={failed ? 'alert' : 'status'} data-view-state={state}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className={`${titleClassName} min-w-0`}>
                {failed ? <span aria-hidden="true">{state === 'error' ? '◆ ' : '▲ '}</span> : null}{title}
            </p>
            {action ? <button type="button" className="mf-button-text" onClick={action.onClick}>{action.label}</button> : null}
        </div>
        {detail ? <p className="mt-2 type-meta text-muted">{detail}</p> : null}
    </div>;
}

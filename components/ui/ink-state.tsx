import type { ReactNode } from 'react';

/** Presentation only: the caller supplies the actual proposal/draft/saved state. */
export function InkState({ state, children, className = '' }: {
  state: 'pencil' | 'fresh' | 'dry';
  children: ReactNode;
  className?: string;
}) {
  return <span className={`lume-ink-state ${className}`} data-ink={state}>
    <span className="lume-point" aria-hidden="true" />
    <span className="lume-ink-copy">{children}</span>
  </span>;
}

export function InkSectionHeading({ children, count }: { children: ReactNode; count?: ReactNode }) {
  return <h2 className="lume-section-heading">{children}{count !== undefined ? <span>{count}</span> : null}</h2>;
}

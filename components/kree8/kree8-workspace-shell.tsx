'use client';

/* @Codex */

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ChevronRight, FolderOpen, type LucideIcon } from 'lucide-react';

// WUL-297: Privacy Mode is always reachable from the workspace header.
import PrivacyBlur from '@/components/privacy-blur';
import { PrivacyModeToggle } from '@/components/privacy-mode-toggle';
import styles from './kree8-workspace-shell.module.css';

export type Kree8WorkspaceNavItem = {
  href: string;
  label: string;
  meta?: string;
};

/* @Codex WUL-560 L7A: the group vocabulary is closed here; callers may only
   bind existing sections in the separate mapping packet. */
export const KREE8_CLINICAL_RAIL_GROUPS = [
  { id: 'quadro-decisioni', label: 'Quadro e decisioni' },
  { id: 'terapie-prescrizioni', label: 'Terapie e prescrizioni' },
  { id: 'documenti-prove', label: 'Documenti e prove' },
  { id: 'diario-follow-up', label: 'Diario e follow-up' },
] as const;

type Kree8ClinicalRailDefinition = typeof KREE8_CLINICAL_RAIL_GROUPS;
export type Kree8WorkspaceNavGroups = readonly [
  Kree8ClinicalRailDefinition[0] & { items: readonly Kree8WorkspaceNavItem[] },
  Kree8ClinicalRailDefinition[1] & { items: readonly Kree8WorkspaceNavItem[] },
  Kree8ClinicalRailDefinition[2] & { items: readonly Kree8WorkspaceNavItem[] },
  Kree8ClinicalRailDefinition[3] & { items: readonly Kree8WorkspaceNavItem[] },
];

type Kree8WorkspaceShellProps = {
  variant?: 'default' | 'clinical';
  eyebrow: string;
  title: string;
  subtitle: string;
  backHref: string;
  backLabel: string;
  patientLabel?: string;
  patientAtoms?: string[];
  statusLabel?: string;
  navItems?: Kree8WorkspaceNavItem[];
  navGroups?: Kree8WorkspaceNavGroups;
  primaryAction?: { href: string; label: string; icon: LucideIcon };
  headerActions?: ReactNode;
  children: ReactNode;
};

export function Kree8WorkspaceShell({
  variant = 'default',
  eyebrow,
  title,
  subtitle,
  backHref,
  backLabel,
  patientLabel,
  patientAtoms = [],
  statusLabel,
  navItems = [],
  navGroups,
  primaryAction,
  headerActions,
  children,
}: Kree8WorkspaceShellProps) {
  const isClinical = variant === 'clinical';
  /* @Codex WUL-UIUX: scrollspy. Su una Scheda lunga la rail evidenzia la sezione
     in vista (aria-current) cosi non si perde l'orientamento. */
  const [activeHref, setActiveHref] = useState<string | null>(null);
  /* @Codex WUL-55 F2c: mirror durevole di activeHref; ogni generazione dell'effetto
     (una per navKey) rilegge currentHref da qui, cosi un cambio navKey azzera un
     aria-current stantio invece di ereditarlo. */
  const activeHrefRef = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const railId = useId();
  const [openGroups, setOpenGroups] = useState<Partial<Record<Kree8ClinicalRailDefinition[number]['id'], boolean>>>({
    'quadro-decisioni': true,
  });
  const renderedNavItems = navGroups ? navGroups.flatMap((group) => group.items) : navItems;
  const navKey = renderedNavItems.map((item) => item.href).join('|');
  const PrimaryActionIcon = primaryAction?.icon;

  /* Lume focal locus + scrollspy (WUL-55, F2c). Un solo effetto governa la vita
     dei bersagli: li scopre nel DOM dentro QUESTO guscio (querySelector sul ref,
     mai document-global, cosi due cockpit non si contendono lo stesso id), li
     ri-lega quando compaiono in ritardo (percorso Analytics: la rail monta con
     ANALYTICS_NAV_ITEMS prima che esistano #popolazione/#indicatori) o quando un
     nodo con lo stesso id viene sostituito, e sposta [data-lume-focus] sul nodo
     vivo azzerando ogni stato stantio. La rail tiene aria-current come feedback
     di navigazione, non una seconda superficie focale (01-lingua ss.1-3). */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const hashHrefs = (navKey ? navKey.split('|') : []).filter((href) => href.startsWith('#'));

    let targets: Array<{ href: string; el: HTMLElement }> = [];
    let observer: IntersectionObserver | null = null;
    let focusEl: HTMLElement | null = null;
    /* Seme dal mirror, non da null: la prima risoluzione a vuoto dopo un cambio
       navKey confronta l'href stantio e lo azzera. */
    let currentHref = activeHrefRef.current;
    /* Guardia di generazione: il cleanup la alza e i callback tardivi obsoleti
       non scrivono piu lo stato. */
    let cancelled = false;
    const visible = new Set<HTMLElement>();

    /* Unico punto che muta lo stato posseduto: sposta il filo focale sul nodo
       vivo (mai un nodo staccato) e allinea la rail. */
    const commit = (href: string | null, el: HTMLElement | null) => {
      if (cancelled) return;
      /* La Scheda possiede già una sola superficie focale che contiene tutte le
         sezioni. Lo scrollspy aggiorna soltanto la posizione nella rail e non
         solleva una seconda superficie interna. */
      const nextFocusEl = isClinical ? null : el;
      if (nextFocusEl !== focusEl) {
        if (focusEl) {
          focusEl.removeAttribute('data-lume-focus');
          focusEl.classList.remove('lume-focal');
        }
        focusEl = nextFocusEl;
        if (focusEl) {
          focusEl.setAttribute('data-lume-focus', '');
          focusEl.classList.add('lume-focal');
        }
      }
      if (href !== currentHref) {
        currentHref = href;
        activeHrefRef.current = href;
        setActiveHref(href);
      }
    };

    const resolve = () =>
      hashHrefs
        .map((href) => {
          const el = root.querySelector<HTMLElement>(`#${CSS.escape(href.slice(1))}`);
          return el ? { href, el } : null;
        })
        .filter((entry): entry is { href: string; el: HTMLElement } => entry !== null);

    const isInWorkspaceViewport = (el: HTMLElement) => {
      const chromeBottom = root.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
      const rect = el.getBoundingClientRect();
      return rect.bottom > chromeBottom && rect.top < window.innerHeight;
    };

    /* Sezione attiva = quella piu in alto tra le visibili, cosi l'evidenziazione
       segue l'ordine visivo anche con le due colonne (DOM e rail divergono). */
    const pickActive = () => {
      const observed = targets.filter((target) => visible.has(target.el) && isInWorkspaceViewport(target.el));
      /* @Codex The observer margin is intentionally narrower than the scrollable
         workspace. If a responsive rail moves every target outside that margin,
         or a scroll leaves a stale observer entry, use the same visible-document
         rule without introducing another viewport threshold. */
      const candidates = observed.length > 0
        ? observed
        : targets.filter((target) => isInWorkspaceViewport(target.el));
      if (candidates.length === 0) return;
      const topmost = candidates.reduce((best, target) =>
        target.el.getBoundingClientRect().top < best.el.getBoundingClientRect().top ? target : best,
      );
      commit(topmost.href, topmost.el);
    };

    const bind = () => {
      const next = resolve();
      const same =
        next.length === targets.length &&
        next.every((entry, i) => entry.el === targets[i].el && entry.href === targets[i].href);
      if (!same) {
        if (observer) observer.disconnect();
        visible.clear();
        targets = next;
        if (next.length === 0) {
          observer = null;
          commit(null, null);
          return;
        }
        observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const el = entry.target as HTMLElement;
              if (entry.isIntersecting) visible.add(el);
              else visible.delete(el);
            }
            pickActive();
          },
          { rootMargin: '-120px 0px -65% 0px', threshold: [0, 0.25, 0.6] },
        );
        next.forEach((entry) => observer!.observe(entry.el));
      }
      /* Ri-ancora fuoco e rail sul nodo vivo dell'href attivo (sostituzione con
         stesso id) o lascia cadere lo stato se la sezione e sparita. */
      if (currentHref) {
        const live = next.find((entry) => entry.href === currentHref);
        commit(live ? live.href : null, live ? live.el : null);
      } else if (next.length > 0 && visible.size === 0 && focusEl === null) {
        /* @Codex The first observer delivery is asynchronous. A responsive
           rail can move every section below its root margin, leaving the
           workspace without a focal locus until the user scrolls. Seed the
           first declared destination; a visible observer target still
           replaces it through pickActive(). */
        commit(next[0].href, next[0].el);
      }
    };

    bind();
    /* Scroll does not always cross the observer's reduced root margin. Capture
       the scroll phase so a section returned to the visible workspace can regain
       the focal locus without a timeout or layout-specific threshold. */
    const onScroll = () => pickActive();
    window.addEventListener('scroll', onScroll, true);
    /* DOM-aware, senza polling: il MutationObserver ri-lega quando i bersagli
       compaiono/spariscono/vengono sostituiti (solo childList, cosi setAttribute
       del filo non lo ritriggera). */
    const mo = new MutationObserver(() => bind());
    mo.observe(root, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      mo.disconnect();
      window.removeEventListener('scroll', onScroll, true);
      if (observer) observer.disconnect();
      if (focusEl) {
        focusEl.removeAttribute('data-lume-focus');
        focusEl.classList.remove('lume-focal');
      }
    };
  }, [isClinical, navKey]);

  return (
    <div className={`${styles.shell} ${isClinical ? styles.clinicalShell : ''}`} ref={rootRef}>
      <main className={`${styles.canvas} ${isClinical ? styles.clinicalCanvas : ''}`} data-testid={isClinical ? 'lume-scheda-scroll' : undefined}>
        <header
          className={`${styles.chrome} ${isClinical ? styles.clinicalChrome : ''}`}
          data-testid={isClinical ? 'lume-scheda-header' : undefined}
        >
          <div className={styles.chromeTopRow}>
            <Link href={backHref} className={styles.backButton} aria-label={backLabel} title={backLabel}>
              <ArrowLeft size={13} aria-hidden />
              <span className={styles.backButtonLabel}>{backLabel}</span>
            </Link>
            <div className={styles.headerActionCluster}>
              {/* WUL-297: persistent privacy affordance in the app header */}
              <PrivacyModeToggle showLabel />
              {primaryAction && PrimaryActionIcon ? (
                <Link href={primaryAction.href} className={styles.headerPrimaryAction}>
                  <PrimaryActionIcon size={14} aria-hidden="true" />
                  {primaryAction.label}
                </Link>
              ) : null}
              {headerActions}
            </div>
          </div>

          {isClinical ? (
            <div className={styles.clinicalIdentity}>
              <p className={styles.clinicalLabel}>{eyebrow}</p>
              <h1 className={styles.clinicalName}><PrivacyBlur>{title}</PrivacyBlur></h1>
              <p className={`${styles.clinicalAtoms} lume-registro`} data-testid="lume-scheda-atoms">
                {patientAtoms.map((atom, index) => (
                  <span key={`${atom}-${index}`} className={styles.clinicalAtomGroup}>
                    {index > 0 ? <span className={styles.clinicalDot} aria-hidden="true">·</span> : null}
                    <PrivacyBlur><span data-testid="lume-register-value">{atom}</span></PrivacyBlur>
                  </span>
                ))}
              </p>
            </div>
          ) : (
            <div className={styles.hero}>
              <span className={styles.brandMark} aria-hidden>
                <FolderOpen size={12} />
              </span>
              <div className={styles.heroText}>
                <p className={styles.eyebrow}>{eyebrow}</p>
                <h1 className={styles.title}>
                  <span className={styles.titleMain}>{title}</span>
                </h1>
                {patientLabel ? (
                  <p className={styles.patientLabel} data-testid="lume-workspace-patient-label">
                    <PrivacyBlur>{patientLabel}</PrivacyBlur>
                  </p>
                ) : null}
                <p className={styles.subtitle}>{subtitle}</p>
                {statusLabel ? <p className={styles.statusLine}>{statusLabel}</p> : null}
              </div>
            </div>
          )}
        </header>

        {renderedNavItems.length > 0 ? (
          <nav
            className={`${styles.sectionRail} ${navGroups ? styles.groupedSectionRail : ''}`}
            aria-label="Sezioni della vista"
            data-rail-mode={navGroups ? 'grouped' : 'unmapped'}
          >
            {navGroups ? navGroups.map((group) => {
              const activeItem = group.items.find((item) => item.href === activeHref);
              const expanded = openGroups[group.id] === true;
              const panelId = `${railId}-${group.id}`;
              return (
                <div className={styles.sectionGroup} key={group.id}>
                  <button
                    type="button"
                    className={styles.sectionGroupButton}
                    aria-controls={panelId}
                    aria-expanded={expanded}
                    onClick={() => setOpenGroups((current) => ({ ...current, [group.id]: !expanded }))}
                  >
                    <span>{group.label}</span>
                    <ChevronRight className={styles.sectionGroupChevron} size={14} aria-hidden="true" />
                  </button>
                  <ul id={panelId} className={styles.sectionGroupItems} hidden={!expanded}>
                    {group.items.map((item) => (
                      <li key={item.href}>
                        <a
                          href={item.href}
                          className={styles.sectionLink}
                          aria-current={expanded && item.href === activeHref ? 'location' : undefined}
                        >
                          <span>{item.label}</span>
                          {item.meta ? <small>{item.meta}</small> : null}
                        </a>
                      </li>
                    ))}
                  </ul>
                  {!expanded && activeItem ? (
                    <a href={activeItem.href} className={`${styles.sectionLink} ${styles.sectionActivePeek}`} aria-current="location">
                      <span>{activeItem.label}</span>
                      {activeItem.meta ? <small>{activeItem.meta}</small> : null}
                    </a>
                  ) : null}
                </div>
              );
            }) : navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className={styles.sectionLink}
                aria-current={item.href === activeHref ? 'location' : undefined}
              >
                <span>{item.label}</span>
                {item.meta ? <small>{item.meta}</small> : null}
              </a>
            ))}
          </nav>
        ) : null}

        <div className={`${styles.workspaceBody} ${isClinical ? styles.clinicalBody : ''}`}>
          {isClinical ? (
            <article
              className={styles.clinicalSurface}
              data-testid="lume-scheda-surface"
              data-lume-elevation="focal"
            >
              {children}
            </article>
          ) : children}
        </div>
      </main>
    </div>
  );
}

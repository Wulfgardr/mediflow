'use client';

/* @Codex */

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, FolderOpen } from 'lucide-react';

// WUL-297: Privacy Mode is always reachable from the workspace header.
import { PrivacyModeToggle } from '@/components/privacy-mode-toggle';
import styles from './kree8-workspace-shell.module.css';

export type Kree8WorkspaceNavItem = {
  href: string;
  label: string;
  meta?: string;
};

type Kree8WorkspaceShellProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  backHref: string;
  backLabel: string;
  patientLabel?: string;
  statusLabel?: string;
  navItems?: Kree8WorkspaceNavItem[];
  children: ReactNode;
};

export function Kree8WorkspaceShell({
  eyebrow,
  title,
  subtitle,
  backHref,
  backLabel,
  patientLabel,
  statusLabel,
  navItems = [],
  children,
}: Kree8WorkspaceShellProps) {
  /* @Codex WUL-UIUX: scrollspy. Su una Scheda lunga la rail evidenzia la sezione
     in vista (aria-current) cosi non si perde l'orientamento. */
  const [activeHref, setActiveHref] = useState<string | null>(null);
  /* @Codex WUL-55 F2c: mirror durevole di activeHref; ogni generazione dell'effetto
     (una per navKey) rilegge currentHref da qui, cosi un cambio navKey azzera un
     aria-current stantio invece di ereditarlo. */
  const activeHrefRef = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const navKey = navItems.map((item) => item.href).join('|');

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
      if (el !== focusEl) {
        if (focusEl) focusEl.removeAttribute('data-lume-focus');
        focusEl = el;
        if (focusEl) focusEl.setAttribute('data-lume-focus', '');
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

    /* Sezione attiva = quella piu in alto tra le visibili, cosi l'evidenziazione
       segue l'ordine visivo anche con le due colonne (DOM e rail divergono). */
    const pickActive = () => {
      const seen = targets.filter((target) => visible.has(target.el));
      if (seen.length === 0) return;
      const topmost = seen.reduce((best, target) =>
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
      }
    };

    bind();
    /* DOM-aware, senza polling: il MutationObserver ri-lega quando i bersagli
       compaiono/spariscono/vengono sostituiti (solo childList, cosi setAttribute
       del filo non lo ritriggera). */
    const mo = new MutationObserver(() => bind());
    mo.observe(root, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      mo.disconnect();
      if (observer) observer.disconnect();
      if (focusEl) focusEl.removeAttribute('data-lume-focus');
    };
  }, [navKey]);

  return (
    <div className={styles.shell} ref={rootRef}>
      <main className={styles.canvas}>
        <header className={styles.chrome}>
          <div className={styles.chromeTopRow}>
            <Link href={backHref} className={styles.backButton} aria-label={backLabel} title={backLabel}>
              <ArrowLeft size={13} aria-hidden />
              <span className={styles.backButtonLabel}>{backLabel}</span>
            </Link>
            {/* WUL-297: persistent privacy affordance in the app header */}
            <PrivacyModeToggle showLabel />
          </div>

          <div className={styles.hero}>
            <span className={styles.brandMark} aria-hidden>
              <FolderOpen size={12} />
            </span>
            <div className={styles.heroText}>
              <p className={styles.eyebrow}>{eyebrow}</p>
              <h1 className={styles.title}>
                <span className={styles.titleMain}>{title}</span>
              </h1>
              {patientLabel ? <p className={styles.patientLabel}>{patientLabel}</p> : null}
              <p className={styles.subtitle}>{subtitle}</p>
              {statusLabel ? <p className={styles.statusLine}>{statusLabel}</p> : null}
            </div>
          </div>
        </header>

        {navItems.length > 0 ? (
          <nav className={styles.sectionRail} aria-label="Sezioni della vista">
            {navItems.map((item) => (
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

        <div className={styles.workspaceBody}>
          {children}
        </div>
      </main>
    </div>
  );
}

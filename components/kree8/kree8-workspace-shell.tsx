'use client';

/* @Codex */

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
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
  const navKey = navItems.map((item) => item.href).join('|');

  useEffect(() => {
    const hrefs = navKey ? navKey.split('|') : [];
    const targets = hrefs
      .map((href) => {
        const el = href.startsWith('#') ? document.getElementById(href.slice(1)) : null;
        return el ? { href, el } : null;
      })
      .filter((entry): entry is { href: string; el: HTMLElement } => entry !== null);
    if (targets.length === 0) return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const href = `#${entry.target.id}`;
          if (entry.isIntersecting) visible.add(href);
          else visible.delete(href);
        }
        /* Sezione attiva = quella piu in alto sullo schermo tra le visibili, cosi
           l'evidenziazione segue l'ordine visivo anche con le due colonne (dove
           l'ordine del DOM e quello della rail possono divergere). */
        const visibleTargets = targets.filter((target) => visible.has(target.href));
        if (visibleTargets.length > 0) {
          const topmost = visibleTargets.reduce((best, target) =>
            target.el.getBoundingClientRect().top < best.el.getBoundingClientRect().top ? target : best,
          );
          setActiveHref(topmost.href);
        }
      },
      { rootMargin: '-120px 0px -65% 0px', threshold: [0, 0.25, 0.6] },
    );
    targets.forEach((target) => observer.observe(target.el));
    return () => observer.disconnect();
  }, [navKey]);

  return (
    <div className={styles.shell}>
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

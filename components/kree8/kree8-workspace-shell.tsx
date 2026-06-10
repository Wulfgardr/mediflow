'use client';

/* @Codex */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft, FolderOpen } from 'lucide-react';

// WUL-297 — Privacy Mode is always reachable from the workspace header.
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
  return (
    <div className={styles.shell}>
      <main className={styles.canvas}>
        <header className={styles.chrome}>
          <div className={styles.chromeTopRow}>
            <Link href={backHref} className={styles.backButton} aria-label={backLabel} title={backLabel}>
              <ArrowLeft size={13} aria-hidden />
              <span className={styles.backButtonLabel}>{backLabel}</span>
            </Link>
            {/* WUL-297 — persistent privacy affordance in the app header */}
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
              <a key={item.href} href={item.href} className={styles.sectionLink}>
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

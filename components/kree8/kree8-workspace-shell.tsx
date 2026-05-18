'use client';

/* @Codex */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft, FolderOpen } from 'lucide-react';

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
          <div className={styles.hero}>
            <span className={styles.brandMark} aria-hidden>
              <FolderOpen size={14} />
            </span>
            <div className={styles.heroText}>
              <p className={styles.eyebrow}>{eyebrow}</p>
              <h1 className={styles.title}>
                {title}
                {patientLabel ? <em>{patientLabel}</em> : null}
              </h1>
              <p className={styles.subtitle}>{subtitle}</p>
              {statusLabel ? <p className={styles.statusLine}>{statusLabel}</p> : null}
            </div>
          </div>

          <Link href={backHref} className={styles.backButton}>
            <ArrowLeft size={13} />
            {backLabel}
          </Link>
        </header>

        {navItems.length > 0 ? (
          <nav className={styles.sectionRail} aria-label="Sezioni cartella">
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

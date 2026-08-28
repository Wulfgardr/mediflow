'use client';

/* @Codex */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  CalendarClock,
  ChartNoAxesCombined,
  CircleHelp,
  CornerDownLeft,
  Database,
  FileText,
  Plus,
  Scale,
  Search,
  Settings,
  Users,
  X,
} from 'lucide-react';

import type { AreaId } from './cockpit-shared';
import styles from './kree8-command-center.module.css';

type CommandCenterMode = 'commands' | 'help' | null;

type CommandItem = {
  id: string;
  label: string;
  hint: string;
  icon: typeof Search;
  run: () => void;
};

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

const SHORTCUTS = [
  ['⌘/Ctrl + K', 'Apri i comandi'],
  ['?', 'Apri questo aiuto'],
  ['/', 'Cerca nella lista pazienti'],
  ['↑/↓ oppure j/k', 'Naviga tutte le righe virtualizzate'],
  ['Home / End', 'Vai alla prima o ultima riga'],
  ['Page Up / Page Down', 'Avanza di una pagina'],
  ['Invio', 'Apri la Scheda della riga attiva'],
  ['n', 'Crea una nuova voce per il paziente attivo'],
] as const;

export function Kree8CommandCenter({
  mode,
  onClose,
  onOpenArea,
  onSearchRequest,
  onShowHelp,
}: {
  mode: CommandCenterMode;
  onClose: () => void;
  onOpenArea: (area: AreaId) => void;
  onSearchRequest: () => void;
  onShowHelp: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const commands = useMemo<CommandItem[]>(() => {
    const openArea = (area: AreaId) => {
      onOpenArea(area);
      onClose();
    };
    const openRoute = (href: string) => {
      router.push(href);
      onClose();
    };
    return [
      { id: 'agenda', label: 'Apri Agenda', hint: 'Area di turno', icon: CalendarClock, run: () => openArea('turno') },
      { id: 'patients', label: 'Apri Pazienti', hint: 'Lista e lente rapida', icon: Users, run: () => openArea('incarico') },
      { id: 'diary', label: 'Apri Diario', hint: 'Timeline clinica', icon: FileText, run: () => openArea('diario') },
      { id: 'catalogs', label: 'Apri Repertori', hint: 'Cataloghi locali', icon: Database, run: () => openArea('repertori') },
      { id: 'analytics', label: 'Apri Analisi', hint: 'Cruscotto locale', icon: ChartNoAxesCombined, run: () => openRoute('/analytics') },
      { id: 'scales', label: 'Apri Scale cliniche', hint: 'Catalogo e somministrazione', icon: Scale, run: () => openRoute('/scales') },
      { id: 'settings', label: 'Apri Impostazioni', hint: 'Governance locale', icon: Settings, run: () => openArea('governance') },
      {
        id: 'search',
        label: 'Cerca paziente',
        hint: 'Porta il fuoco alla ricerca',
        icon: Search,
        run: () => {
          onSearchRequest();
          onClose();
        },
      },
      { id: 'new', label: 'Nuova scheda', hint: 'Apri il flusso di inserimento', icon: Plus, run: () => openRoute('/patients/new') },
      { id: 'help', label: 'Aiuto tastiera', hint: 'Scorciatoie disponibili', icon: CircleHelp, run: onShowHelp },
    ];
  }, [onClose, onOpenArea, onSearchRequest, onShowHelp, router]);

  const matches = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('it-IT');
    if (!normalized) return commands;
    return commands.filter((command) => `${command.label} ${command.hint}`.toLocaleLowerCase('it-IT').includes(normalized));
  }, [commands, query]);

  useEffect(() => {
    if (!mode) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery('');
    setActiveIndex(0);
    window.setTimeout(() => {
      if (mode === 'commands') inputRef.current?.focus();
      else dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    }, 0);
    return () => previouslyFocused?.focus();
  }, [mode]);

  useEffect(() => setActiveIndex(0), [query]);

  if (!mode) return null;

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const container = dialogRef.current;
    if (!container) return;
    const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleCommandKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => Math.min(matches.length - 1, current + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => Math.max(0, current - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(Math.max(0, matches.length - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      matches[activeIndex]?.run();
    }
  };

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="kree8-command-title"
        onKeyDown={handleDialogKeyDown}
        data-testid="kree8-command-center"
      >
        <header className={styles.header}>
          <div>
            <p className={styles.caption}>{mode === 'commands' ? 'Navigazione rapida' : 'Tastiera'}</p>
            <h2 id="kree8-command-title" className={styles.title}>
              {mode === 'commands' ? 'Comandi MediFlow' : 'Aiuto e scorciatoie'}
            </h2>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Chiudi comandi">
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        {mode === 'commands' ? (
          <>
            <label className={styles.searchField}>
              <Search size={15} aria-hidden="true" />
              <input
                ref={inputRef}
                role="combobox"
                aria-controls="kree8-command-list"
                aria-expanded={matches.length > 0}
                aria-activedescendant={matches[activeIndex] ? `kree8-command-${matches[activeIndex].id}` : undefined}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleCommandKeyDown}
                placeholder="Cerca un comando"
                aria-label="Cerca un comando"
              />
              <kbd>esc</kbd>
            </label>
            <ul id="kree8-command-list" className={styles.commandList} role="listbox" aria-label="Comandi disponibili">
              {matches.map((command, index) => {
                const Icon = command.icon;
                return (
                  <li
                    key={command.id}
                    id={`kree8-command-${command.id}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    className={index === activeIndex ? styles.commandActive : styles.command}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={command.run}
                  >
                    <Icon size={16} aria-hidden="true" />
                    <span><b>{command.label}</b><small>{command.hint}</small></span>
                    {index === activeIndex ? <CornerDownLeft size={14} aria-hidden="true" /> : null}
                  </li>
                );
              })}
            </ul>
            {matches.length === 0 ? <p className={styles.empty}>Nessun comando corrispondente.</p> : null}
          </>
        ) : (
          <dl className={styles.shortcuts}>
            {SHORTCUTS.map(([keys, description]) => (
              <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{description}</dd></div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}

export type { CommandCenterMode };

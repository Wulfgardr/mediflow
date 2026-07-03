import { useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  Cloud,
  Database,
  HardDrive,
  KeyRound,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  UserSquare2,
} from 'lucide-react';

import {
  PillBadge,
  classNames,
} from '../cockpit-shared';
import styles from '../kree8-clinical-cockpit.module.css';


/* ───────────────────────── Sistema ───────────────────────── */

function GovernanceArea() {
  const [flags, setFlags] = useState({
    aiInsight: true,
    smartImport: true,
    reduceMotion: false,
    auditLog: true,
    backup: true,
    homeBaseNetwork: false,
    cloudComparator: false,
  });

  const toggle = (k: keyof typeof flags) =>
    setFlags((prev) => ({ ...prev, [k]: !prev[k] }));

  return (
    <div className={styles.areaShell}>
      <header className={styles.areaHeader}>
        <div>
          <p className={styles.areaCaption}>Sistema e impostazioni</p>
          <h1 className={styles.areaTitle}>
            Controlli della postazione <em>· accessi, AI e backup</em>
          </h1>
          <p className={styles.areaSubtitle}>
            Account, funzioni AI, rete, backup, repertori e controlli locali
            restano raggiungibili da qui.
          </p>
        </div>
      </header>

      <div className={styles.settingsGrid}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Account &amp; PIN</h2>
            <span className={styles.panelActions}>
              <PillBadge variant="muted">postazione</PillBadge>
            </span>
          </header>
          <p className={styles.panelSubtitle}>
            Profilo operatore e cambio PIN restano sulla postazione.
          </p>
          <div className={styles.modeCard}>
            <span className={styles.modeIcon}><KeyRound size={16} /></span>
            <span>
              <span className={styles.modeTitle}>PIN operatore</span>
              <br />
              <span className={styles.modeSub}>ultimo cambio 18 apr · promemoria 90 gg</span>
            </span>
            <Link href="/settings/accesso" className={styles.ghostBtnSm}>Cambia PIN</Link>
          </div>
          <div className={styles.modeCard} style={{ marginTop: 8 }}>
            <span className={styles.modeIcon}><UserSquare2 size={16} /></span>
            <span>
              <span className={styles.modeTitle}>Profilo MMG</span>
              <br />
              <span className={styles.modeSub}>Operatore configurato · sede locale</span>
            </span>
            <Link href="/settings/profilo" className={styles.ghostBtnSm}>Modifica profilo</Link>
          </div>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Funzioni AI</h2>
            <span className={styles.panelActions}>
              <PillBadge variant="violet">
                <Sparkles size={11} /> a scelta
              </PillBadge>
            </span>
          </header>
          <p className={styles.panelSubtitle}>
            Le funzioni AI restano spente o attive per area, con controlli
            rapidi.
          </p>

          {[
            {
              id: 'aiInsight' as const,
              title: 'Sintesi paziente',
              sub: 'riassunto locale al primo accesso',
            },
            {
              id: 'smartImport' as const,
              title: 'Import da documento',
              sub: 'estrazione da rivedere prima di scrivere',
            },
            {
              id: 'cloudComparator' as const,
              title: 'Confronto esterno',
              sub: 'spento di default · solo pacchetti redatti',
            },
          ].map((row) => (
            <div key={row.id} className={styles.toggleRow}>
              <div className={styles.toggleRowMain}>
                <span className={styles.toggleRowTitle}>{row.title}</span>
                <span className={styles.toggleRowSub}>{row.sub}</span>
              </div>
              <button
                type="button"
                aria-pressed={flags[row.id]}
                aria-label={row.title}
                className={classNames(styles.toggle, flags[row.id] && styles.toggleOn)}
                onClick={() => toggle(row.id)}
              />
            </div>
          ))}

          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
            {[
              { name: 'Modello clinico locale', tag: 'attivo', variant: 'green' as const },
              { name: 'Motore Apple locale', tag: 'in prova', variant: 'blue' as const },
              { name: 'Redazione dati', tag: 'osservazione', variant: 'violet' as const },
              { name: 'Confronto esterno', tag: 'su richiesta', variant: 'muted' as const },
            ].map((m) => (
              <div key={m.name} className={styles.compositeCard}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Activity size={13} color="var(--ink-muted)" />
                  <span style={{ fontSize: 12.5, color: 'var(--ink)' }}>{m.name}</span>
                  <span style={{ marginLeft: 'auto' }}>
                    <PillBadge variant={m.variant}>{m.tag}</PillBadge>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Modalità di rete</h2>
            <span className={styles.panelActions}>
              <PillBadge variant="green">locale di default</PillBadge>
            </span>
          </header>
          <p className={styles.panelSubtitle}>
            Il lavoro resta sul Mac di default. Il collegamento al Mac principale
            resta opzionale e richiede una LAN fidata.
          </p>
          <div className={styles.toggleRow}>
            <div className={styles.toggleRowMain}>
              <span className={styles.toggleRowTitle}>Mac principale</span>
              <span className={styles.toggleRowSub}>
                attivalo solo su rete fidata · accesso controllato
              </span>
            </div>
            <button
              type="button"
              aria-pressed={flags.homeBaseNetwork}
              aria-label="Mac principale"
              className={classNames(styles.toggle, flags.homeBaseNetwork && styles.toggleOn)}
              onClick={() => toggle('homeBaseNetwork')}
            />
          </div>
          <div className={styles.modeCard} style={{ marginTop: 8 }}>
            <span className={styles.modeIcon}><Cloud size={16} /></span>
            <span>
              <span className={styles.modeTitle}>Mac principale</span>
              <br />
              <span className={styles.modeSub}>
                Mac principale raggiungibile sulla rete locale
              </span>
            </span>
            <PillBadge variant="green">attivo</PillBadge>
          </div>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Backup e repertori</h2>
            <span className={styles.panelActions}>
              <PillBadge variant="muted">programmato</PillBadge>
            </span>
          </header>
          <p className={styles.panelSubtitle}>
            Backup locale cifrato e repertori clinici sono gestiti dalle
            impostazioni dedicate.
          </p>
          <div className={styles.toggleRow}>
            <div className={styles.toggleRowMain}>
              <span className={styles.toggleRowTitle}>Backup automatico</span>
              <span className={styles.toggleRowSub}>
                salvataggio cifrato ogni 4 ore · conserva gli ultimi 12
              </span>
            </div>
            <button
              type="button"
              aria-pressed={flags.backup}
              aria-label="Backup automatico"
              className={classNames(styles.toggle, flags.backup && styles.toggleOn)}
              onClick={() => toggle('backup')}
            />
          </div>
          <div className={styles.modeCard} style={{ marginTop: 8 }}>
            <span className={styles.modeIcon}><HardDrive size={16} /></span>
            <span>
              <span className={styles.modeTitle}>Ultimo backup</span>
              <br />
              <span className={styles.modeSub}>02:14 · 318 MB · controllo riuscito</span>
            </span>
            <Link href="/settings/backup" className={styles.ghostBtnSm}>Esegui ora</Link>
          </div>
          <div className={styles.modeCard} style={{ marginTop: 8 }}>
            <span className={styles.modeIcon}><Database size={16} /></span>
            <span>
              <span className={styles.modeTitle}>Import repertori</span>
              <br />
              <span className={styles.modeSub}>AIFA · ICD · esenzioni · LOINC manuale</span>
            </span>
            <Link href="/settings/repertori" className={styles.ghostBtnSm}>Apri repertori</Link>
          </div>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Controlli locali</h2>
            <span className={styles.panelActions}>
              <PillBadge variant="muted">tracciato</PillBadge>
            </span>
          </header>
          <p className={styles.panelSubtitle}>
            I controlli registrano solo eventi tecnici essenziali e restano
            sulla postazione.
          </p>
          <div className={styles.toggleRow}>
            <div className={styles.toggleRowMain}>
              <span className={styles.toggleRowTitle}>Registro locale</span>
              <span className={styles.toggleRowSub}>
                eventi essenziali della postazione · esportabili manualmente
              </span>
            </div>
            <button
              type="button"
              aria-pressed={flags.auditLog}
              aria-label="Registro locale"
              className={classNames(styles.toggle, flags.auditLog && styles.toggleOn)}
              onClick={() => toggle('auditLog')}
            />
          </div>
          <div className={styles.toggleRow}>
            <div className={styles.toggleRowMain}>
              <span className={styles.toggleRowTitle}>Riduzione animazioni</span>
              <span className={styles.toggleRowSub}>riduce transizioni e movimenti dell&apos;interfaccia</span>
            </div>
            <button
              type="button"
              aria-pressed={flags.reduceMotion}
              aria-label="Riduzione animazioni"
              className={classNames(styles.toggle, flags.reduceMotion && styles.toggleOn)}
              onClick={() => toggle('reduceMotion')}
            />
          </div>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Versione e stato</h2>
            <span className={styles.panelActions}>
              <PillBadge variant="green">in linea</PillBadge>
            </span>
          </header>
          <p className={styles.panelSubtitle}>
            Controlla versione dell&apos;app, stato delle funzioni locali e
            disponibilità aggiornamenti.
          </p>
          <div className={styles.modeCard}>
            <span className={styles.modeIcon}><RefreshCcw size={16} /></span>
            <span>
              <span className={styles.modeTitle}>MediFlow · v0.6.4 (locale)</span>
              <br />
              <span className={styles.modeSub}>
                prossimo controllo 16 mag 06:00 · canale stabile
              </span>
            </span>
            <Link href="/settings/diagnostica" className={styles.ghostBtnSm}>Cerca aggiornamenti</Link>
          </div>
          <div className={styles.modeCard} style={{ marginTop: 8 }}>
            <span className={styles.modeIcon}><ShieldCheck size={16} /></span>
            <span>
              <span className={styles.modeTitle}>Modelli AI</span>
              <br />
              <span className={styles.modeSub}>
                1 modello attivo · 3 disponibili per prova
              </span>
            </span>
            <PillBadge variant="violet">stabile</PillBadge>
          </div>
        </section>
      </div>
    </div>
  );
}

export { GovernanceArea };

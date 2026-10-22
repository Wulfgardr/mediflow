# Viste reali dei comandi — PR #608

Confronto del 22 ottobre 2026 per WUL-787. **Due regressioni visive aperte; nessun ritaglio accidentale trovato nei figli dei pulsanti esaminati.** Nessuna modifica al runtime in questo commit.

## Revisioni e ambiente

- Prima: `e076ea44af9db4352211496c7d2db9e054068529`, base `origin/main` della PR, verificata con `gh pr view` e merge-base.
- Dopo: `a75724bc977f156273ab4f6f676fcbb4cc97eeb4`.
- Node 24.21.0; `npm ci` reale in entrambi i worktree; Chromium headless tramite `scripts/e2e-smoke.sh` e Turbopack. Le due catture principali e le due verifiche mirate finali sono passate, una per revisione.
- Archivi temporanei distinti creati con `mktemp -d`, passati sia a `MEDIFLOW_DATA_DIR` sia a `MEDIFLOW_E2E_DATA_DIR`; copia legacy disabilitata. Nessun accesso alla checkout primaria o all'archivio clinico dell'app.
- Seeder sintetico della ricognizione, conservato in [real-seed.ts.txt](real-seed.ts.txt). Aggiunte la terapia sospesa, la nota allergologica e la scala sintetica della ricognizione per riprodurre 011/054. Il profilo operatore è quello sintetico dell'harness.
- Stessi dati e viewport nelle coppie prima/dopo, Giorno e Grafite, larghezze 1440/768. Altezza fissa per coppia: 011 1425/2241; 054 2060/2230; impostazioni 1100/1600; dialogo e onboarding 960. Rimozione diagnosi: viewport alto 1800 e screenshot full-page, per mostrare il diverso reflow.
- 40 PNG richiesti + 8 PNG di approfondimento; dimensioni e SHA-256 in [real-manifest.json](real-manifest.json). Le catture sono state ispezionate visivamente in coppia. I PNG sono originali, senza ritocchi. Nessuna conferma di eliminazione eseguita.

## Regressioni aperte

1. **Conferma distruttiva disabilitata: etichetta quasi illeggibile.** Nel dialogo «Eliminare questo farmaco dalla cartella?», con motivazione vuota, `Elimina` resta correttamente disabilitato ma perde leggibilità in entrambi i temi e alle due larghezze. Il fondo inline `var(--lume-signal-critical)` in `components/ui/confirm-dialog.tsx` prevale sul nuovo fondo disabilitato, mentre la regola globale cambia il testo in `--lume-ink-muted`. Giorno: testo bianco → `rgb(85, 94, 107)` su `rgb(163, 58, 47)`; Grafite: `rgb(26, 29, 34)` → `rgb(163, 172, 184)` su `rgb(240, 138, 125)`. Opacità 0.5 → 0.55. È un problema di colore, non di clipping. Possibile correzione: usare la ricetta distruttiva di conferma al posto del fondo inline e qualificarne anche lo stato disabilitato.
2. **Rimozione diagnosi/pianificazione: perso il posizionamento assoluto.** I due siti in `components/patient-form.tsx` dichiarano `absolute -right-2 -top-2`, ma `html:root[data-lume] ... { position: relative }` prevale. Riprodotto sulla diagnosi in modifica paziente: il comando lascia l'angolo superiore destro e occupa una riga sopra i campi; le schede si allungano. A 768 il suo offset X rispetto alla scheda passa da 494 a 24 px; larghezza 46 → 50 px. Stessa causa statica per «Rimuovi pianificazione»; quella seconda azione non è stata attivata o qualificata separatamente. Possibile correzione: preservare il posizionamento esplicito dei chiamanti e assegnare `relative` ai soli controlli che ospitano l'anello, mantenendo la geometria comune.

Le regressioni restano aperte per il coordinatore. Questo incarico di test prevedeva la correzione di eventuali clipping: non ne è emerso uno che richiedesse un cambiamento di codice o un relativo test di regressione.

## Cambiamenti attesi e limiti

Nelle coppie 011/054 il padding orizzontale effettivo dei primari passa da 14 a 16 px. «Salva terapia» passa da circa 115.17 a 121.17 px; i link della testata aumentano di 4 px. Nessun testo tagliato o sovrapposto osservato in questi stati. Impostazioni indice e onboarding non mostrano regressioni nuove nelle quattro combinazioni: i loro controlli principali non usano gli alias storici misurati. Alcuni raggi erano già sovrascritti dal tema: il passaggio teorico da pillola a 10 px non produce un delta visibile in tutti i siti. Le catture provano questi stati, non tutti i consumatori né tutte le fasi asincrone.

## Ricognizione overflow

[Inventario AST](real-button-inventory.json) di `app/**/*.tsx` e `components/**/*.tsx`: 111 elementi JSX espliciti con alias o wrapper, di cui 9 nel mockup, 88 con alias e 14 wrapper fuori dal mockup. Il conteggio usa un criterio diverso dai 96 siti testuali della review: elementi JSX espliciti, separati per alias e wrapper. Non va equiparato al conteggio delle occorrenze testuali.

- Nessun badge o contatore assoluto tra i discendenti espliciti dei pulsanti trovati. I discendenti di componente sono icone Lucide; controllati anche gli attributi `style` e `className` e le classi CSS di posizionamento.
- Spinner in `diagnostic-hub`, `prosthetic-prescription-manager`, `service-prescription-manager`, `siss-handoff-diary`, composizione diario e ambulatori: SVG nel normale flusso flex, non figli assoluti sporgenti.
- Gli input file `hidden` / `sr-only` nei controlli backup sono deliberatamente non visivi; non sono badge o contenuti da rendere fuori dal controllo.
- `Button` aggiunge `.lume-anello`: assoluto, `aria-hidden=true`, `pointer-events:none`. La verifica runtime sul wrapper conferma `overflow:hidden` del genitore. Il ritaglio dell'effetto di pressione ai bordi è intenzionale e precedeva la PR nel wrapper; non è un indicatore informativo perso.
- I due `absolute` di `patient-form` sono i pulsanti stessi, non loro figli: sono la regressione di posizionamento riportata sopra.
- Nessun figlio assoluto rilevato nei controlli visibili dei cinque stati principali; misure complete in [real-before-metrics.json](real-before-metrics.json) e [real-after-metrics.json](real-after-metrics.json). Le verifiche aggiuntive sono in [real-before-probes.json](real-before-probes.json) e [real-after-probes.json](real-after-probes.json).

## Catture

Ogni riga collega i PNG originali prima/dopo. Il dialogo è nello stato disabilitato iniziale, l'onboarding nel passo «Proteggi l’accesso».

| Stato | Tema | Larghezza | Prima | Dopo |
| --- | --- | --- | --- | --- |
| 011-riepilogo | giorno | 1440 | [PNG](real-before-011-riepilogo-giorno-1440.png) | [PNG](real-after-011-riepilogo-giorno-1440.png) |
| 011-riepilogo | giorno | 768 | [PNG](real-before-011-riepilogo-giorno-768.png) | [PNG](real-after-011-riepilogo-giorno-768.png) |
| 011-riepilogo | grafite | 1440 | [PNG](real-before-011-riepilogo-grafite-1440.png) | [PNG](real-after-011-riepilogo-grafite-1440.png) |
| 011-riepilogo | grafite | 768 | [PNG](real-before-011-riepilogo-grafite-768.png) | [PNG](real-after-011-riepilogo-grafite-768.png) |
| 054-nuova-terapia | giorno | 1440 | [PNG](real-before-054-nuova-terapia-giorno-1440.png) | [PNG](real-after-054-nuova-terapia-giorno-1440.png) |
| 054-nuova-terapia | giorno | 768 | [PNG](real-before-054-nuova-terapia-giorno-768.png) | [PNG](real-after-054-nuova-terapia-giorno-768.png) |
| 054-nuova-terapia | grafite | 1440 | [PNG](real-before-054-nuova-terapia-grafite-1440.png) | [PNG](real-after-054-nuova-terapia-grafite-1440.png) |
| 054-nuova-terapia | grafite | 768 | [PNG](real-before-054-nuova-terapia-grafite-768.png) | [PNG](real-after-054-nuova-terapia-grafite-768.png) |
| impostazioni-indice | giorno | 1440 | [PNG](real-before-impostazioni-indice-giorno-1440.png) | [PNG](real-after-impostazioni-indice-giorno-1440.png) |
| impostazioni-indice | giorno | 768 | [PNG](real-before-impostazioni-indice-giorno-768.png) | [PNG](real-after-impostazioni-indice-giorno-768.png) |
| impostazioni-indice | grafite | 1440 | [PNG](real-before-impostazioni-indice-grafite-1440.png) | [PNG](real-after-impostazioni-indice-grafite-1440.png) |
| impostazioni-indice | grafite | 768 | [PNG](real-before-impostazioni-indice-grafite-768.png) | [PNG](real-after-impostazioni-indice-grafite-768.png) |
| conferma-elimina-terapia | giorno | 1440 | [PNG](real-before-conferma-elimina-terapia-giorno-1440.png) | [PNG](real-after-conferma-elimina-terapia-giorno-1440.png) |
| conferma-elimina-terapia | giorno | 768 | [PNG](real-before-conferma-elimina-terapia-giorno-768.png) | [PNG](real-after-conferma-elimina-terapia-giorno-768.png) |
| conferma-elimina-terapia | grafite | 1440 | [PNG](real-before-conferma-elimina-terapia-grafite-1440.png) | [PNG](real-after-conferma-elimina-terapia-grafite-1440.png) |
| conferma-elimina-terapia | grafite | 768 | [PNG](real-before-conferma-elimina-terapia-grafite-768.png) | [PNG](real-after-conferma-elimina-terapia-grafite-768.png) |
| onboarding-proteggi-accesso | giorno | 1440 | [PNG](real-before-onboarding-proteggi-accesso-giorno-1440.png) | [PNG](real-after-onboarding-proteggi-accesso-giorno-1440.png) |
| onboarding-proteggi-accesso | giorno | 768 | [PNG](real-before-onboarding-proteggi-accesso-giorno-768.png) | [PNG](real-after-onboarding-proteggi-accesso-giorno-768.png) |
| onboarding-proteggi-accesso | grafite | 1440 | [PNG](real-before-onboarding-proteggi-accesso-grafite-1440.png) | [PNG](real-after-onboarding-proteggi-accesso-grafite-1440.png) |
| onboarding-proteggi-accesso | grafite | 768 | [PNG](real-before-onboarding-proteggi-accesso-grafite-768.png) | [PNG](real-after-onboarding-proteggi-accesso-grafite-768.png) |
| rimozione-diagnosi | giorno | 1440 | [PNG](real-before-rimozione-diagnosi-giorno-1440.png) | [PNG](real-after-rimozione-diagnosi-giorno-1440.png) |
| rimozione-diagnosi | giorno | 768 | [PNG](real-before-rimozione-diagnosi-giorno-768.png) | [PNG](real-after-rimozione-diagnosi-giorno-768.png) |
| rimozione-diagnosi | grafite | 1440 | [PNG](real-before-rimozione-diagnosi-grafite-1440.png) | [PNG](real-after-rimozione-diagnosi-grafite-1440.png) |
| rimozione-diagnosi | grafite | 768 | [PNG](real-before-rimozione-diagnosi-grafite-768.png) | [PNG](real-after-rimozione-diagnosi-grafite-768.png) |

## Riproduzione

Le sorgenti delle prove sono conservate come testo per non includerle nelle suite ordinarie: [catture](real-capture.spec.ts.txt), [verifiche mirate](real-probe.spec.ts.txt), [configurazione](real-playwright.config.ts.txt), [inventario](real-inventory.cjs.txt). In ciascun worktree della revisione indicata:

```bash
mkdir -p tmp-real-commands
cp docs/analysis/2026-10-22-command-roles/real-capture.spec.ts.txt tmp-real-commands/capture.spec.ts
cp docs/analysis/2026-10-22-command-roles/real-probe.spec.ts.txt tmp-real-commands/probe.spec.ts
cp docs/analysis/2026-10-22-command-roles/real-playwright.config.ts.txt tmp-real-commands/playwright.config.ts
cp docs/analysis/2026-10-22-command-roles/real-seed.ts.txt tmp-real-commands/seed.ts
export MEDIFLOW_E2E_DATA_DIR=$(mktemp -d)
export MEDIFLOW_DATA_DIR="$MEDIFLOW_E2E_DATA_DIR"
export MEDIFLOW_E2E_DISABLE_LEGACY_COPY=1 E2E_DISABLE_LEGACY_COPY=1
export MEDIFLOW_NEXT_DIST_DIR=.next-real-commands
export E2E_BASE_URL=http://127.0.0.1:3208
export E2E_SPECS=--config=tmp-real-commands/playwright.config.ts
export REAL_COMMAND_OUT="$PWD/docs/analysis/2026-10-22-command-roles"
export REAL_COMMAND_PHASE=after
bash scripts/e2e-smoke.sh
```

Per la base copiare prima gli stessi quattro file dal commit delle evidenze; usare `REAL_COMMAND_PHASE=before` e una porta libera. Per le verifiche aggiuntive usare un nuovo archivio `mktemp -d` e `REAL_COMMAND_PROBE=1`. Node 24.21.0 deve essere il primo nel PATH. Le prove terminano i propri server. Un primo tentativo della verifica dell'anello sull'head ha selezionato il pulsante di classe anziché il wrapper: corretto il selettore e rieseguita la prova, passata. Non era un difetto del prodotto.

Esecuzione e analisi assistite da GPT 6.1 Sol, effort Medium. Nessun consumo numerico attribuibile disponibile. Le correzioni sopra sono proposte di merito, non modifiche già applicate o accettazione del merge.

# ADR 0050: Ritiro dei preview profiles funzionali su `main`

Date: 2026-04-22  
Status: Accepted

## Problema

Dopo `ADR 0047`, MediFlow ha una sola shell web ufficiale, ma su `main`
resta ancora un selettore `Dev Preview Profiles` che suggerisce una
separazione runtime tra:

- stack AI;
- Smart Import review;
- contesto paziente SISS.

Nel runtime reale, però, `AI` e `Smart Import` sono già parte della shell
ufficiale e il solo gating funzionale residuo è il pannello contestuale SISS
nel dettaglio paziente. Questo crea ambiguità: la UI racconta ancora feature
come opzionali o da preview anche quando la direzione di prodotto è ormai
decisa.

## Opzioni

1. Tenere il selettore dev-only e continuare a usarlo per attivare slice
   funzionali su `main`.
2. Nascondere il selettore ma lasciare in piedi registry, persistenza locale e
   gating funzionale residuo.
3. Ritirare i preview profiles funzionali da `main` e promuovere le superfici
   mature dentro la shell ufficiale.

## Trade-off

- Opzione 1:
  - Pro: preserva una leva locale semplice per riattivare slice sperimentali.
  - Contro: mantiene una narrativa di prodotto ambigua e lascia un canale
    runtime parallelo su `main`.
- Opzione 2:
  - Pro: riduce il rumore visibile all'operatore con diff applicativo piccolo.
  - Contro: conserva drift tecnico e semantico: il sistema continua ad avere un
    routing implicito non documentato in UI.
- Opzione 3:
  - Pro: allinea interfaccia, codice e documentazione a una sola mainline
    reale, riduce infrastruttura locale superflua e promuove il contesto SISS
    dove serve davvero.
  - Contro: eventuali nuove slice funzionali dovranno vivere su branch/workstream
    dedicati o dietro altri meccanismi espliciti, non più come toggle generico
    in `Settings`.

## Decisione

Adottiamo l'opzione 3.

Su `main`:

- il `Clinical Workbench` non espone più `Preview Profiles`;
- `AI` e `Smart Import` restano parte della shell ufficiale senza toggle
  dedicati;
- il pannello `SISS` diventa parte stabile della scheda paziente;
- il fallback al pannello prescrittivo legacy usato solo come default di
  preview viene rimosso dal percorso standard;
- la persistenza locale `devPreviewProfile`, il banner preview e lo styling
  condizionato ai profili vengono ritirati dal runtime.

## Conseguenze

Diventa più semplice:

- leggere `main` come unico stato supportato della web app;
- verificare la scheda paziente senza distinguere tra modalità base e preview;
- mantenere coerenti `Settings`, walkthrough e README con il comportamento
  reale del prodotto.

Diventa più difficile:

- usare `main` come laboratorio di slice funzionali attivabili localmente con
  un menu generico;
- tenere gating runtime temporanei senza dichiarare un workstream esplicito.

## First Thin Slice

1. Rimuovere `PreviewProfileChrome`, registry e selettore in `Settings`.
2. Mostrare sempre `SissPatientContextPanel` nel dettaglio paziente.
3. Eliminare il fallback legacy usato solo nei profili preview.
4. Riallineare README, FAQ, walkthrough, piano operativo e mappa docs.

## Fuori Scope

- nuovi moduli SISS oltre il boundary già dichiarato;
- routing multi-shell o branch switching da UI;
- nuove preview locali permanenti dentro `main`.

<!-- Codex: created 2026-04-22 -->
# ADR 0047: Graphite workbench come unica shell web ufficiale

Date: 2026-04-22  
Status: Accepted

> Nota: la parte sui preview profiles funzionali su `main` e stata poi ritirata
> da [ADR 0050](./0050-functional-preview-profiles-retired-on-mainline.md).

## Problema

Dopo il redesign `WUL-196`, MediFlow ha ancora residui di una fase esplorativa:

- selettore persistito `uiStyleMode`
- narrativa prodotto `Clinico` vs `Liquid`
- preview profile di shell che suggeriscono piu grammatiche UI concorrenti

Questo assetto aumenta il drift tra shell, complica il testing, rende meno chiaro cosa sia davvero supportato su `main` e lascia l'interfaccia ufficiale in uno stato ambiguo.

## Opzioni

1. Mantenere il doppio stile persistito (`Clinico` / `Liquid`) e continuare a raffinare entrambe le grammatiche.
2. Tenere `Graphite` come preview avanzata, lasciando la shell storica come default stabile.
3. Consolidare `Graphite / Clinical Workbench` come unica shell web ufficiale e spostare i preview profile sul solo perimetro funzionale.

## Trade-off

- Opzione 1:
  - Pro: mantiene confrontabilita immediata tra due direzioni visive.
  - Contro: raddoppia manutenzione, test e regressioni potenziali senza aumentare il valore operativo.
- Opzione 2:
  - Pro: preserva una base conservativa su `main`.
  - Contro: lascia la shell migliore fuori dal runtime reale e prolunga una fase di indecisione gia superata.
- Opzione 3:
  - Pro: chiarisce subito la superficie ufficiale, riduce branching UI e rende il lavoro di rifinitura verificabile su un solo shell.
  - Contro: archivia definitivamente il confronto runtime tra grammatiche diverse e impone di trattare eventuali nuovi esperimenti come slice dedicate, non come toggle permanenti.

## Decisione

Adottiamo l'opzione 3.

Su `main`, la shell web ufficiale di MediFlow e `Graphite / Clinical Workbench`.

Questo implica che:

- `uiStyleMode` non espone piu scelte utente reali
- il redesign Graphite diventa il solo runtime supportato
- la pagina `Impostazioni` non propone piu modalita visive alternative
- i `Preview Profiles` restano solo per slice funzionali (`AI`, `Smart Import`, `SISS`) e non per shell estetiche concorrenti

## Conseguenze

Diventa piu semplice:

- verificare shell, home, dettaglio paziente e sottoviste su un solo path
- mantenere coerenza visiva e accessibilita su `main`
- considerare le rifiniture future come evoluzione dello stesso shell, non come fork di design

Diventa piu difficile:

- usare `main` come laboratorio permanente di confronto tra grammatiche UI
- tenere attive piu direzioni visive senza aprire workstream espliciti e separati

## First Thin Slice

1. Portare su `main` il runtime Graphite verificato nel filone `WUL-196`.
2. Forzare la shell redesign nel provider/stato UI e rimuovere il chooser utente.
3. Eliminare dal registry locale il preview profile di shell, mantenendo solo quelli funzionali.
4. Riallineare roadmap, FAQ, walkthrough e piano operativo al fatto che esiste una sola shell ufficiale.

## Fuori Scope

- redesign futuri della shell native Apple
- nuovi temi runtime paralleli su `main`
- rimozione dei preview profile funzionali non estetici

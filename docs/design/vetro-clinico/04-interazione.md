---
summary: "Interaction grammar for Vetro Clinico: feedback timing, springs, keyboard, forms, navigation continuity, and honest states."
read_when:
  - "Designing or reviewing any interactive behavior: buttons, drags, transitions, forms, shortcuts, empty/loading/error states."
---

# Interazione

## 1. Risposta

- **Il feedback vive sul pointer-down.** Un bottone si abbassa quando lo si preme (`:active { transform: scale(0.97) }`, 100ms ease-out), non quando si rilascia. L'evidenziazione al rilascio è percepita come lentezza.
- **Durante una manipolazione diretta il feedback è continuo**: un pannello trascinato segue il puntatore 1:1, rispettando il punto di presa; mai animare solo a gesto concluso.
- **Ogni latenza si giustifica**: debounce, timer, attese di transizione sul percorso dell'input sono regressioni finché non provano il contrario.

## 2. Movimento

- **Spring smorzata come default** (`motion.standard`: niente overshoot, response 0.3-0.35s). Il rimbalzo (`motion.momentum`, damping ~0.8) è ammesso solo quando il gesto aveva quantità di moto: un flick, un rilascio di drag. Un menu che appare non rimbalza.
- **Tutto è interrompibile.** Le animazioni partono dal valore corrente a schermo, mai da quello logico; un pannello che si sta chiudendo può essere ripreso a metà corsa. Sul web questo esclude `@keyframes` per tutto ciò che è guidato dal gesto; su SwiftUI le spring di sistema lo fanno da sole.
- **Percorsi spaziali simmetrici**: ciò che entra da destra esce a destra; un popover origina dal suo trigger (`transform-origin` sul trigger, non sul centro).
- **Il movimento esiste solo per cambi di stato reali**: un salvataggio riuscito, un elemento nuovo in lista, un passaggio Quadro/Scheda. Movimento decorativo: vietato ([01-fondamenta.md](./01-fondamenta.md), principio 5).
- **Reduce Motion**: ogni movimento spaziale ha l'equivalente `motion.reduced` (cross-fade 200ms). Già cablato via CSS sul web; sul nativo va rispettato `accessibilityReduceMotion` quando si introducono transizioni esplicite.

## 3. Continuità Quadro/Scheda

Il passaggio dalla sinossi in-cockpit (Quadro) alla cartella completa (Scheda, `/patients/[id]/modules`) è la transizione più frequente e più delicata del prodotto: il clinico non deve mai chiedersi "dove sono finito".

- L'identità paziente (nome, dati chiave) è l'elemento condiviso: idealmente si muove con continuità tra le due viste (vedi esplorazione Vetro Vivo in [08-esplorazioni.md](./08-esplorazioni.md)); come minimo, resta nello stesso quadrante dello schermo con la stessa gerarchia tipografica.
- Il ritorno è simmetrico e senza perdita di contesto: la Scheda torna al Quadro nello stato in cui lo si era lasciato. Prerequisito tecnico: lo stato del cockpit riflesso nell'URL (finding A della revisione 2026-07-02, fase 6 della roadmap).

## 4. Tastiera

- **Scorciatoie a lettera singola nel cockpit** per le azioni ricorrenti (pattern Linear), scopribili all'hover e in una vista di aiuto richiamabile con `?`. Le lettere si assegnano una volta e non si riciclano tra aree.
- **La command capsule è una palette di comandi**, non solo ricerca: azioni cliniche invocabili per nome, con la scorciatoia mostrata accanto.
- **Percorsi completi**: ogni flusso (nuova voce diario, conferma, chiusura modale) è percorribile da sola tastiera. `Escape` chiude sempre l'overlay più recente; il focus torna all'elemento che lo ha aperto (già fatto da `useDialogA11y`: è lo standard).
- **Focus visibile unico**: `--mf-focus-ring` è l'unico anello del sistema, presente su ogni elemento interattivo via `:focus-visible`.

## 5. Feedback di esito

Quattro tipi: stato, completamento, avviso, errore. Strumenti canonici già in repo:

- **Toast** (`components/ui/toast-provider.tsx`): esiti non bloccanti. Toni e durate già corretti (success/info 4s, warning 5.5s, error 7s; `role="alert"` per errori). Un'azione reversibile mostra "Annulla" nel toast invece di chiedere conferma prima.
- **Conferma** (`components/ui/confirm-dialog.tsx`): solo per azioni distruttive o irreversibili; per le distruttive cliniche `requireReason` raccoglie la motivazione. Abusarne addestra a cliccare senza leggere: se un'azione è annullabile, niente dialogo.
- **Migrazione obbligata**: i 23 `confirm()`, 47 `alert()` e 1 `prompt()` nativi censiti dalla revisione 2026-07-02 passano a questi due strumenti (fase 5 della roadmap; il caso peggiore è la motivazione clinica raccolta con `prompt()` in `timeline.tsx:16`).
- **Errore inline nei form**: la validazione parla accanto al campo, al momento giusto (alla perdita di focus o al submit, mai a ogni battuta per errori di completezza).

## 6. Form clinici

- Base: `.mf-input`/`.mf-textarea`, radius 16px, focus ring di sistema.
- **Guardia anti doppio-submit** su ogni salvataggio clinico (`isSaving`), con bottone in stato di attesa; un salvataggio fallito parla (toast error), mai errore silenzioso.
- **Autocomplete = combobox ARIA** (`role="combobox"`, frecce, Escape, annuncio dei risultati): i tre autocomplete clinici (farmaci, ICD, esenzioni) adottano il pattern già validato da `settings-search` (WUL-297).
- I valori inseriti non si perdono: navigare via da un form sporco chiede conferma o salva bozza; un errore di rete non svuota i campi.
- Date e numeri rispettano la localizzazione italiana (virgola decimale, `36,5`).

## 7. Stati onesti

| Stato | Regola | Riferimento |
| --- | --- | --- |
| Caricamento | Skeleton (`.mf-skeleton`) solo dove la struttura è nota; altrimenti indicatore semplice. Mai flash di vuoto durante il load. | `patient-list.tsx` (finding noto) |
| Vuoto | Dice cosa manca e come procedere, nel dominio: "Nessuna diagnosi codificata in primo piano. Usa la scheda per strutturare il caso." | `case-lens-panel.tsx:334` (modello) |
| Errore | Distinto dal vuoto e dal caricamento, con azione di ritentativo. Prerequisito: `useLiveQueryState` che distingue load/errore/vuoto sulle 28 superfici oggi mute (fase 5). | revisione 2026-07-02 |
| Successo | Toast breve; l'interfaccia mostra il nuovo stato, il toast non è l'unica prova. | |

## 8. Suono e aptica

Quasi mai. Se un giorno si aggiungono (es. conferma su mobile): stesso frame del feedback visivo, solo su eventi con causa evidente, mai per decorazione.

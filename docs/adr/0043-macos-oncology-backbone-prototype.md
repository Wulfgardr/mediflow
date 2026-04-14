<!-- Codex: created 2026-04-10 -->
# ADR 0043: prototipo backbone oncologico macOS nativo, sintetico e locale

Date: 2026-04-10  
Status: Accepted

## Problema

Serve un prototipo reviewable della dorsale clinico-organizzativa oncologica che:

- mostri percorsi multi-step per pazienti oncologici
- distingua ruoli diversi (`MMG`, `oncologo`, `operatore amministrativo`)
- permetta simulazione di referral, prenotazioni, checklist, alert e consulto
  contestuale
- resti coerente con i guardrail MediFlow (`local-first`, `synthetic-only`, no
  write path clinici reali)

Manca pero una decisione esplicita su dove collocare questa esperienza senza
mescolarla con il backend autoritativo, con le surface `/api/v1` esistenti o con
il filone parity congelato.

## Opzioni

1. Estendere subito il backend e il contratto `/api/v1` per ospitare il percorso
   oncologico.
2. Costruire un prototipo nativo macOS dentro `native/MediFlowMac`, usando solo
   dati sintetici in memoria e logica locale simulata.
3. Limitarsi a mockup statici o schermate non interattive.

## Trade-off

- Opzione 1:
  - Pro: prepara direttamente una futura integrazione reale.
  - Contro: allarga troppo presto contratti, superficie test e rischio di drift
    rispetto a un dominio ancora in esplorazione.
- Opzione 2:
  - Pro: consente un thin slice interattivo, verificabile e credibile senza
    toccare dati reali, API o database.
  - Contro: introduce logica locale che va trattata esplicitamente come
    prototipale e non autoritativa.
- Opzione 3:
  - Pro: costo e rischio minimi.
  - Contro: valore operativo basso; impossibile validare davvero flussi,
    permessi e simulazioni.

## Decisione

Adottiamo l'opzione 2.

Il primo prototipo della backbone oncologica vive nel package macOS
`native/MediFlowMac` come shell SwiftUI autonoma, con:

- dati sintetici in memoria
- percorsi verticali pilota (`HCC`, `NSCLC`, `SCLC`)
- ruoli applicativi con visibilita differenziata
- motore locale di avanzamento, validazione e alert
- consulto clinico simulato (`rules` / `copilot`) senza dipendere da runtime AI
  reali o dal backend applicativo

Il prototipo non modifica:

- schema SQLite
- endpoint `/api/v1/*`
- boundary auth/session del prodotto reale
- flussi documentali o import clinici autoritativi

## Conseguenze

Diventa piu semplice:

- validare rapidamente l'esperienza operativa della dorsale oncologica
- mostrare progressione del paziente, checklist, referral e dashboard
- esplorare error handling e proattivita senza intaccare il core MediFlow

Diventa piu difficile:

- riusare subito il prototipo come base runtime production-ready
- inferire contratti backend o policy cliniche definitive dalla sola UI

## First Thin Slice

1. Sostituire la shell principale del package macOS con una root view dedicata
   al prototipo oncologico.
2. Introdurre modelli sintetici per pazienti, percorsi, step, referral,
   prenotazioni, alert e guidance links.
3. Implementare dashboard, lista pazienti, dettaglio percorso, inbox e
   impostazioni di simulazione.
4. Coprire con test la progressione del percorso, i blocchi su prestazioni non
   congrue e la generazione dei prossimi step suggeriti.

## Fuori Scope

- integrazione con dati paziente reali
- sincronizzazione con backend web/API esistente
- automazioni cliniche autonome o consigli terapeutici autoritativi
- formalizzazione di un modello oncologico definitivo di prodotto

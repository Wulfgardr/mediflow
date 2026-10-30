# Accettazione CU del 30 ottobre 2026

CU-1 è integrata sul portale inventato; l'accettazione e il gesto Touch ID reale restano aperti. ADR 0162 resta **Proposed**. Le altre procedure hanno contratti ed esempi sintetici, con prove del servizio comune; non hanno tutte un adapter specifico. Nessuna riga viene dichiarata chiusa da questo dossier.

## Revisioni e fonti

- Base di questo contributo: `5e356edbc51e9b9c2132282a0b9ac9a4fb07f7de`, acquisita da `origin/main` il 30 ottobre.
- [PR #715](https://github.com/Wulfgardr/mediflow/pull/715): head `d4dbedb4603cf3a631fd00ed1e5f45148fb66eac`, merge `e66fe9d7a1e94a5aa77a43e4fde95a72c47ca724`. Il [commento WUL-791](https://linear.app/wulfgardr/issue/WUL-791) del 29 ottobre registra 177/177, negativi, TLC e review indipendenti. Il corpo della PR conserva anche la precedente campagna 174/174 su altra revisione: i conteggi non si sommano.
- [PR #719](https://github.com/Wulfgardr/mediflow/pull/719): head `894bc7607ca1d9f6be09b182a16df0fc9f30447b`, merge `2af15f591e865cd46078ad1598d41bcd05d2ef97`. Timer CU deterministico 50/50, verticale 107/107 e dominio 70/70 riportati nella PR. Questi sono risultati storici del simulatore. La suite launcher Windows aveva 5 fallimenti nella VM ARM64: non è una qualifica Windows CU né un risultato tutto verde.
- Nuovi test e harness manuale: `3943e0bbcd6991ec921b7d0dbbec977a7b91eab7`. Il delta è esclusivamente test e documenti; nessun codice di produzione modificato. Gli esiti correnti sono in [verifiche](./verifiche.md); la CI della PR identifica la revisione finale, compreso il dossier.

Il [contratto 0.9.1, sezione CU](../../releases/0.9.1-contract.md#cu--incarico-aggiunto-in-coda-il-23-ottobre-2026) e i [cinque contratti](../2026-10-23-computer-use-procedure-contracts.md) governano il perimetro. La matrice di coordinamento del 30 ottobre, unità di lavoro 11, conta sei righe: una verticale e cinque contratti. Questa tabella conserva tale distinzione.

## Le sei righe CU

| Riga | Stato e prova attribuita | Cosa manca |
| --- | --- | --- |
| CU-1, verticale specialistica | Parziale. #715 e #719 provano portale HTML inventato, autorità locale simulata, writer SQLite sintetico, audit, riconciliazione e negativi. Nuova revisione test `3943e0bbc` senza variazioni del prodotto | Touch ID reale, osservazione del percorso nativo da parte di Leonardo e decisione su CU-1/ADR |
| Contratto specialistica | Implementato sul simulatore, accettazione aperta. `specialist/prescription.test.ts`, `vertical.test.ts` e `protocol.test.ts`; #715/#719 e nuova revisione `3943e0bbc` | Accettazione; nessuna equivalenza con PRREG reale |
| Contratto farmaceutica | Parziale. Contratto documentato; quattro nuovi casi del servizio comune in `procedure-contracts.test.ts`, revisione `3943e0bbc`, con dose e unità inalterate | Adapter sintetico e writer specifici; validazioni confezioni, cataloghi, note/piani, ricette separate e relativi negativi. Le loro attese sono fissate nei casi contrattuali |
| Contratto Protesica | Parziale. Contratto documentato; quattro nuovi casi comuni, revisione `3943e0bbc`, con misura e atto inserimento conservati | Adapter sintetico, upload e writer specifici; ruolo e stati inserimento/autorizzazione/consegna/collaudo distinti da verificare |
| Contratto esenzioni | Parziale. Rifiuto di titolo non pertinente, scaduto/futuro/di altro assistito nel validatore specialistico. Due nuovi test specifici e quattro comuni a `3943e0bbc` | Applicazione selettiva mista per riga: oggi il piano misto è interamente rifiutato. Nessuna ricevuta autonoma inventata |
| Contratto introduttivo INPS | Parziale. Contratto documentato; quattro nuovi casi comuni a `3943e0bbc`, eseguiti anche con il solo pacchetto Italia | Adapter sintetico, ramo territoriale, allegati, firma/presentazione e writer specifici; nessuna prova dell'ultimo passo reale |

I [casi contrattuali](./casi-contrattuali.md) precisano per ogni procedura input inventati, successo, sospensione/ripresa e negativi specifici. I test comuni esercitano codice del servizio esistente, con adapter HTTP simulato. Non sono implementazioni farmaceutiche, Protesica o INPS; non provano quei cataloghi, allegati o writer. I vuoti specifici sopra sono lavoro tecnico ancora necessario, non decisioni che si possono sanare accettando l'ADR.

## Cosa dimostra la verticale

| Confine | Prova | Limite |
| --- | --- | --- |
| Identità, contenuto, pratica e autorità | `service.test.ts`, `approval-expiry.test.ts`, `review-regressions.test.ts`, `vertical.test.ts`: scambio client/sessione, replay, scadenze, fonti cambiate, nuova revisione, input umano | Helper nativo sostituito nei test; nessun gesto biometrico attestato |
| Uscite osservabili | `protocol.test.ts`: processo MCP reale, content/structuredContent, metadati, stderr/IPC/log, sentinelle inventate anagrafiche e cliniche | Nessuna prova interna al provider o di un desktop ordinario con strumenti generici |
| Browser e contenuti ostili | `vertical.test.ts`: proxy senza inoltro, canali browser, frame/shadow, AX/CSS, censimento unico, token monouso e snapshot | Profilo Chromium del simulatore; nessun isolamento universale OS |
| Effetto ed esito | `vertical.test.ts`: timeout, crash/riapertura, atto manuale, risposta tardiva, parti mancanti, HMAC, writer transazionale e rollback audit | Ricevuta del destinatario inventato; nessuna ricevuta istituzionale |
| Pacchetto disattivato | Servizio comune più verticale: rete bloccata anche per riconciliare, writer specialistico negato, stato persistente, nuova autorità dopo riattivazione | Gli altri writer di procedura non sono esercitati |
| Sensibilità dei negativi | Falsificazioni per classe già riportate in #715; timer con sospensione rimossa rosso in #719 | Evidenza storica delle revisioni citate; il modello TLC non include browser, OS o Touch ID |

## Decisione breve

La [procedura per Leonardo](./accettazione-leonardo.md) usa un harness che conta invii e registrazioni e richiede osservazione esplicita di Touch ID. L'helper usa `deviceOwnerAuthentication`: anche la password può produrre successo. La sola stringa `approved`, l'uscita 0 o la CI non attestano la biometria.

Accettare CU-1 significa valutare la verticale sintetica e i suoi limiti, lasciando registrate le mancanze degli altri contratti. Non abilita modalità 2 reale, portali istituzionali, qualifica SISS o uso clinico; non chiude automaticamente l'intero filone CU della 0.9.1. Questo contributo non modifica lo stato dell'ADR e non registra una decisione per conto di Leonardo.

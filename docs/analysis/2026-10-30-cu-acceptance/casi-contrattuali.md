# Casi sintetici delle cinque procedure

Questi esempi fissano input, risultato atteso e motivo di sospensione dei contratti del 23 ottobre. Sono specifiche di accettazione, non risultati di adapter assenti. Nessun codice o titolo inventato è valido su un servizio reale. Identità comune: assistito `demo-patient`, medico `demo-physician`, pratica `demo-practice`. Fonti e cataloghi sono locali, versione `demo-v1`; ogni valore viene dal medico o dalla fonte inventata esplicitamente indicata. Nessuna decisione deriva dal modello.

## Specialistica

Decisione: prestazione `DEMO.01`, descrizione «Prestazione inventata», quantità 2, unità prestazione, priorità D, primo accesso, quesito «Controllo inventato», titolo `DEMO-E` valido per `DEMO.01`. Il caso riuscito conserva tutti i valori, correla ricevuta e singola riga e registra con audit. Il caso di sospensione attende un documento, poi riprende la stessa pratica con nuova autorità e rilettura. L'adapter specialistico esercita realmente questo percorso sul portale inventato.

Negativi: titolo appartenente ad altro assistito, scaduto, futuro o non applicabile; catalogo scaduto; quantità frazionaria o unità diversa; codice e descrizione discordanti; nuovo campo; modifica del quesito dopo l'approvazione. Devono impedire l'atto. Una risposta mancante o parziale dopo l'atto resta incerta: riconciliare, mai reinviare.

## Farmaceutica

Decisione inventata: AIC `DEMO-AIC`, confezione `DEMO-CONF`, descrizione «Farmaco inventato», dose `0,5 mg`, posologia «Una unità inventata al giorno», 2 confezioni, nota `DEMO-NOTA`, piano `DEMO-PT-v1`, esenzione `DEMO-E`. Non sostituibilità e motivazione sono dichiarazioni esplicite del medico. Il risultato atteso conserva virgola, unità, confezione e dichiarazioni; la ricevuta deve correlare ogni ricetta separata.

| Caso | Risultato atteso |
| --- | --- |
| Catalogo e decisione concordi, ricevuta completa | Solo i farmaci decisi sono confermati |
| Attesa del piano terapeutico | Sospensione; ripresa della stessa bozza dopo nuova verifica |
| AIC e descrizione discordanti, confezione assente o nota non verificata | Nessun atto; risoluzione locale |
| Proposta di equivalenza o sostituzione | Nuova decisione del medico, nessuna normalizzazione automatica |
| `0,5 mg` trasformato in `5 mg` o terapia preesistente senza decisione di rinnovo | Nessun atto |
| Una ricetta confermata e una senza ricevuta | Esito parziale esplicito; non ripetere la confermata |

Il test comune trasporta esattamente i campi AIC/dose/confezioni/sostituibilità. Non valida cataloghi AIFA, posologia, equivalenze o ricevute farmaceutiche: manca l'adapter sintetico specifico.

## Protesica

Decisione inventata: ausilio `DEMO-ISO`, descrizione «Ausilio inventato», quantità 1, misura `12,5 cm`, accessorio `DEMO-ACC`, diagnosi e motivazione approvate, scheda tecnica e modello 03 inventati versione 1. L'atto autorizzato è soltanto inserimento. La ricevuta `INSERITA` completa quell'atto, conservando distinti autorizzazione, consegna e collaudo.

| Caso | Risultato atteso |
| --- | --- |
| Inserimento con allegati selezionati e riletti | Ricevuta del solo inserimento, nessuna dichiarazione di fornitura |
| Misura o scheda mancante | Sospensione, poi stessa pratica con allegati riletti |
| Pratica già esistente | Riconciliazione prima di ogni inserimento |
| Ruolo non abilitato all'atto successivo | Arresto, nessuna autorizzazione attribuita al medico |
| Stato `INSERITA` oppure indicatore collaudo `NO` | Non attestare autorizzazione, consegna o collaudo |
| Allegato diverso dalla versione approvata | Nuova revisione, nessun atto con il vecchio grant |

Il test comune conserva codice/misura/riferimento allegato/atto. Non esegue upload né interpreta gli stati Protesica: manca l'adapter sintetico specifico.

## Esenzioni

Titolo inventato `DEMO-E` dell'assistito locale, fonte `DEMO-TITOLO-v1`, valido all'istante della revisione. Atto contenitore `DEMO-RICETTA` con due righe: `DEMO.01` pertinente, `DEMO.02` non pertinente. Il risultato contrattuale atteso applica il titolo solo alla prima riga e conferma tramite la ricevuta dell'atto contenitore. Non esiste una ricevuta autonoma dell'esenzione.

| Caso | Risultato atteso |
| --- | --- |
| Titolo valido e pertinente a tutte le righe | Rilettura e atto contenitore confermato |
| Titolo valido ma non pertinente | Rifiuto prima dell'atto |
| Titolo scaduto, futuro o di altro assistito | Rifiuto prima dell'atto |
| Titolo dubbio o fonte non aggiornata | Sospensione; stessa pratica dopo chiarimento |
| Applicazione mista | Solo la riga pertinente può ricevere il titolo; vietata l'estensione all'altra |

L'adapter specialistico attuale ha un solo titolo per piano: rifiuta l'intero piano misto. Il nuovo test prova questo rifiuto e il successo quando entrambe le righe sono pertinenti. Non prova la compilazione selettiva mista richiesta dal contratto. Quel caso resta mancante; non si divide automaticamente la prescrizione per aggirare il limite.

## Introduttivo INPS

Decisione inventata: ramo `DEMO-TERRITORIO-v1`, assistito locale, recapito documentato inventato, anamnesi/obiettività/diagnosi integrali, codice `DEMO-ICD`, dichiarazioni approvate e PDF inventato versione 1. Pacchetto Italia, senza dipendenza Lombardia. Firma e presentazione sono atti distinti dall'upload.

| Caso | Risultato atteso |
| --- | --- |
| Ramo e ruolo verificati, presentazione e ricevuta correlate | Conferma del certificato esatto, non della domanda amministrativa |
| Attesa di referto | Bozza sospesa, ricercata e riletta dopo il nuovo accesso |
| Ramo territoriale o decorrenza incerti | Nessun atto; chiarimento locale |
| Testo/allegato oltre i limiti del contratto sintetico scelto | Sospensione, nessun troncamento o alterazione dell'originale |
| Pulsante “Invia” relativo all'allegato o solo numero Domus | Nessuna conferma di presentazione |
| Firma assente, ricevuta parziale o non correlabile | Esito incerto; riconciliazione prima di nuovi atti |

Il test comune usa il solo pacchetto Italia e conserva ramo/diagnosi/riferimento allegato/atto. Non valida regole territoriali INPS, firma o PDF e non qualifica i limiti storici: manca l'adapter sintetico specifico.

## Casi comuni eseguiti per ogni contratto

`lib/local-operation/procedure-contracts.test.ts` esercita il servizio reale con adapter HTTP simulato: contenuto esatto, sospensione/riavvio/ripresa, attesa manuale senza atto automatico, ricevuta assente e parziale rifiutata, riconciliazione senza duplicato, disattivazione prima e dopo l'effetto, blocco del traffico anche in background, audit invariato durante il blocco, persistenza dopo riavvio, riattivazione esplicita senza riuso del grant. La ricevuta parziale alterata è anche priva di firma valida: il test attesta il rifiuto, non isola la sola completezza delle parti. I controlli separati di completezza restano nella suite del servizio.

La fixture comune non ha writer territoriali specifici: l'invarianza del suo audit non prova quei writer. La verticale specialistica esercita invece il writer e il rollback reali su SQLite sintetico. Per le altre procedure restano da implementare e provare i writer specifici, le validazioni delle tabelle sopra e i relativi adapter; la copertura comune non li sostituisce.

# ADR 0170: Punti di innesto dei servizi territoriali

Data: 2026-10-29. Stato: **Proposed**, accettazione riservata a Leonardo.
Riferimenti: [WUL-764](https://linear.app/wulfgardr/issue/WUL-764),
[WUL-760](https://linear.app/wulfgardr/issue/WUL-760),
[WUL-587](https://linear.app/wulfgardr/issue/WUL-587).

## Scopo e decisioni acquisite

Addendum a [0158](0158-territorial-packs.md), che resta Accepted: non ridefinisce
strati, attivazione per installazione, conservazione, restore o autorità host.
Propone il contratto descrittivo dei servizi che vi si aggiungono. Nessun adapter
è implementato da questo documento.

Il [commento di Leonardo del 29 ottobre](https://linear.app/wulfgardr/issue/WUL-764)
fissa Italia generico come prova nazionale senza servizi regionali, stesso
repository finché il modulo è uno e scelta Ente/Software House ancora aperta.
Per ora solo handover al portale e scheletro sintetico, senza integrazione
diretta, richieste di accesso o prove istituzionali.

## Contratto comune proposto

Un punto di innesto è un confine applicativo, non un endpoint regionale.
Il nucleo conosce identificativi, versioni e contenitori; profilo nazionale e
modulo territoriale forniscono regole e mapping, senza import inversi nel nucleo.
Ogni operazione dichiara schema di ingresso e uscita, versione del contratto,
precondizioni, autorità, destinazioni e mapping degli esiti della fonte.

L'involucro locale comprende `operationId`, `contractVersion`, `moduleId`,
`serviceId`, `correlationId`, riferimento alla pratica, versione dei dati,
revisione delle capacità territoriali e riferimento locale alla sessione.
Identità, credenziali e contenuto rimangono nei servizi fidati: il manifesto
pubblico non contiene valori di pazienti, segreti o tipi del database.
Il chiamante non si attribuisce il ruolo dichiarandolo nell'ingresso.

Esiti comuni proposti, applicabili a tutti i punti della tabella:

| Stato | Significato e comportamento |
| --- | --- |
| `prepared` | Dati validati localmente; nessun effetto remoto. |
| `handover_required` | Occorre l'azione nel portale; apertura e copia non provano l'atto. |
| `pending` | Richiesta accettata per elaborazione, conclusione ancora assente. |
| `confirmed` | Evidenza finale correlata a operazione, soggetto e contenuto; distinta dal solo HTTP 200. |
| `partial` | Esiti per elemento, parti confermate e residue separate. |
| `rejected` | Rifiuto applicativo esplicito, con codice originale e mapping versionato. |
| `denied` | Autorità o prerequisito mancante; nessun nuovo atto. |
| `conflict` | Versione concorrente o contesto cambiato, serve nuova revisione. |
| `unavailable` | Servizio indisponibile; dichiara separatamente se l'assenza di effetto è provata. |
| `uncertain` | Effetto possibile, evidenza insufficiente: riconciliare prima di reinviare. |
| `suspended` | Pacchetto disattivo, contratto non coperto o autorità revocata. |
| `cancelled` | Tentativo locale annullato prima dell'effetto; non equivale ad annullo istituzionale. |

Ogni operazione restringe gli stati ammessi; non inventa una corrispondenza
quando lo stato regionale è non documentato. `confirmed` per una ricerca
significa ricerca conclusa, non attestazione dell'intera storia clinica.
Rettifica e annullo istituzionali sono operazioni autonome con propria ricevuta.
Retry solo se l'assenza di effetto o l'idempotenza sono documentate per quel
metodo. L'esito incerto non eredita il retry transiente di ADR 0025.

## Nove punti e contratti

Tutti usano l'involucro e gli esiti comuni sopra, con queste restrizioni.
I nomi seguenti sono proposti, non nuove API già disponibili.

| Punto | Operazioni | Ingresso specifico minimo | Uscita specifica | Stati ammessi |
| --- | --- | --- | --- | --- |
| `operator-identity` | acquisire/verificare contesto, rinnovare, revocare | Riferimento a identità locale, finalità, ruolo/struttura richiesti, ambiente | Contesto verificato con ruolo/struttura, ambiti, validità e riferimento opaco alla credenziale locale | prepared, handover_required, pending, confirmed, rejected, denied, conflict, unavailable, uncertain, suspended, cancelled |
| `patient-identity` | identificare, confrontare, verificare esenzioni | Riferimento assistito locale, identificatori ammessi dal profilo, finalità e versione anagrafica | Corrispondenze e provenienza/versione, discrepanze, esenzioni con validità; nessuna fusione automatica | prepared, pending, confirmed, partial, rejected, denied, conflict, unavailable, uncertain, suspended, cancelled |
| `catalogues` | elencare versioni, acquisire, validare, risolvere codice | Sistema di codifica, versione/data, ambito, licenza applicabile | Snapshot con fonte/hash, validità, mapping e lacune; nessuna reinterpretazione dello storico | prepared, pending, confirmed, partial, rejected, denied, conflict, unavailable, uncertain, suspended, cancelled |
| `prescribing` | preparare, consegnare, verificare esito, rettificare/annullare se documentato | Assistito e operatore verificati, ordine revisionato, codici/versioni, struttura, pratica/idempotenza dove ammessa | Identificativi prescrizione, esiti per elemento, promemoria e ricevute locali correlate | Tutti gli stati comuni |
| `certification` | preparare, emettere, ricercare, ristampare, rettificare, annullare se documentato | Tipo certificato, ruolo/struttura, assistito, contenuto revisionato, protocollo originale per variazioni | Protocollo originale/nuovo/annullo distinti, ricevuta, documento e attestato separati | Tutti gli stati comuni |
| `documents-record` | indicizzare, recuperare, validare, pubblicare, aggiornare metadati secondo scenario | Identità, finalità/consenso dove richiesto, tipo/profilo/versione, documento e metadati, firma se richiesta | Indice o byte/hash originali e allegati, rapporto validazione, identificativi ed esito pubblicazione distinti | Tutti gli stati comuni |
| `care-management` | consultare/trasmettere piano, eventi e prestazioni secondo scenario | Assegnazione, piano e versione, ruoli, messaggio correlato, profili ufficiali | Piano/esito messaggio e prestazioni, ricevute e stato per elemento | Tutti gli stati comuni |
| `mandatory-flows` | preparare lotto, trasmettere, aggiornare/cancellare logicamente, riconciliare | Obbligo e soggetto responsabile documentati, periodo, eventi con ID/versione, tracciato | Esiti per evento, acquisizione, consolidamento ed esito finale separati | Tutti gli stati comuni |
| `qualification` | censire requisito, registrare prova/verdetto, sospendere/revocare | Servizio/operazione, build/configurazione, ambiente, fonte del requisito, evidenza e decisore | Ambito e durata del verdetto, lacune, condizioni e revoche; nessun accesso concesso dalla sola registrazione | prepared, pending, confirmed, partial, rejected, denied, conflict, unavailable, uncertain, suspended, cancelled |

## Formato del manifesto di modulo

Proposta di schema chiuso `mediflow.territorial-module.v1`, separato da
`mediflow.territorial-packs.v1`. Campi obbligatori:

| Campo | Contenuto |
| --- | --- |
| `schemaVersion`, `moduleId`, `version`, `layer` | Versione schema e modulo; layer `national` o `territorial`. |
| `requires` | Versioni compatibili del contratto nucleo e moduli necessari. Lombardia richiede Italia. |
| `sources` | Riferimenti con codice, versione, data, pagine e copertura; nessun originale riservato. |
| `contributions` | Riferimenti ai contributi previsti da 0158, senza abilitarli. |
| `services` | Elenco chiuso di servizi con ID stabile, versione, punti di innesto e operazioni. |
| `services[].operations` | ID, schema ingresso/uscita, stati ammessi, mapping fonte, precondizioni, modalità di accesso, idempotenza/riconciliazione, classi dati e policy di audit/ricevuta. |
| `services[].evidence` | Stato della scala sotto, fonte/prova, revisione/build, ambiente, ambito per ruolo e modalità, data, responsabile e limiti. |
| `services[].capabilityRefs` | ID e versione delle voci WUL-587; nessuna concessione di autorità. |
| `gaps` | Lacune con effetto sul servizio, fonte mancante, domanda e owner. |

Una modalità è `application-api`, `context-launch`, `browser-handover` oppure
`embedded-ui`; ciascuna dichiara `documentata`, `da confermare`,
`non disponibile` o `fuori perimetro`, con fonte e ambito. Non documentato
si registra esplicitamente come motivazione di `da confermare`.
L'assenza di un campo obbligatorio rende il manifesto invalido, senza ripiego
sulla Lombardia. Questo è un requisito proposto, non un parser implementato.

## Scala dell'evidenza per servizio

| Stato | Evidenza necessaria |
| --- | --- |
| documentato | Operazioni descritte con fonti versionate e lacune esplicite; non implica contratto completo. |
| simulato | Fixture sintetiche e casi negativi eseguiti sulla revisione identificata. |
| provato in ambiente autorizzato | Autorizzazione e prova ufficiale per servizio, ruolo, modalità e build identificati. |
| in pilota | Perimetro, responsabili e autorizzazione del pilota, con esiti osservati. |
| ammesso | Decisione competente esplicita, condizioni, scadenza e ambito di produzione. |

Lo stato è per operazione/ruolo/modalità/build: il riepilogo di servizio non
può promuovere parti prive di prova. Una nuova versione o revoca può sospendere
l'applicabilità dell'evidenza; non cancella la storia. La scala non coincide
con `ready`, con l'attivazione del pacchetto o con l'esito di una chiamata.
Nessun servizio lombardo è promosso da questa sola ricerca oltre documentato.

## Raccordo con WUL-587

Il manifesto delle capacità resta descrittivo. Ogni capacità riferisce
`moduleId`, `serviceId`, `extensionPoint`, `operationId`, versioni e prove.
Conserva tutti i campi richiesti da WUL-587: dominio; query/comando e ciclo di
vita; autorizzazione/classi dati; attualità/conflitti; conferma; idempotenza;
audit/ricevuta; offline; idoneità all'uscita AI; coorte di migrazione.
Incrocia superficie, piattaforma, modalità deterministica/locale/cloud e
profilo core/Italia/Lombardia; modalità di accesso al servizio è un asse
ulteriore, distinto dalla modalità di esecuzione.

Esempio descrittivo: `lom.prreg.handover` riferisce `prescribing`, query di
preparazione e comando di consegna, profilo Lombardia con Italia, audit della
sola apertura, nessuna ricevuta prescrittiva dedotta. Le superfici senza
supporto hanno sospensione nominata, non una falsa equivalenza con quelle
supportate. Offline si può preparare localmente, non dichiarare emissione.
La classe AI non concede uscita di contenuto clinico o identificativi.
L'autorità continua a essere verificata dall'host sullo stato corrente.

## Confronto statico con il codice

Base letta: `4e094f182` di `origin/main`, 29 ottobre 2026. Nessuna prova runtime
in questa unità documentale.

| Codice esistente | Coerenza e differenza rispetto alla proposta |
| --- | --- |
| `lib/territorial-pack-contract.ts` | Schema v1, preset core/core+it/core+it+lom, revisione e ready/configuration_error già esistono. Non contiene servizi, punti di innesto o scala evidenze. Il nuovo schema resta separato. |
| `lib/territorial-packs.ts` | Parsing strict dei comandi, confirmed=true ed expectedRevision, errori input_invalid/configuration_error/conflict/channel_denied/pack_disabled. Non aggiungere campi del manifesto a questi comandi. Gli esiti di servizio proposti non sostituiscono tali errori. |
| `lib/territorial-pack-host.ts`, `lib/territorial-pack-store.ts` | Owner, sessione Web corrente, generazione archivio, transizione/audit host. Il manifesto non offre un canale di attivazione alternativo. |
| `lib/territorial-pack-http.ts`, `lib/territorial-pack-production.ts` | Proiezione HTTP e composizione owner esistenti; non sono discovery di operazioni regionali. |
| `lib/siss-adapter.ts`, ADR 0025 | Contratto locale e handover, non connettore istituzionale qualificato; taxonomy locale da mappare senza perdere il codice fonte o l'incertezza di un atto futuro. |

Le differenze sono lavoro futuro di contratto/implementazione, non difetti
corretti qui. Nessuna estensione modifica il ciclo di vita accettato in 0158.
[0045](0045-siss-native-integration-boundary-requires-qualified-ssi.md)
continua a governare il salto oltre handover;
[0049](0049-siss-fse-document-corpus-and-local-mcp-layer.md) vieta di confondere
repository e corpus; [0162](0162-local-computer-use-executor.md) resta Proposed.
Il manifesto CU e quello di modulo hanno scopi diversi e si riferiscono allo
stesso servizio senza trasferirsi autorità. A pacchetto disattivo niente rete,
anche per riconciliare, né writer territoriali; restano evidenze locali.

## Prova documentale e limiti

La [mappa lombarda](../territorial/lombardia-services-and-prerequisites.md)
colloca le dodici schede e registra le lacune. La
[prova Italia generico](../territorial/italia-generico-paper-test.md)
usa gli stessi punti senza PRREG, Carta SISS o ruoli regionali nel nucleo.
La [lettera](../territorial/aria-letter-draft.md) resta bozza non inviata.
Accettazione dell'ADR, ammissione istituzionale e chiusura delle due issue
restano decisioni distinte. Questo documento non chiude il gate Moduli e SISS
né la release 0.9.1.

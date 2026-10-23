# CU — contratti delle procedure

Data: 23 ottobre 2026. Autore: Astra. Stato: **proposti, non implementati**. [Analisi](./2026-10-23-computer-use-procedures.md), [fonti/versioni](./2026-10-23-computer-use-sources.md), [ADR 0162](../adr/0162-local-computer-use-executor.md). Tutti gli esempi futuri di sviluppo devono essere inventati e separati dall'archivio clinico. Nessuna specifica qui autorizza l'uso del servizio reale.

## Contratto comune

Il manifest locale identifica `procedureId`, versione del contratto, territorio/capacità, ruolo ammesso, fonte e revisione, adapter e fingerprint della UI, cataloghi e validità, destinazioni ammesse, campi/classificazione, trasformazioni consentite, stati del servizio, prova di autorizzazione e riconciliazione. Questi dettagli restano locali in modalità 1: il protocollo remoto non espone il nome della procedura.

Ogni valore conserva origine (dato strutturato/versione, documento autorizzato/pagina oppure indicazione esplicita del medico), unità e trasformazione. La normalizzazione non cambia dose, misura, priorità, significato o dichiarazione. Un dato assente resta un requisito da risolvere localmente. Per ogni campo si definiscono obbligatorietà condizionale, dominio, confronto dopo inserimento e comportamento in caso di errore. Campo nuovo o UI sconosciuta: sospensione, nessuna uscita grezza.

Prerequisiti comuni: operatore autenticato nel flusso nativo previsto; ruolo del portale compatibile; paziente risolto localmente; pratica esistente riconciliata prima di crearne una; capacità territoriale corrente; catalogo e fonte applicabili; piano clinico già deciso. Identità e pratica sul portale vanno verificate prima della compilazione e immediatamente prima dell'atto. Se identità alternativa a codice fiscale (es. STP) non è gestita dal contratto, sospendere invece di inventare un codice.

L'autorizzazione del medico è locale e vincolata a contenuto esatto, paziente, pratica, destinazione e singolo atto. Una autorizzazione può coprire i clic materiali del piano senza conferma ripetuta a ogni campo; non comprende cambi clinici o una successiva firma distinta richiesta dal servizio. Login, PIN, OTP, Touch ID, certificati e segreti non transitano nella chat.

Sospensione per scelta e impossibilità tecnica sono motivi separati. Per riprendere: aprire la stessa pratica, rileggere stato e contenuto, confrontare fonti/capacità/catalogo, acquisire nuova autorità di sessione e, se necessario, nuova autorizzazione all'atto. Un tentativo incerto non torna a “pronta da inviare”: prima si riconcilia. Identificativo della pratica, salvataggio e ricevuta finale sono tre evidenze diverse. L'esito locale viene scritto dai servizi MediFlow con audit; l'adapter non accede al database.

## 1. Specialistica PRREG — prima verticale

**Fonti/versione:** specifica PRREG rev. 1.4 e delta 1.5 descritti nel registro; catalogo specialistico pertinente da versionare. Stato documentato; prima prova su portale sintetico, non replica dichiarata della UI istituzionale corrente. Pacchetto Italia + Lombardia; ruolo prescritto dal contratto della modalità GUI, senza deduzione di diritti WS.

| Gruppo | Campi e controlli |
| --- | --- |
| Identità/contesto | Identità assistito e identificativo ammesso, operatore/struttura, pratica e tipo specialistico. Confronto locale con il contesto attivo del portale, non solo con una testata visiva. |
| Decisione | Prestazioni già scelte, codice e descrizione del catalogo, quantità, quesito diagnostico, eventuale codice diagnosi, priorità e tipo accesso. Coerenza codice/descrizione, unità e indicazione esplicita; nessuna prestazione ricavata dal web. |
| Regime/esenzione | Regime, titolo di esenzione verificato, validità e relazione con ogni prestazione. Titolo presente non significa prestazione esente. Mancanza del dato o conflitto: revisione locale. |
| Tempi | Tempistica clinica se richiesta dal ramo; la specifica storica distingue primo/altro accesso. Limiti storici del quesito (256 caratteri) o tempistica non diventano regole della UI corrente senza verifica. Nessun troncamento silenzioso. |
| Esito | Rilettura di tutti i campi e riepilogo locale; risposta del servizio, documenti/ricevute e correlazione alle singole prestazioni se divise. NRE/IUP non vengono inventati o usati da soli come prova dell'intero risultato. |

**Autorizzazione:** dopo la rilettura e prima dell'atto di emissione/presentazione previsto dal contratto; legata al piano esatto. Un successivo cambio del quesito, priorità, esenzione o elenco prestazioni la invalida.

**Sospensione/ripresa:** volontà del paziente, attesa documenti, titolo dubbio, errore di identità, ruolo/capacità, catalogo o UI, intervento medico, sessione scaduta. Conservare la stessa pratica e distinguere bozza locale da bozza salvata e riletta nel portale.

**Completamento:** tutte le righe autorizzate risultano confermate dal destinatario simulato con ricevuta correlata e registrazione locale. `OK` tecnico può riferirsi a una bozza o a una modalità in deroga: non basta. Omissione di una prescrizione nella risposta o timeout richiede riconciliazione; una riga riuscita non completa le altre. Ordinamento/progressivi del servizio non sono correlazioni sufficienti se la risposta divide o riordina le prestazioni.

**Accettazione CU-1:** fixture con quesito ed esenzione già decisi; almeno una esenzione non applicabile rifiutata; acquisizione identità esclusivamente locale; invio autorizzato e ricevuta simulata; sentinelle anagrafiche e cliniche assenti da ogni uscita censita; recupero dopo effetto remoto ma prima della ricevuta senza secondo invio. Le prove negative comuni dell'ADR sono parte della stessa verticale.

## 2. Farmaceutica PRREG

**Fonti/versione:** medesima famiglia PRREG; cataloghi farmaceutici e condizioni AIFA da fissare per data e confezione. Italia + Lombardia, ruolo e canale verificati. Non basta riutilizzare il form specialistico.

**Campi:** identità/operatore/pratica; farmaco già deciso; codice AIC o gruppo equivalente secondo il ramo ammesso, descrizione, forma, dosaggio/unità, posologia se prevista, quantità/confezioni, tipo prescrizione, note AIFA/piano terapeutico ove pertinenti, eventuale non sostituibilità e motivazione indicate dal medico, esenzione applicabile. Codice e descrizione devono concordare con il catalogo; equivalenze e sostituzioni sono decisioni da confermare, non normalizzazioni. Preservare segni decimali e unità; dati clinici necessari ma mancanti bloccano.

**Autorizzazione:** riepilogo locale dei farmaci esatti e dei vincoli prima dell'atto. Il fatto che una terapia esista in cartella non autorizza automaticamente rinnovo o trasmissione.

**Sospensione/ripresa:** scelta del paziente, attesa piano/documenti, catalogo o confezione non risolta, titolo esenzione incoerente, indisponibilità/cambio del farmaco, modifica medica, identità o sessione variata. Riprendere la stessa bozza dopo rilettura e nuova verifica del catalogo; mai sostituire per sbloccare.

**Completamento:** ricevuta simulata corrispondente a farmaci, quantità e atti autorizzati; correlazione delle eventuali ricette separate, stato parziale esplicito, riconciliazione prima di ripetere. Conferma del destinatario distinta dal salvataggio di una terapia nel servizio MediFlow. Questo contratto non modifica la priorità della prima scrittura CHAT stabilita in ADR 0160.

## 3. Protesica-RL

**Fonti/versione:** conoscenza procedurale depurata e documenti regionali censiti; versione UI, catalogo e modulistica corrente da qualificare. Italia + Lombardia; ruolo abilitato alla specifica prescrizione/pratica, non presunto dalla sola autenticazione.

**Campi:** assistito e pratica, prescrittore/struttura, diagnosi e motivazione clinica già approvate, dispositivo/ausilio con codice pertinente (incluso ISO dove richiesto), descrizione, quantità/misure, eventuali accessori e condizioni, documenti prescrittivi, scheda tecnica e modello 03 ove applicabili. Allegati selezionati localmente, tipo e contenuto verificati, originali conservati. Non ricavare misure o indicazioni dalla mera disponibilità del catalogo.

**Autorizzazione:** distinta per inserimento/presentazione della pratica e per eventuali atti successivi del ruolo competente. L'autorizzazione alla fornitura non è attribuita al medico da un clic dell'assistente; un collaudo richiede evidenza e responsabilità proprie.

**Sospensione/ripresa:** attesa documenti, diversa volontà del paziente, necessità di misure/chiarimenti, titolo o ruolo non valido, pratica già esistente, stato del servizio incompatibile. Conservare motivazione locale e identificativo della stessa pratica; rileggere stato e allegati prima di riprendere, senza nuovo inserimento duplicato.

**Completamento:** prova simulata del solo atto autorizzato con stato specifico. `INSERITA` non significa autorizzata, consegnata o collaudata. Un indicatore di collaudo “NO” non prova un collaudo svolto. Modellare separatamente inserimento, autorizzazione, fornitura/consegna e collaudo, anche quando il workflow richiesto si ferma al primo.

## 4. Applicazione delle esenzioni

**Fonti/versione:** regola nazionale con atto e decorrenza, catalogo pertinente, titolo personale verificato e adapter regionale concreto. Prima applicazione nel contratto PRREG; un eventuale altro portale necessita di manifest proprio con gestore e competenza. Questo contratto applica un titolo esistente: non lo riconosce, rinnova o autocertifica.

**Campi:** identità locale, titolo/codice e fonte, validità temporale, ambito soggettivo e territoriale, prestazioni/codici a cui applicarlo, motivo dell'applicabilità e contesto della ricetta. Per esenzioni per patologia/reddito o altri titoli usare le regole effettivamente pertinenti, senza estendere categorie o dedurre dichiarazioni economiche. Verifica riga per riga con risultato motivato locale.

**Autorizzazione:** il medico rivede l'applicazione nel riepilogo dell'atto che la usa. Una verifica amministrativa esterna non conferisce all'assistente potere di attestare fatti mancanti. Se cambia il titolo o il suo ambito, nuova revisione dell'atto.

**Sospensione/ripresa:** scadenza, fonte non aggiornata, prestazione non compresa, conflitto fra titolo registrato e servizio, dichiarazione/documento mancante; oppure scelta del paziente. Riprendere la stessa prescrizione/pratica dopo chiarimento, senza creare una nuova esenzione.

**Completamento:** le sole righe pertinenti riportano l'esenzione attesa dopo rilettura; il salvataggio è distinguibile dalla conferma dell'atto contenitore. Nessuna ricevuta autonoma inventata se il servizio non la produce. Fixture obbligatorie: titolo valido ma non pertinente, titolo scaduto, applicazione mista su più prestazioni.

## 5. Certificato medico introduttivo INPS

**Fonti/versione:** scheda INPS aggiornata il 26 maggio 2026 e procedura osservata il 10 settembre 2026, depurata. Il ramo si sceglie con regole versionate per territorio, decorrenza e situazione del richiedente; residenza/domicilio e condizioni speciali vanno verificati. L'osservazione storica non esaurisce i rami. Pacchetto Italia; non richiede Lombardia solo perché il primo caso sintetico vi è ambientato.

**Prerequisiti:** ruolo di medico certificatore ammesso, decisioni e dichiarazioni documentate, instradamento verificato. Certificato introduttivo per invalidità/disabilità distinto da certificato di malattia e dagli ulteriori atti amministrativi della domanda. Non promettere che il medesimo certificato abbia identico effetto amministrativo in tutti i rami della riforma.

**Campi:** identità e recapiti documentati, eventuale rappresentanza solo quando prevista e verificata, anamnesi/obiettività/diagnosi e codici pertinenti, dichiarazioni mediche esplicitamente confermate, documentazione allegata e riepilogo. La procedura storica osservava tre testi entro 1.000 caratteri, fino a cinque codici ICD-9-CM e PDF entro 2 MiB: sono limiti da verificare sulla UI/ramo attuali, non vincoli già qualificati. Non troncare testi o ricostruire contatti mascherati; firma e originali non si alterano per adattarli all'upload.

**Autorizzazione:** revisione locale delle dichiarazioni e degli allegati, quindi prova per la specifica firma/presentazione; la firma deve seguire il flusso previsto dal servizio. La scelta di formato o tipo di firma non viene dedotta dalla presenza di un bottone. La fase finale non osservata richiede nuova evidenza prima di qualsiasi qualifica reale.

**Sospensione/ripresa:** attesa referti o scelta del paziente, ramo incerto, dichiarazioni mancanti, sessione terminata, firma non disponibile o UI cambiata. Una bozza salvata va cercata e riletta dopo login; si riprende quella, senza ricrearla. Gli stati osservati `Bozza`, `Presentato`, `Definito`, `Annullato` si conservano come stati del servizio, con fonte e data, non come sinonimi degli stati CU.

**Completamento:** caricamento di un allegato (anche se il pulsante si chiama “Invia”) distinto dalla presentazione del certificato. Un numero di pratica o Domus non è prova della ricevuta finale. Per la verticale simulata: firma/presentazione simulate, ricevuta correlata al certificato approvato e registrazione locale. Per il reale, ultimo passo, ricevuta e criteri di riconciliazione restano da qualificare; senza questi non si dichiara “confermata”.

## Manutenzione e prova dei contratti

Ogni adapter dichiara quali stati/campi sono documentati, simulati e osservati sul client, separandoli dalle qualifiche sul servizio. Una nuova versione di UI o catalogo non abilita il modello a ricostruire selettori o regole: richiede un aggiornamento verificato del contratto. I contratti condividono nucleo, autorizzazione e ricevute; non condividono automaticamente ruoli, destinatari o obblighi clinici. Il corpus di accettazione contiene almeno un caso riuscito e un caso di sospensione/ripresa per ciascuna procedura, più i rischi specifici descritti sopra.

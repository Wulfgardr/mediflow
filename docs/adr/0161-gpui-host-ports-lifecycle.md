# ADR 0161: porte host e lifecycle del client GPUI

Date: 2026-10-23

Status: Accepted — decisione 2, opzione 1, approvata da Leonardo il 23 ottobre 2026

Part of WUL-771; riferimenti WUL-706, ADR 0145 e censimento G-0.

## Contratto e roster

G-1a.1 rende `hostPorts` obbligatorio nella risposta della discovery network
1.14.0, nello schema OpenAPI e nel tipo TypeScript. È una negoziazione di
schema, non una concessione. I vecchi client possono ignorare
il campo; questo client GPUI rifiuta un host che non lo dichiari o abbia una
revisione, uno scope o un'autorità incompatibili. Il protocollo resta 1.14.0:
il campo è additivo, senza nuovi endpoint né cambi delle ammissioni.
Lo schema vincola il roster alle otto combinazioni della revisione 1, ciascuna
presente una sola volta, senza imporre l’ordine. ID, revisioni, scope, autorità
e stati diversi richiedono un’evoluzione esplicita del contratto.

| Porta, revisione 1 | Scope | Autorità richiesta | Ingresso corrente |
| --- | --- | --- | --- |
| clinical | ambulatorio | pairing + operatore + capability corrente | `/api/v1/network/*`: pazienti/profilo, diario, terapie, misure, controlli, scale, allegati, repertori, agenda e analisi |
| account-profile | operatore | sessione dell'operatore, versione e generazione | `/api/auth/profile` |
| ai-preferences | operatore | grant amministrativo esplicito verificato dall'host | `/api/v1/network/ai/functions` e preview; nessuna generazione |
| administrative | operazione | grant amministrativo nominato e step-up | non esposta: archivio, restore, backup, manutenzione, provider/segreti e import amministrativi |
| provider | operazione | servizio nominato e consenso all'uscita separato | non esposta: nessun proxy generico o accesso diretto al provider |
| document-derived | ambulatorio | servizio host nominato con fonti correnti | non esposta: la lettura manuale dell'allegato non abilita estrazione/sintesi |
| voice | operazione | permesso microfono e lifecycle della bozza | non esposta: nessuna cattura o persistenza audio implicita |
| file | file scelto | scelta esplicita del percorso | picker locale, import manuale e copia; nessuna scrittura nell'archivio |

`available` dichiara l'esistenza del contratto; l'elenco capability proiettato
e il controllo autorevole per ogni richiesta conservano l'ammissione effettiva.
`not-exposed` non è un'esclusione dalla 0.9.1: identifica un seguito dipendente
dai contratti delle singole funzioni e dalle unità del censimento. Le famiglie
amministrative non vengono fatte passare attraverso le route cliniche paired. Solo l'host scrive
record e audit; il client non importa SQLite.

Ogni richiesta scoped richiede ancora l'identità nativa esatta, l'ambulatorio
ammesso e `expected-ambulatory-id-v1`. Il cookie non permette il ripiego su un
ambulatorio di default. La generazione dell'archivio accompagna ogni richiesta.

## Lifecycle comune

I `RequestContext` condividono una radice di revoca della sessione. Il contesto
paziente/workspace segue la generazione di selezione della finestra: le copie
in background conservano il vecchio contesto, che il cambio di workspace
cancella. Le richieste account seguono invece la sessione operatore e la
propria generazione, senza dipendere dall’epoch workspace. Il cambio area,
ambulatorio o il refresh AI non cancella una lettura o un salvataggio account;
il blocco o la sostituzione dell’archivio revoca entrambi i contesti.
Le transizioni di presentazione durante conferma/rilettura di una scala conservano il contesto sigillato; la navigazione lo ritira. Il blocco revoca la radice di tutti i contesti della sessione. Non sono token,
capability né grant. La rete usa future cancellabili: il ritiro abbandona la
richiesta HTTP e il body in attesa, senza attendere risposta o timeout remoto.

Un ritiro prima dell'invio impedisce l'operazione; dopo l'avvio del trasporto
una scrittura annullata è indeterminata. Chiudere il trasporto non prova il
rollback del writer host. Nessun retry automatico. `ARCHIVE_REPLACED` e il
diniego di autenticazione ritirano la sessione e le richieste sorelle. Un
semplice `403` di capability resta un diniego della singola operazione.
Se risposta e cancellazione sono entrambe pronte, il trasporto esamina prima
la risposta: un ritiro completato conserva il motivo e raggiunge il lifecycle
di sessione. Gli altri esiti restano soggetti al controllo di cancellazione
dopo il completamento; una scrittura cancellata resta indeterminata.

Quando GET o PUT del profilo account rilevano `ARCHIVE_REPLACED` o una
generazione diversa, il runner account consuma anche il motivo di ritiro
conservato dalla sessione, compreso un risultato corrente indeterminato.
Invoca la disconnessione comune: rimuove sessione, selezione, cache e bozze
non salvabili, revoca l’autorità e scarta i callback della generazione account
precedente. I cloni della vecchia sessione non possono inviare altre richieste.
Questa correzione chiude l’incoerenza introdotta dal ritiro del trasporto in
G-1a.1. G-1a.2 estende il ritiro ai consumer dei risultati annidati e agli
editor trattenuti: il reset account ritira le vecchie entità e ne crea di nuove,
con una generazione di autorità distinta dall’epoch workspace. Un callback
di una vecchia autorità non modifica la nuova sessione o la nuova bozza.
Un segnale di ritiro dell’autorità corrente raggiunge invece la disconnessione
anche se proviene da un workspace già lasciato. Errori di restore nelle
riletture di creazione/modifica non diventano semplici esiti non confermati.
Form ordinari, upload, selettore farmaco annidato e valutazione con tentativo
sigillato seguono lo stesso ritiro; nessun vecchio invio viene riabilitato.

## G-1a.2: punto di non ritorno della copia

La scelta nativa della destinazione precede la lettura del documento. La vista
Documenti avvisa prima della scelta: una copia già avviata può completarsi anche
dopo cambio scheda o blocco. Il client legge e verifica il contenuto; poi
`admit_download` fissa in una struttura consumabile una sola volta il percorso
scelto e i byte verificati. Non accetta percorsi provenienti dal record clinico.

Il punto di non ritorno è **l’ammissione locale riuscita** mediante
`RequestContext::admit_file_effect`, prima dell’apertura del file. Un mutex
condiviso dalla sessione e dalle sue selezioni serializza l’ultimo controllo e
l’ammissione rispetto a cancellazione e revoca. Non attribuisce autorità e non
sostituisce scelta della destinazione o consenso al contenuto. Il mutex viene
rilasciato prima di qualsiasi I/O: un filesystem lento non trattiene il ritiro
della sessione né il thread della UI.

- Ritiro prima dell’ammissione: nessuna apertura o scrittura; il risultato
  clinico e i callback dei picker vengono scartati.
- Ritiro dopo l’ammissione, anche prima dell’apertura effettiva o durante la
  copia: l’unica copia già annunciata può completarsi. Il ritiro non ne dichiara
  il rollback e non aspetta l’I/O.
- Dopo lock/restore/navigazione resta soltanto lo stato tecnico minimo della
  copia ammessa: in corso, completata o fallita. Non contiene percorso,
  identificativi, contenuto, sessione, selezione o autorità e non riapre form.
  Non viene avviata una seconda copia mentre quella ammessa è pendente.

Il successo è mostrato soltanto dopo `write_all` e `sync_all`. L’apertura usa
`create_new` e, su Unix, modalità `0600`: una destinazione preesistente non viene
sovrascritta né rimossa. Un errore può lasciare il **nuovo file parziale**;
l’interfaccia chiede di controllare la destinazione e non riprova, non sceglie
un altro nome e non elimina il file. L’arresto del processo o la chiusura della
finestra non garantiscono completamento né consegna dell’esito; alla riapertura
non c’è recupero o secondo salvataggio automatico. La verifica di ammissione
non è una garanzia contro guasti del filesystem o perdita di alimentazione.

La barriera sintetica fra controllo preliminare e ammissione riproduce
l’interleaving individuato staticamente dal censimento; non attesta un exploit
pregresso. Le prove separano ritiro prima dell’ammissione, completamento dei
byte già ammessi, errore parziale, collisione e notifica minima dopo restore.

## Decisione 2: opzione 1 approvata

Leonardo ha approvato l’opzione 1 il 23 ottobre 2026, come registrato nel
[commento del coordinatore sulla PR 624](https://github.com/Wulfgardr/mediflow/pull/624#issuecomment-6362749364):
porte host nominate, versionate e con scope esplicito. Restano quattro confini
distinti:

- il pairing identifica il dispositivo;
- la sessione identifica l’operatore;
- il grant amministrativo ammette la singola operazione;
- il consenso all’uscita autorizza la specifica destinazione e il payload.

Un token paired non diventa né grant amministrativo né consenso all’uscita.
Le porte non ancora esposte restano dichiarate come tali e non vengono emulate
tramite le API cliniche. Durate, step-up e ricevute si fissano nei contratti
delle singole funzioni. Ripristino, revoca e cambio archivio invalidano le
autorità precedenti. Un account provider o una preferenza AI non equivalgono
a consenso a generare o inviare dati.

L’alternativa del passaggio alla UI trusted dell’host richiederebbe un
emendamento nominato per le funzioni obbligatorie fuori dalla shell GPUI.
L’estensione del token paired a tutte le funzioni resta respinta perché
confonde dispositivo, potere amministrativo e consenso all’uscita.
L’approvazione del contratto non espone nuove porte privilegiate.

## Prove e limiti

Test negativi su discovery/revisioni/scope, identity binding, rete bloccata
prima degli header e durante il body, ritiro di richieste sorelle al restore,
cancellazione di contesto e scrittura dall'esito incerto. Le fixture sono
inventate e i server di prova ascoltano soltanto sul loopback.

Le regressioni G-1a.2 esercitano i costruttori e i callback effettivi dei
form, il ritiro degli editor ancora referenziati, l’upload e il selettore
farmaco annidato, la scala preparata e il tentativo sigillato, oltre ai runner
workspace/account e alle richieste sorelle. Le falsificazioni rimuovono i
vincoli osservabili e devono far fallire le regressioni pertinenti.

Sono prove sintetiche del sorgente e del trasporto, non accettazione del
prodotto installato o dell’ammissione clinica. Non espongono restore o altre
porte amministrative: provano il ritiro quando l’host segnala il cambio
archivio. Accettazione indipendente di G-1a.2, integrazione e qualifica del
bundle restano passaggi distinti. Nessun impatto sul contratto HTTP/OpenAPI.

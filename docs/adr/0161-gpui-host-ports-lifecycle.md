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
G-1a.1; la matrice completa di form ed effetti SEC-3 resta in G-1a.2.

Il contesto è disponibile anche per gli effetti file e viene controllato
prima della copia. **G-1a.1 non chiude SEC-2/3:** G-1a.2 deve fissare il punto
di non ritorno del file, mettere una barriera deterministica tra controllo ed
effetto e verificare il ritiro di tutti i form, callback e risultati annidati.
La finestra tra controllo ed apertura del file non è dichiarata risolta qui.

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

Sono prove del trasporto e del contratto, non accettazione del prodotto
installato, di ogni form o dell'ammissione clinica. G-1a resta incompleta fino
all'accettazione di G-1a.1 e G-1a.2.

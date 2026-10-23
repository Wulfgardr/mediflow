# ADR 0161: porte host e lifecycle del client GPUI

Date: 2026-10-23

Status: Proposed — decisione 2 riservata a Leonardo

Part of WUL-771; riferimenti WUL-706, ADR 0145 e censimento G-0.

## Contratto e roster

G-1a.1 aggiunge `hostPorts` alla discovery network esistente. È una
negoziazione di schema, non una concessione. I vecchi client possono ignorare
il campo; questo client GPUI rifiuta un host che non lo dichiari o abbia una
revisione, uno scope o un'autorità incompatibili. Il protocollo resta 1.14.0:
il campo è additivo, senza nuovi endpoint né cambi delle ammissioni.

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
dalla decisione 2 e dalle unità del censimento. Le famiglie amministrative non
vengono fatte passare attraverso le route cliniche paired. Solo l'host scrive
record e audit; il client non importa SQLite.

Ogni richiesta scoped richiede ancora l'identità nativa esatta, l'ambulatorio
ammesso e `expected-ambulatory-id-v1`. Il cookie non permette il ripiego su un
ambulatorio di default. La generazione dell'archivio accompagna ogni richiesta.

## Lifecycle comune

Un `RequestContext` condiviso vincola le porte alla sessione e alla generazione
di selezione della finestra. Le copie già in background conservano il vecchio
contesto: il cambio di contesto lo cancella e ne crea uno nuovo solo nella shell.
Le transizioni di presentazione durante conferma/rilettura di una scala conservano il contesto sigillato; la navigazione lo ritira. Il blocco revoca la radice di tutti i contesti della sessione. Non sono token,
capability né grant. La rete usa future cancellabili: il ritiro abbandona la
richiesta HTTP e il body in attesa, senza attendere risposta o timeout remoto.

Un ritiro prima dell'invio impedisce l'operazione; dopo l'avvio del trasporto
una scrittura annullata è indeterminata. Chiudere il trasporto non prova il
rollback del writer host. Nessun retry automatico. `ARCHIVE_REPLACED` e il
diniego di autenticazione ritirano la sessione e le richieste sorelle. Un
semplice `403` di capability resta un diniego della singola operazione.

Il contesto è disponibile anche per gli effetti file e viene controllato
prima della copia. **G-1a.1 non chiude SEC-2/3:** G-1a.2 deve fissare il punto
di non ritorno del file, mettere una barriera deterministica tra controllo ed
effetto e verificare il ritiro di tutti i form, callback e risultati annidati.
La finestra tra controllo ed apertura del file non è dichiarata risolta qui.

## Decisione 2: opzioni e raccomandazione

1. **Raccomandata:** porte host nominate con revisione/scope dichiarati;
   pairing identifica il dispositivo, sessione identifica l'operatore,
   grant amministrativo ammette una specifica operazione e consenso
   all'uscita autorizza una specifica destinazione/payload. Durate, rinnovo,
   step-up e ricevute si fissano nei contratti delle unità successive.
   Ripristino, revoca e cambio archivio invalidano le autorità precedenti.
2. Tenere l'amministrazione nella UI trusted dell'host con passaggio esplicito
   e ritorno contestuale. Richiede un emendamento nominato per le funzioni
   obbligatorie che resterebbero fuori dalla shell GPUI.
3. Estendere il token paired a tutte le funzioni: respinta come proposta,
   perché confonde dispositivo, potere amministrativo e consenso all'uscita.

Questa PR propone la prima opzione e prepara la compatibilità; non registra
un'approvazione di Leonardo né abilita nuove porte privilegiate. Un account
provider o una preferenza AI non equivalgono a consenso a generare/inviare.

## Prove e limiti

Test negativi su discovery/revisioni/scope, identity binding, rete bloccata
prima degli header e durante il body, ritiro di richieste sorelle al restore,
cancellazione di contesto e scrittura dall'esito incerto. Le fixture sono
inventate e i server di prova ascoltano soltanto sul loopback.

Sono prove del trasporto e del contratto, non accettazione del prodotto
installato, di ogni form o dell'ammissione clinica. G-1a resta incompleta fino
all'accettazione di G-1a.1 e G-1a.2.

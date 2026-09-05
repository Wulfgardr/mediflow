# ADR 0120: onboarding locale del profilo di lavoro

Date: 2026-09-06
Status: Accepted (lane locale; integrazione del parent separata)

Refs WUL-681, WUL-682. Perimetro: roadmap 0.8.6, sezione 5.

## Problema e opzioni

Occorre orientare il primo utilizzo e consentire un cambio reversibile tra
Interactive, Agent e una combinazione, senza rendere un host AI necessario al
bootstrap. Il setup account/PIN resta governato da ADR 0106; provider e binding
Fabric da ADR 0090; Supervisor, AIP e MCP da ADR 0117.

Un agente esterno imporrebbe un secondo bootstrap, disponibilita del servizio,
eventuali costi e un nuovo confine dati prima che l'app sia utile. Una soluzione
ibrida mantiene queste dipendenze per la parte assistita e aggiunge recupero tra
due proprietari. Le tre domande previste non richiedono inferenza: attivita,
preferenza di interazione e sistema operativo dichiarato sono enum non clinici.

## Decisione

Usare una guida integrata deterministica, dopo il setup di sicurezza e il login.
La preferenza esplicita determina Interactive, Agent o Entrambi. In caso di
incertezza si suggerisce Entrambi per l'organizzazione di attivita ripetitive,
Interactive negli altri casi. Il sistema dichiarato modifica soltanto le note
sui prerequisiti: non e una rilevazione di capability. Non si domanda la
professione e nessuna risposta verifica identita o concede ruoli.

La guida configura soltanto il profilo di lavoro della **postazione**, condiviso
dagli operatori Web come le preferenze UI esistenti, e l'area iniziale del cockpit.
Interactive apre la lista pazienti per il lavoro su cartelle, altrimenti il
turno; Agent apre Sistema e impostazioni; Entrambi apre il turno. I deep-link
espliciti mantengono la propria destinazione. La UI Web resta sempre accessibile.

La preferenza Agent non avvia processi, non collega un host, non abilita modelli,
reti, binding, egress o scritture cliniche. La UI distingue la preferenza salvata
dalla connessione di un agente, che questa guida non verifica. Le impostazioni
Fabric e la diagnostica esistenti restano i percorsi per i relativi proprietari;
non si aggiunge un provider per simulare una raccomandazione AI.

## Persistenza, conferma e recupero

Un unico record versionato `onboarding.workProfile` nella tabella `settings`
contiene bozza non clinica, scelta attiva, precedente scelta e ultimo comando.
Non serve una migrazione. Il servizio dedicato e l'unico writer HTTP: la route
Web richiede la sessione esistente; la route settings generica nega questa chiave
anche al token locale. Nessuna modifica ai contratti auth, native o `/api/v1`.

Ogni avanzamento esplicito salva la bozza; le selezioni non ancora avanzate
restano nel form. Solo una bozza completa in anteprima puo essere confermata.
Conferma, cambio, annullamento della bozza e rollback usano una transazione
SQLite IMMEDIATE e confronto della revisione, evitando sovrascritture fra tab.
La ripetizione dell'ultimo identico comando restituisce il record corrente;
una ripetizione piu vecchia incontra il conflitto di revisione. Riapplicare la
stessa scelta non sostituisce lo storico utile per il rollback.

Una risposta persa richiede rilettura prima di altre mutazioni. La UI conferma
il salvataggio solo dopo la rilettura della revisione. Un record corrotto fallisce
con errore e lascia accessibile la cartella, senza cancellare configurazione.
Il rollback ripristina una sola scelta precedente, anche l'assenza del profilo,
senza toccare account, PIN, chiavi, app, dati clinici o impostazioni di sicurezza.
La bozza si riprende anche dopo riavvio del server, previo normale login.

## Prerequisiti e limiti di piattaforma

| Ambiente | Percorso disponibile nel sorgente | Limite della guida |
| --- | --- | --- |
| macOS | Web Node 24; launcher Mac; Supervisor/MCP; adapter Apple separati | Non prova firma, notarizzazione, installazione indipendente o host collegato |
| Windows | Core Web e Headless Node 24; dipendenze native del pacchetto da preparare | Nessuna shell desktop Windows completa o prova di installazione in questa lane |
| Linux | Core Web e Headless Node 24; dipendenze native del pacchetto da preparare | Nessuna shell desktop Linux completa o prova di installazione in questa lane |

Gli artifact distribuiti, i test Windows/Linux e la connessione a host MCP
esterni richiedono verifiche di piattaforma separate. La sola compatibilita
del browser non le sostituisce. Nessun account Codex, cloud, pagamento o download
e richiesto dalla guida; eventuali servizi opzionali conservano i propri costi
e flussi di consenso. Nessun claim di readiness AI deriva dal profilo.

La proposta visiva esistente e preservata usando componenti e token correnti.
Il wizard di sicurezza conserva soltanto identita e PIN: username/password
separati e scelta di ruolo erano campi ignorati dal setup owner e sono rimossi
dalla UI. Payload, bootstrap amministrativo, cifratura e sessioni non cambiano.
Gli indici globali e le sintesi di release sono integrati dal parent, come
richiesto per questa lane. Verifiche: contratti deterministici, persistenza
SQLite e percorso browser sintetico; la consegna riporta gli esiti realmente
eseguiti e il commit locale, senza promozione a release.

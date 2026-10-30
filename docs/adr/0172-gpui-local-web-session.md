# ADR 0172 — Sessione Web locale del client GPUI

Stato: Proposed. Review indipendente richiesta prima del merge.

## Contesto

La migrazione G-2/G-4 necessita di impostazioni e cancellazione documentale.
Le route Web corrispondenti esistono già: `/api/settings/[key]` e
`/api/attachments/[id]`. Il cookie native paired non è una sessione Web P3 e
non ne acquisisce i permessi. Aggiungere writer paired paralleli duplicherebbe
le transazioni, le precondizioni e l'audit del Web.

## Composizione proposta

Il client offre la gestione locale soltanto quando l'origine home-base è
loopback. L'operatore inserisce nuovamente la passphrase; il trasporto usa
`/api/auth/check` e `/api/auth/login`, con derivazione v3, ETag e chiave della
richiesta, senza trasmettere o conservare la passphrase. Cookie e control Web
sono distinti dalle credenziali native, restano in memoria e sono ritirati
al blocco, al rilascio della finestra e alla chiusura dell'app. Utente, ruolo e
generazione restituiti devono coincidere con l'autorità nativa corrente.
Non è un grant amministrativo del token paired.

Le API pubbliche del trasporto sono nominate e tipizzate: quattro interruttori
AI e cancellazione di un allegato letto. Non espongono un proxy generico né
chiavi di impostazione, provider, destinazioni o metodi HTTP arbitrari.
Il ruolo è quello dell'account Web; ogni route mantiene la sua autorizzazione.
Le API Web già esistenti non vengono ampliate ad altri canali.

Per cancellare, il client legge dettaglio, paziente e currentness dal Web;
conserva `sourceRef`, `revision` e `freshnessEpoch` nel comando non costruibile
dall'esterno. Una conferma separata usa la DELETE Web con quella precondizione.
Il comando è consumabile una sola volta e legato alla specifica autorità
locale. Il successo richiede risposta positiva e GET successiva 404. Conflitto,
diniego e rilettura non verificabile non producono successo o reinvio.
La transazione e l'audit restano quelli della route Web.

Gli interruttori usano GET/PUT del Web, un'impostazione per conferma. Una nuova
lettura prima dell'invio respinge una modifica osservata dopo la preparazione;
la rilettura finale deve coincidere con il valore confermato. Questo controllo
preventivo non è un CAS atomico: la route Web delle impostazioni non offre tale
precondizione. Anche il suo audit resta quello del Web, distinto dall'audit
atomico della cancellazione documentale. La tranche non promette atomicità di
più impostazioni né avvia generazioni.

## Ritiro nominato

Il logout Web generale ritira anche il contesto del Supervisor. Il nuovo
`POST /api/auth/local-client/logout` usa soltanto il servizio canonico
`completeExactWebP3Logout` della coppia cookie/control presentata. È limitato
a trasporto loopback, Origin esatto e richiesta JSON same-origin; rifiuta il
marker del proxy LAN. Non chiama il controller del Supervisor e non cancella
altre sessioni. Il 204 attesta il ritiro remoto; un errore mantiene distinta
la chiusura locale dal ritiro non confermato. Non è aggiunto un writer.

## Limiti

La nuova composizione consegna accesso locale, quattro interruttori e
cancellazione documentale. Non chiude tutte le righe G-2/G-4: installazione e
profilo hardware, sicurezza account, ChatGPT, Fabric/governance, repertori
amministrativi, import multiplo/CSV e nuova scheda da documento restano distinti.
G-3 non è modificato. Nessuna installazione, rete o dato clinico reale è provato
dai test sintetici. La review dovrà valutare le superfici di autorizzazione
elencate nella PR e il lifecycle della sessione Web locale.

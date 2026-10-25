# ADR 0164 — Ricevuta di ritiro dell’autorità native precedente

Stato: Proposed, candidato WUL-794. Data: 2026-10-25.

## Problema

Un owner Fabric stabile conserva la responsabilità della chiusura oltre la
sezione e la sessione. Se S1 è revocata, cancel/status richiedono ancora S1;
un nuovo login S2 non prova il cleanup e non può cancellare tentativi di S1.
Un 401 può inoltre dipendere da ammissione temporanea, non da revoca definitiva.

## Decisione

Il servizio nominato `verifyPreviousAuthorityRetirement`, esposto soltanto da
`POST /api/v1/network/ai/authority-retirement`, attesta la perdita irreversibile
dell’autorità native di S1. Richiede S2 ammessa dal vero ingresso paired e dal
lifecycle d’inferenza corrente. Accetta soltanto `previousAuthorityRef`, SHA-256
in esadecimale del bearer di S1, senza cookie precedente, identificativi clinici,
provider, modello, writer o comandi di revoca. Non ritira sessioni attive.

Il lifecycle conserva, dalla prima ammissione all’inferenza, il riferimento alla
sessione genuina e il binding immutabile operatore/ruolo/username/pairing/token/
piattaforma. La prova usa direttamente la cella native originale: una cella
ritirata non può essere riattivata. La semplice assenza dalla session admission,
un errore di ambiente o una risposta HTTP non sono prove. S2 deve differire da
S1 e coincidere in tutti i binding indicati. Un riferimento ignoto è negato.
La risposta lega riferimento precedente e corrente e dichiara separatamente
`authorityRetired: true` e `physicalCleanup: not_attested`.

Il registro è solo RAM, senza chiavi o contenuti clinici, vive quanto il processo
e contiene al massimo 4096 sessioni ammesse all’inferenza. Non elimina prove per
età o per liberare slot: a capacità esaurita nega nuove ammissioni. Dopo riavvio
un riferimento non conosciuto resta non attestabile. Questo limite operativo non
si trasforma in cleanup confermato né in un’autorizzazione client generica.

Il recupero usa la connessione corrente del workspace, indipendente dalla
selezione clinica o documentale ormai invalidata. La proiezione ENC conserva
invece tutte le verifiche del contesto e delle fonti correnti.

Il client può liberare la responsabilità della precedente autorità dopo questa
ricevuta, mantenendo distinte chiusura fisica e revoca. Tombstone, reservation e
timer del runtime host restano intatti: se un cleanup è incerto continuano a
bloccare il runtime. Un nuovo tentativo richiede sempre preparazione e scelta
esplicita della sede; nessuna alternativa automatica o apply.

Snapshot conservati e task asincroni contengono soltanto connessioni senza
masterKey e selettori. La proiezione ENC legge la chiave dalla connessione
corrente solo nell’operazione sincrona di decifratura. Nessuna connessione con
chiave deve attraversare un await. Un prepare tardivo riconcilia soltanto il
proprio owner ancora pendente; una ricevuta di ritiro già acquisita o una nuova
generazione ne impediscono ogni pubblicazione o regressione.

## Prove e alternative

Fixture sintetiche esercitano l’ammissione HTTP paired reale, la cella originale,
revoca con disposer fallito, binding diversi e sessione ancora attiva. I modelli
Swift coprono S1 → cancel 401 → S2 sullo stesso owner e risposte tardive, insieme
alle regressioni ABA e projection grant esistenti. Il 401 come ricevuta e il
trasferimento di autorità da S1 a S2 sono esclusi. La chiusura fisica resta una
prova distinta. Nessun runtime di modello, OCR o database clinico nelle prove.

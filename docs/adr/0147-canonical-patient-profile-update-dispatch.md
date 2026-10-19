# ADR 0147 — Dispatch canonico dell'aggiornamento profilo (BT-04)

- Stato: Accepted per il confine incrementale WUL-576
- Data: 2026-10-18
- Riferimenti: WUL-576; ADR 0146; ADR 0052

## Contesto

Web, API locale v1 e client abbinati aggiornano il profilo attraverso
`updatePatientProfile` e il writer Node esistente. Il discriminatore operativo
versionato identifica già `patient-profile.update.v1`, ma manca un comando
canonico effettivamente consumato da un unico dispatch prima degli effetti.
Questo incremento non migra scritture a Rust e non concede capacità agli agenti.

## Decisione

Il servizio conserva ammissione, normalizzazione e precedenze HTTP correnti.
Dopo le attese già richieste dagli owner, acquisisce il contesto audit host e
crea un'esecuzione volatile per la singola richiesta ammessa. Il comando interno
immutabile contiene operazione/versione, scopo fisso `patient-profile-update`, paziente/versione attesa, autore e
scope derivati dall'host, payload profilo esplicito normalizzato, data della
normalizzazione e conferma `legacy-not-attested`. Il payload non contiene SQL,
patch arbitrarie o un'autorizzazione scelta dal body. I campi cifrati restano
identici; non si decifrano o ricifrano in questo confine.

Il percorso è fisso: servizio → dispatch specifico del profilo → esecutore
`legacy-node` → `updatePatientOperation`. La scelta dell'esecutore precede gli
effetti; non esiste tentativo di un nuovo writer seguito da fallback. Guard di
commit, audit, CAS e membership rimangono quelli esistenti. Dalla risoluzione
finale dell'audit all'invocazione sincrona del writer non si aggiungono attese;
il guard paired resta verificato nella transazione del writer.

L'host genera execution ID e chiave di idempotenza distinti. La correlation
deriva dal contesto audit corrente e può conservare un `x-request-id` dichiarato
dal chiamante: serve al tracciamento, mai ad autorità o deduplicazione.
Il campo di autorizzazione descrive l'ammissione host e il guard esistenti,
distintamente dalla conferma non attestata; non concede una proof nuova.
Il contesto lega il comando e l'autorità già ammessa e non
è un nuovo emittente di capacità. Un oggetto ricostruito dal chiamante non è un
contesto valido. I campi omonimi nel body non sono adottati dal comando.
L'autore di una richiesta con solo token locale resta un servizio, senza
inventare una sessione o un ruolo medico.

Prima del writer il dispatch registra lo stato avviato e la Promise terminale.
Stessa chiave e stesso comando nello stesso contesto restituiscono quella
stessa Promise/esito, anche per invocazioni concorrenti o rientranti, senza un
secondo writer. Chiavi o comandi diversi sono negati. Un'eccezione successiva
all'avvio resta terminale; il contesto non si riarma e non ritenta gli effetti.
Non esistono registro globale, persistenza o riuso dell'esecuzione da HTTP.

L'esito interno è legato a operazione/versione, scopo, execution ID, chiave e
correlation del comando: `applied` contiene il successo del writer, `refused`
il suo diniego e `uncertain` l'eccezione dopo l'avvio, senza dichiarare se abbia
committato. Il servizio consuma questo esito: restituisce il risultato legacy
oppure rilancia la stessa eccezione alle mappature HTTP esistenti. L'attesa
dell'esito avviene soltanto dopo l'invocazione sincrona del writer. Non è una
nuova ricevuta HTTP, né una prova di conferma umana.

La garanzia è una **chiave host con ambito singola esecuzione; deduplicazione
interna e riuso esito; nessuna idempotenza durevole tra richieste**. Una nuova
richiesta HTTP crea un nuovo contesto: il replay con la stessa versione è
respinto dal CAS corrente, anche se il body ripresenta una chiave dichiarata.
Nessuna ricevuta nuova viene aggiunta al wire 0.9.

## Compatibilità e limiti

Restano invariati gli errori di dominio e le precedenze autenticazione, body,
esistenza e normalizzazione. L'equivalenza Web/v1/paired si valuta con
ammissione equivalente: i controlli aggiuntivi paired sui campi e sullo scope
continuano ad applicarsi. Il catalogo Headless non acquisisce operazioni di
scrittura. La conferma legacy non attesta una prova umana specifica per comando
(WUL-584), né implementa il futuro writer Rust, ricevute durevoli o altri passi
di WUL-577/585. Un errore di trasporto o un esito incerto non autorizza retry.

## Verifica

Le prove sintetiche devono osservare: doppio dispatch concorrente con un solo
writer e identico esito; comando/chiave/contesto alterati senza effetti;
eccezione dopo avvio terminale; impossibilità di adottare operazione, percorso,
autore, scope, conferma o chiave dal body. I veri adapter devono conservare
parità degli errori e precedenze e produrre, su due PUT con versione e chiave
dichiarata uguali, un solo commit/audit e poi 409. Una revoca paired durante
le attese deve impedire la scrittura. Il writer conserva la propria transazione,
membership, ENC e audit obbligatorio; la review indipendente esamina il diff
finale prima dell'integrazione.

## Ciclo reversibile del pilota (WUL-578)

Il ciclo scelto è l'archiviazione `isArchived: true` e la riattivazione
`isArchived: false` già presenti nell'aggiornamento del profilo. Entrambe passano
da questo dispatch e dallo stesso writer. Il paziente archiviato resta leggibile
dal dettaglio ordinario e dalla query scoped; la riattivazione azzera
intenzionalmente `archiveReason` e `archiveNote`, conservando identità,
associazioni e altri dati clinici. La prova continua in
[`patient-profile-review.test.ts`](../../lib/patient-profile-review.test.ts)
parte dalle note rivedute dell'ADR0149, attraversa il ciclo con SQLite e AES reali
e verifica CAS, audit, rollback e rilettura, compresa la ricevuta delle note
dopo gli avanzamenti di versione. Non modifica la semantica della rimozione logica.

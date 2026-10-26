# ADR 0167: prima sede da GPUI con autorità Web P3 separata

Date: 2026-10-26

Status: Proposed

Refs WUL-771; G-1a/G-2c, ADR 0145 e ADR 0161.

## Problema e confine

Un archivio con account e zero sedi non offre uno scope paired per creare
la prima sede. Il setup Web crea già la sede nominata quando configurata:
quel comportamento resta. Non si aggiungono nomi o selezioni implicite,
accesso SQLite dal client o eccezioni al requisito di scope delle route paired.

L'autorità **host** di questa operazione è una proiezione Web P3 autentica,
emessa dall'owner esistente. Non significa località del server attestata
da `Host`, `Origin`, piattaforma, pairing o indirizzo loopback.
La restrizione locale riguarda il consumer GPUI e questa sola porta.
Il bearer locale non è ammesso; ruolo e autorizzazioni generali restano invariati.

## Decisione

Introdurre soltanto `first-ambulatory.create.v1`, con sessione Web P3
dedicata, login recente e conferma specifica. L'operatore Web deve essere
lo stesso della sessione paired autentica catturata all'apertura; entrambi
devono risultare amministratori correnti del medesimo archivio.
Il pairing vincola dispositivo e operatore, ma non concede la creazione.

Il client usa un tipo `HostBootstrapSession` distinto da `RuntimeSession`.
Non converte, copia o sostituisce la proiezione dell'owner, non usa il cookie
nativo come cookie Web e non estende le capability paired.
Riusa login, controllo, lockout e ritiro Web P3 esistenti; nessun nuovo issuer.

Il riferimento descritto sotto correla una preparazione con le due autorità
e il payload. Non è un grant amministrativo, una credenziale autonoma o
una garanzia di consumo durevole monouso. Il gate atomico di zero sedi
impedisce due creazioni riuscite in questa operazione.

## Contratto HTTP chiuso

Tutte le risposte sono `Cache-Control: no-store`. Limite JSON 4096 byte;
chiavi aggiuntive, query, contenuti non JSON e forme malformate sono negate.
La generazione attesa viaggia soltanto nell’header
`x-mediflow-archive-generation`; il nome non ammette alias.
Tutti gli ingressi richiedono `Origin` esatto e `Sec-Fetch-Site: same-origin`
secondo il controllo Web esistente, senza esenzioni o nuove fiducie proxy.
Questi header proteggono il trasporto, non provano una presenza locale.

| Ingresso | Autorità e risultato |
| --- | --- |
| `POST /api/auth/ambulatory-bootstrap/begin` | Cookie paired nativo e credenziale dispositivo correnti, amministratore corrente, generazione attesa. Prepara solo correlazione/payload e un nuovo control Web P3; nessuna scrittura di sede. |
| `POST /api/auth/login` | Login Web P3 esistente con il nuovo control, ETag e chiave di idempotenza; credenziale esplicita dello stesso operatore. Non contiene un'eccezione bootstrap. |
| `POST /api/auth/ambulatory-bootstrap` | Conferma nominata e Web P3 dedicata corrente; ricontrolla anche il paired catturato e il gate zero sedi nella transazione del writer. |
| `GET /api/auth/ambulatory-bootstrap` | Rilettura nominata, autenticata e limitata alla sede e al payload preparati; nessuna scelta o lista amministrativa generale. |
| `POST /api/auth/ambulatory-bootstrap/retire` | Ritiro della sola Web P3 di questa preparazione con `completeExactWebP3Logout`; non chiama il logout Web generico o il supervisor. |

La risposta `begin` negozia esattamente `operation`, `contractVersion: 1`,
`reference`, `archiveGeneration` e `expiresAt` (millisecondi Unix). Il control
viaggia soltanto in `Set-Cookie: mediflow_auth_control=…`; il suo fence
in `ETag` forte. La sessione Web successiva usa `mediflow_session` e
`mediflow_auth_control`, con ETag e Idempotency-Key del login P3.
Il riferimento è casuale a 256 bit, opaco, soltanto in RAM. Sugli ingressi
successivi viaggia nell'header `x-mediflow-bootstrap-reference`, mai nell'URL.
Un host senza questa risposta esatta è incompatibile con la funzione;
nessun ripiego sulla POST paired o sulla POST Web generica.

La porta è un'eccezione nominata al roster amministrativo non ancora esposto
di ADR 0161, negoziata dalla propria risposta `begin`: non dichiara disponibile
la famiglia amministrativa generica né cambia le otto combinazioni del roster
esistente. Altre operazioni amministrative richiedono il proprio contratto.

### Preparazione e login

Body `begin`, con tutte e sole queste chiavi:

```json
{
  "operation": "first-ambulatory.create.v1",
  "id": "UUID-v4-minuscolo-stabile",
  "name": "nome esplicito",
  "address": null,
  "description": null
}
```

L'ID deve essere UUID v4 canonico minuscolo; il nome è testo non vuoto già
rifilato, massimo 200 caratteri. Indirizzo e descrizione sono `null` oppure
testo già rifilato, massimo 500 e 2000 caratteri. Identificativi e testi non
ammettono controlli C0/DEL; nessun percorso, segreto o campo paziente.
L'host fissa `parentId: null`, `isDefault: true`, `type: live`.

Il server conserva il payload esatto, la generazione, la proiezione nativa
originale, il binding paired e il control Web P3 appena creato. Non conserva
PIN, passphrase o verificatore. Il client mantiene il suo cookie nativo nel
trasporto paired originale; il nuovo trasporto Web riceve soltanto il proprio
control e poi il proprio cookie Web, senza cookie jar browser condiviso.

La preparazione dura 120 secondi. La Web P3 deve essere stata emessa con quel
control dopo l'inizio della preparazione; `createdAt` non futuro, login entro
120 secondi, sessione non scaduta. Cookie/control di un'altra sessione sono
negati anche per lo stesso utente. I cambi di control/sessione non rinnovano
la preparazione. La conferma UI mostra nome della sede, operatore e origine
dell'archivio, e richiede il gesto esplicito «Crea la prima sede».

Il registro è process-local, massimo 128 preparazioni, senza espulsione di
preparazioni vive per ammetterne altre. A capacità esaurita si nega l'apertura.
Scadenza/restart negano commit e readback; non attestano il ritiro remoto.
I dati sono eliminati dopo ritiro attestato o scadenza del ciclo di controllo
dell'owner. Nessun rinnovo o ricostruzione automatica dal client.

### Conferma e transazione

Body di commit: tutte e sole `operation: first-ambulatory.create.v1` e
`confirm: true`. Il payload di sede è quello preparato e non viene riletto
da campi liberi del commit. Header di generazione uguale a quella catturata.

Sotto il medesimo `IMMEDIATE` del core `createAmbulatory`, prima di ogni DML:

1. Risolvere l'esatta Web P3/control; verificarne currentness nell'owner,
   login dedicato recente, sessione nativa e binding paired originali correnti.
2. Rileggere il pairing/modo, entrambi gli utenti/ruoli, corrispondenza dello
   stesso operatore, generazione archivio e operazione/payload preparati.
   Revoca, cambio ruolo, archivio, scadenza o sostituzione negano senza effetti.
3. Verificare che non esista alcuna sede, compresi ID malformati o non-default.
   Una sede comparsa nel frattempo dà `409 BOOTSTRAP_NOT_EMPTY`, anche se
   il suo ID coincide con quello richiesto; non equivale a successo.
4. Delegare al solo core create/audit esistente: una sede/versione 1 e il
   relativo evento `ambulatory.created` con attore Web reale. Nessun secondo
   insert, audit successivo al commit, default demotion o relink di pazienti.

Un callback server derivato dalle autorità originali porta i controlli nella
transazione: non è fornibile dal DTO HTTP. I writer host/paired ordinari
mantengono il loro contratto. Errori audit/DML annullano l'intera mutazione.

Successo `201`: `operation`, `contractVersion`, `archiveGeneration`, `id`,
`version: 1`, `success: true`, `affectedAmbulatories` con la sola sede creata. Un nuovo invio
dopo il primo commit trova il gate chiuso; nessuna ricevuta positiva dedotta
da 409 o da una risposta mancante.

### Rilettura e riconciliazione

Il readback richiede la medesima doppia identità, control, freschezza e
generazione; non richiede zero sedi. Legge sotto la transazione autorevole
soltanto l'ID preparato e verifica nome, indirizzo, descrizione, parent nullo,
tipo live, default e versione 1. `200` restituisce esattamente `operation: first-ambulatory.read.v1`,
`contractVersion: 1`, `archiveGeneration`, `id`, `name`, `address`,
`description`, `parentId: null`, `type: live`, `isDefault: true`, `version: 1`; assente `404`, divergenza `409 READBACK_DIVERGED`.
Nessuno dei due abilita l'invio di una nuova creazione automaticamente.

Dopo readback esatto, il client rilegge l'elenco tramite l'ordinario paired
e verifica lo stesso ID/versione prima della scelta esplicita della sede.
La successiva perdita dello scope non sceglie un default.

Risposta persa o cancellazione dopo dispatch: conserva ID e bozza come esito
indeterminato. Occorrono nuova preparazione, nuovo login e riconciliazione
readback dello stesso ID/payload; `begin` può preparare tale lettura anche
quando ormai esistono sedi. Non ripete il commit né genera un nuovo ID.
Una rilettura coincidente attesta soltanto la sede osservata: dopo risposta
persa non attribuisce causalmente il commit al tentativo e la UI non dice
«questo invio è riuscito». Una causalità positiva richiederebbe una ricevuta
o un audit esistente verificabile; questa tranche non introduce tale prova.
La conferma di creazione resta disabilitata finché l'esito precedente non
è risolto esplicitamente. Un readback divergente conserva la bozza.

## Ritiro e isolamento

La composizione `retire` vincola riferimento e control/cookie Web dedicati
e riusa `completeExactWebP3Logout`, anche se il paired è ormai revocato.
Non accetta cookie di altra Web P3, non usa `clearAllSessions` e non arresta
il supervisor. Una generazione sostituita impedisce il lavoro ma non deve
impedire il tentativo di ritiro della Web P3 esatta ancora posseduta.

Body di ritiro: tutte e sole `operation: first-ambulatory.retire.v1`.
`204` senza body, con eventuale ETag forte, attesta solo il ritiro Web P3 esatto restituito dal helper. Riferimento
ignoto, cookie assente/sostituito, diniego, errore o risposta persa lasciano
il ritiro remoto non attestato. Il client lo dichiara; non sostituisce una
seconda sessione e non usa un logout più ampio per ottenere un esito verde.

Lock, chiusura, cambio archivio o annullamento ritirano immediatamente il
contesto locale e i callback; il tentativo remoto è separato e non blocca
quel ritiro. Prima del dispatch, cancellazione impedisce la scrittura;
dopo dispatch l'esito è indeterminato, anche se la socket viene chiusa.
ID/bozza non sono persistiti nelle preferenze. Nessun retry o redirect.

Il consumer GPUI accetta solo l'origine locale configurata immutabile
(hostname `localhost` o indirizzo letterale loopback); usa il TLS pin ove
previsto, disabilita proxy e cookie browser condivisi, manda Origin esatto
e `Sec-Fetch-Site: same-origin`. Non segue redirect e non cambia origine
dopo login. Questa restrizione non prova dove termini un proxy dell'host
e non modifica le regole proxy del server.

## Prove e limiti di accettazione

SQLite reale sintetica: due partecipanti con connessioni e commit davvero
concorrenti, dopo preparazioni distinte, producono una sola sede/audit e
un solo successo; il perdente409 non modifica dati. Test con barriera,
non soltanto ordini serializzati nello stesso event loop.

Negativi: account non-admin, diverso operatore, revoca del peer/sessioni,
cambio ruolo/generazione fra parsing e commit, control/cookie substitution,
CSRF/Origin, query/extra/limite body, preparazione scaduta e registro pieno.
Audit FAIL/IGNORE e DML IGNORE devono conservare lo snapshot completo.

Trasporto/UI: origine locale immutabile, redirect/proxy negati, niente retry,
lost response, readback divergente, cancel prima/dopo dispatch, lock/close/
restore e bozza; nessuno scope selezionato prima del readback esatto.
Ritiro esatto lascia vive un'altra Web P3 e la sessione del supervisor;
un errore di ritiro non viene presentato come cleanup completato.

Richieste review indipendente del diff finale e prova UI reale coordinata.
Le prove non attestano località remota, installazione o ammissione clinica.
Bootstrap, parità G-2c e G-1a complessive restano distinti dalla singola PR.

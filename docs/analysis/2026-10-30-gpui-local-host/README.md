# Gestione locale e cancellazione documentale GPUI

Seconda tranche G-2/G-4 sopra `fb172d61811cccdcd20cb847baea34a1bac7f773`.
Composizione proposta in [ADR 0172](../../adr/0172-gpui-local-web-session.md),
soggetta a review indipendente prima del merge. Non chiude G-2/G-4 completi.

Le route Web di impostazioni e allegati esistevano già. La tranche aggiunge
il consumer GPUI con sessione Web P3 distinta, disponibile solo per home-base
loopback. Nessun writer, schema SQLite, percorso di inferenza, grant paired o
permesso amministrativo del Web viene aggiunto o ampliato. Le preferenze AI
paired precedenti restano un percorso separato con la loro ammissione.

## Superfici di autorizzazione aggiunte al client

| Superficie | Autorità e soglia | Effetto |
| --- | --- | --- |
| GET `/api/auth/check`, POST `/api/auth/login` esistenti | Loopback prima delle credenziali; nuova passphrase, derivazione v3, control/ETag, chiave della richiesta, stesso utente/ruolo/generazione della sessione native | Sessione Web propria in memoria; nessuna credenziale persistita o inviata in chiaro |
| GET/PUT `/api/settings/[key]` esistenti | Cookie Web; solo i quattro `HostSettingKey` del tipo Rust; rilettura prima di preparare e prima di inviare, conferma separata, rilettura finale | Un solo interruttore per comando: Patient Insight, Document Synthesis, Smart Import o Treatment Reasoning; nessuna generazione |
| GET/DELETE `/api/attachments/[id]` esistenti | Cookie Web locale; documento e paziente riletti, currentness valida; comando legato all'autorità e consumabile una sola volta | DELETE Web con `patientId` e `expected.sourceRef/revision/freshnessEpoch`; stessa transazione e audit Web; successo solo dopo risposta positiva e GET 404 |
| **Nuova** POST `/api/auth/local-client/logout` | Origin esatto, same-origin JSON, loopback; proxy LAN e query rifiutati; coppia cookie/control attiva esatta | Servizio canonico `completeExactWebP3Logout`; nessun ritiro del Supervisor o di altre sessioni |

Il logout Web generale è stato escluso perché invoca anche il lifecycle del
Supervisor. Il nuovo endpoint ritira soltanto la sessione propria. Se il ritiro
fallisce, il client non lo dichiara riuscito a un secondo tentativo. Alla chiusura
normale dell'app il ritiro è atteso insieme al logout native; blocco/rilascio
avviano il ritiro della sola autorità locale posseduta. Un arresto del processo
può lasciare il ritiro remoto non osservato: nessuna garanzia di completamento
viene attribuita a quel caso.

Gli interruttori usano le autorizzazioni del Web, anche quando la registry
ammette una sessione operatore non amministratrice. Il confronto prima del PUT
non è un CAS atomico: la route Web delle impostazioni non offre quel contratto.
Il suo audit resta quello esistente, mentre DELETE conserva precondizione e
audit transazionali del writer documentale. Nessuna atomicità composta viene
promessa. I comandi incerti conservano la richiesta e non possono essere
reinviati; una nuova preparazione richiede un gesto esplicito.

## Prove

- Rust workspace e tutti i target: **463 passati, zero falliti, sette ignorati**;
  toolchain 1.98.1, lockfile e dipendenze locali. Clippy con warnings negati,
  fmt, typecheck, lint, claims e never-regress verdi; 44 test del selettore
  e inventario COMPLETE (1307 file, 1266 selezionati, 41 esclusioni motivate).
  I test HTTP verificano cookie/control separati dalle credenziali paired,
  assenza della passphrase nelle richieste, loopback prima del login,
  non autorizzato, paziente estraneo, CAS 409, diniego 403, assenza non verificata,
  GET 404 finale e consumo singolo del comando. Interruttore cambiato dopo la
  preparazione: nessun PUT. Blocco native: nessuna DELETE. Ritiro: solo il nuovo
  endpoint, senza successo dichiarato dopo un rifiuto.
- I test GPUI verificano ritiro del segreto, generazione dell'autorità, blocco
  dei cambi di contesto durante il comando e scarto dei callback di una vecchia
  autorità. Le prove Web esistenti di currentness/create/delete e audit su SQLite
  sintetica passano; la nuova prova del ritiro locale copre trasporto e coppia
  esatta dei cookie.
- [40 immagini native con hash](captures.json), Giorno/Grafite, 1200/390 punti:
  funzioni, nuovo accesso locale, elenco documenti e soglie dei due comandi.
  La base non aveva accesso/interruttori/cancellazione: le sue soglie mostrano
  quindi l'assenza del comando; non si inventa una conferma equivalente.
  Finestre e renderer GPUI reali su macOS 27.2, stati sintetici predisposti da
  harness esterno temporaneo. Non sono prove di login/picker/VoiceOver o di
  operazioni contro un'installazione reale. Le sorgenti del prodotto usate come
  base del harness sono identificate nel manifest; il codice temporaneo non è
  consegnato nell'app.

La suite conserva i sette test precedenti che richiedono un ancestor macOS
firmato come ignorati e l'avviso upstream `block 0.1.6`. Errori intermedi:
Clippy su prestiti superflui, firma dei nuovi handler Window e due tipi di
fixture TypeScript; corretti. L'ordine del nuovo modulo è legato a rustfmt nel
selettore CI. Nessun test, timeout, soglia o autorizzazione è stato indebolito.

## Residuo

Sicurezza account, installazione e profilo hardware, account ChatGPT,
Fabric/governance, repertori amministrativi e altre pagine G-2 restano aperti.
G-4 conserva import multiplo, originale inline, curation, CSV e nuova scheda
da documento; il controllo dei duplicati resta preventivo. La matrice G-7
completa e l'installazione/qualifica del candidato non sono attestate da queste
prove. G-3 non è modificato. Nessun merge, auto-merge o dato reale utilizzato.

# MediFlow 0.8.6: candidato funzionale locale

Data: 6 settembre 2026. Coordinamento WUL-669.
Branch di integrazione: `codex/WUL-669-086-local-closeout`.
Base main: `b72ac713b624e7d771262e4e01c5c5e1f56f9ae2`.

Questo verbale distingue il candidato locale dalla release. La proposta visiva
resta sul branch `codex/WUL-676-086-runtime-twin`, commit
`f7efd50a40f0fb99084b136f611456bdaa19a31e`, per la revisione dell'utente.
Non è inclusa automaticamente in questa integrazione. Nessun push, PR, tag,
rilascio, aggiornamento tracker o attivazione su dati reali è stato eseguito.

## Comportamenti consegnati

| Ambito | Cambiamento locale | Limite della prova |
| --- | --- | --- |
| OCR | AnyDoc e fallback PDF Apple Vision hanno provenienza visibile; interruzione dell'attesa, scarto delle risposte tardive e recupero dei controlli. | PDF supportati sul Mac provato; immagini singole manuali. L'interruzione client non garantisce l'arresto immediato del processo server. |
| Stato funzioni | Sette funzioni con scopo, prerequisiti e azione; errore, spento, da configurare e da provare sono distinti. | Lettura configurazione; nessuna data di inferenza inventata e nessuna qualifica clinica. |
| WHO | Setup del servizio corrente e verifica esplicita di un termine pubblico; risposta live, cache ed errore distinti. | Account live e decisione sul catalogo offline non verificati. Nessuna nuova lookup/codifica automatica. |
| Ollama | Comando host esplicito per ispezione, ammissione, recupero e revoca, con attestazione locale e CAS. | Solo Ollama; ATHENA resta separata. Non accende le funzioni e non genera testo. |
| Homebase | La modalità configurata produce stato `unknown/not_probed`, non disponibilità di rete presunta. | Non sostituisce una prova di collegamento paired. |
| Onboarding | Guida locale con tre domande, scelta manuale, anteprima persistita, ripresa, cambio e rollback del profilo. | Nessun host agente collegato o privilegio concesso dalla preferenza; piattaforme non installate restano non provate. |
| Accesso | Matrice sintetica login, lock, logout, recovery e PIN, con route protette rilette. | Prove locali Web; non parity nativa o distribuzione. |
| Deslop | Inventario ripetibile dei sorgenti first-party; tranche sui builder Apple ritirati. | Nessun claim di revisione manuale di ogni riga o rimozione totale del debito. |
| Export | Il Bundle FHIR conserva il timestamp già presente nel DTO; copertura ed esclusioni FHIR/PDF hanno test espliciti. | Export parziale secondo il contratto v0; non risposta completa automatica a una richiesta GDPR. |
| Governance | Matrice GDPR/AI Act versionata, controlli tecnici e responsabilità organizzative separati. | Candidato documentale, con applicabilità e revisione competente ancora aperte. |

## Configurazione locale Ollama

Dalla checkout, con Node 24, indicare la directory dati effettiva:

```sh
npm run setup:local-provider -- inspect --data-dir /percorso/dati
npm run setup:local-provider -- admit --data-dir /percorso/dati --confirm-local-change
```

`inspect` apre in sola lettura un database già esistente. `admit` può caricare
in memoria un modello già installato, senza prompt. Non scarica nulla e non
modifica impostazioni cliniche, PIN, ruoli, kill switch o database.
La stessa sintassi con `recover` serve solo per un lifecycle degradato.
`revoke` è terminale: non esiste un reset automatico o una riammissione che
cancelli la precedente revoca. Ripetere un comando compatibile è idempotente.
Un binding cambiato durante l'attestazione richiede un nuovo tentativo.

Contratti: [ADR 0121](../adr/0121-function-status-projection.md) e
[ADR 0122](../adr/0122-local-provider-host-setup.md).

### Qualificazione circoscritta di Ollama 0.33.3

Il daemon locale rispondeva `0.33.3`, prima negato dal controllo che ammetteva
soltanto la linea `0.32.x`. È stata aggiunta la sola versione esatta `0.33.3`;
`0.33.0`, `0.33.4`, `0.34.0` e prerelease restano negate.
Il [sorgente ufficiale v0.33.3](https://github.com/ollama/ollama/blob/v0.33.3/server/routes.go)
mantiene il caricamento senza prompt e i marcatori dei modelli remoti.
La [release upstream](https://github.com/ollama/ollama/releases/tag/v0.33.3)
è stata consultata il 6 settembre; le note upstream non sono da sole una prova.

La prova locale ha attraversato version/tags/show, caricamento senza prompt e
ps con confronto del digest per `qwen3.5:35b-a3b`. Il comando su una fixture con
sole impostazioni ha prodotto `admitted/available_unqualified`, poi una revoca
esplicita e la rilettura del record. Nessuna inferenza, nessun dato clinico e
nessuna ammissione nella directory di lavoro dell'utente. Questa evidenza non
qualifica altri modelli, future versioni, hardware o risultati clinici.

## Verifiche di integrazione

Ambiente: macOS arm64, Node 24.19.0, ABI 137. Fixture e log delle prove di
integrazione in directory temporanee dedicate, escluse da Git.

| Verifica | Esito osservato |
| --- | --- |
| Suite unitaria integrata `npm run test:unit` | 3.142 passati, zero falliti, uno skip su 3.143 test; lo skip riguarda il renderer assente su un host che lo possiede. |
| Browser integrato: OCR recovery, stato funzioni, WHO, Fabric, web smoke e onboarding | 17 passati, zero skip, 2,4 minuti. |
| Regressioni dopo revisione indipendente | 23 test mirati e 3 browser passati, inclusi errore prima del commit e risposta persa dopo commit. |
| Binding host e comando locale, dopo isolamento import | 11 passati: include un processo fresco che prova l'assenza di inizializzazione dati con reader iniettato. |
| Contratti locality/stato/comando | 20 passati; versioni future non qualificate, modello remoto, errore e race negati. |
| Contratti packaging/launcher/WHO retirement/crosswalk | 22 passati. |
| OCR: falsificatori e architettura aggiornati | 14 passati; timeout limitato al riconoscitore, recupero con deadline normali. |
| Lint e typecheck integrati | Passati. |
| Build webpack e verifica bundle standalone | Passate; Node 24/ABI 137 e 111 pagine. Prova finale del bundle registrata sotto. |
| Lane accesso | 119 unit auth, 14 boundary e 2 E2E passati nella lane; [verbale](./2026-09-06-086-access-verification.md). |
| Lane onboarding | 43 test mirati, 5 browser e ripresa dopo riavvio reale passati; il percorso è ripetuto nella suite integrata. |
| Lane tooling Apple | 21 test con processi sostituiti, sintassi Bash e guard struttura/rete passati. La build reale si ferma al preflight: SDK simulatore non disponibile. |
| Lane export/governance | 18 test passati, incluso timestamp FHIR fallito prima del fix; [copertura e limiti](./2026-09-06-086-regulatory-evidence.md). |

La prima suite unitaria aveva tre errori: due asserzioni sul vecchio testo e
firma della chiamata OCR, più un timer accelerato che coinvolgeva anche il
parser PDF sotto carico. Le asserzioni sono allineate al contratto corrente;
la sostituzione del timer ora inizia solo nel riconoscitore. Il successivo
passaggio completo ha zero fallimenti.

### Incidente nella verifica del binding

Un test mirato iniziale del binding è stato eseguito senza override della
directory dati. L'import statico del database nel wrapper ha inizializzato il
database standard anche usando un reader iniettato. Il timestamp del file
risulta aggiornato alle 01:54:24 locali. Non sono stati letti o riportati record
clinici; non è però disponibile una fotografia precedente che attesti quali
scritture di inizializzazione siano avvenute. Nessun ripristino tentato.

Il controllo SQLite `quick_check`, aperto in sola lettura e con `query_only`,
ha restituito `ok`: prova l'integrità strutturale, non l'assenza di modifiche
logiche. Il wrapper ora carica il database solo nel reader di produzione.
Un test in processo fresco verifica che il reader iniettato non crei neppure
la directory dati. Le successive verifiche usano un override temporaneo
esplicito. Questo limite resta dichiarato e non viene mascherato da esiti verdi.

## Revisione indipendente

La revisione Astra ha rilevato due P2: errore del reader confuso con
configurazione mancante e anteprima del profilo non riallineata dopo un errore
prima del salvataggio, con revisione server invariata. Il candidato distingue
ora `unavailable` dal dato mancante e ricrea l’editor a ogni rilettura riuscita.
Le regressioni coprono separatamente risposta persa dopo commit e fallimento
prima del commit, impedendo di confermare una scelta diversa da quella vista.

## Decisioni e confini ancora aperti

- Revisione della proposta visiva da parte dell'utente, prima della sua
  integrazione. La demo resta separata dal candidato funzionale.
- Scelta WHO online/offline e prova dell'account ufficiale; il servizio
  esistente resta disattivato per default. Il nuovo pulsante non raccoglie o
  sostituisce credenziali. [Decision packet](./2026-09-05-086-who-decision.md).
- Revisione giuridico-regolatoria e adozione organizzativa del dossier;
  `legalVerdict: not_assessed`. [Matrice](./2026-09-06-086-regulatory-evidence.md).
- Firmatura, notarizzazione, installazione esterna, CI remota e release non
  eseguite in questa consegna locale. Le piattaforme non provate restano tali.

La consultazione Web Pro è stata tentata su una conversazione nuova nel
browser embedded, ma il controllo ha rilevato il Mac bloccato. Nessun prompt
o allegato inviato: `HOLD_ENVIRONMENT` limitato alla consultazione. Il lavoro
locale è proseguito tramite contratti, test e revisione Astra indipendente.

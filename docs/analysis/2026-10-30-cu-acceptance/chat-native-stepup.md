# Accesso nativo e scritture dalla chat

Refs WUL-788, WUL-797. Base del censimento: `dcf5f8485271a92aee28b5e6560abc1fa265cb06`.

## Censimento e tranche

| Contratto | Codice osservato sulla base | Contributo e residuo |
| --- | --- | --- |
| C-3a | Adapter MCP app-only, socket con verifica OS del peer, frame statico con CSP e risposte di stato. | Il comando chiuso `patient-document` apre il flusso C-6 esistente nella GPUI senza richiedere una cartella selezionata. Non accetta file, URL, nomi, identificativi di allegati o campi anagrafici. R sui due desktop resta da qualificare. |
| C-3b | Ricomposizione nella GPUI e concessioni RAM legate a sessione/selezione. | Il nuovo ingresso non restituisce dati clinici, mapping, grant o ricevute. `document-opened` attesta solo l'apertura. |
| C-4 | Accesso v3, conferma PIN paired verificata sul server, Touch ID locale con nonce, scadenza e controllo del lock. | L'accesso biometrico non è una proof per il writer. Nessun nuovo booleano di approvazione è accettato. La prova hardware resta aperta. |
| C-5 | Preview e consumo server singolo; PIN, selezione, generazione, CAS, transazione, audit e ricevuta durevole; recupero GPUI. | La scelta Touch ID non supportata viene respinta prima di iniziare il tentativo, conservando la conferma PIN. Touch ID per la scrittura resta da raccordare con un'autorità verificabile dal server. |
| C-6 | `native-patient-document.ts`, comando comune `patient-document-create-command.ts`, trasporto e finestra GPUI, deposito dei riferimenti, rilettura PDF, PIN. | La chat ora apre questa stessa finestra. I byte si scelgono nel file picker nativo; revisione, writer e recupero sono quelli esistenti. Gli allegati del compositore non sono scaricati. Il consumer Web del comando comune resta da realizzare. |
| Identità estratta | `pdf-service.ts` deduceva l'ordine di nome/cognome da una generica etichetta e dalle maiuscole. | `Paziente` e `Assistito` non producono più campi nome/cognome dedotti. Etichette esplicite continuano a produrre candidati da rivedere. Il percorso C-6 nativo mantiene tutti i dati incerti e richiede correzione esplicita. |

Questa tranche non chiude C-3, C-4, C-5 o C-6. Nessun writer, schema, confine
crittografico o claim di cifratura cambia. Il contratto della release e la sua
impronta nel registro rimangono invariati. Treatment Reasoning resta escluso.

L'apertura è un passaggio di navigazione, non una concessione alla chat. Dopo
l'apertura, la finestra segue il proprio ciclo nativo: chiudere il frame non
annulla un comando già confermato nel client. Le conferme, l'annullamento e il
recupero restano nella GPUI. Un secondo ingresso non sostituisce un'importazione
in corso. Se l'apertura non è confermata, il frame non ritenta automaticamente.

## Qualifica sul Mac di Leonardo

Usare soltanto un archivio sintetico nuovo, con copie originali dei PDF di prova.
Non usare l'archivio personale o le fixture cliniche della repository. Registrare
SHA del candidato, hash del binario, versione del server, macOS, architettura,
build di Codex e Claude, modalità di conferma e orario di ogni caso.

1. Costruire il candidato e avviarlo contro l'host sintetico. Creare una directory
   socket privata fisica in `/private/tmp`, permessi `0700`, e impostare
   `MEDIFLOW_CHAT_ACCESS_SOCKET` su un socket nuovo. Configurare ogni host MCP per
   eseguire lo stesso identico binario con `--chat-access-stdio PERCORSO_SOCKET`,
   secondo ADR 0165. Pairing e primo sblocco v3 avvengono nella GPUI.
2. In Codex e poi in Claude aprire la vista MediFlow. Senza selezionare un paziente,
   scegliere «Nuovo paziente da PDF». Attendere la finestra nativa. Il frame deve
   dire che l'apertura non conferma la creazione. Nessun file, nome o PIN deve
   comparire nelle chiamate MCP, nel contenuto del tool o nel contesto del modello.
3. Scegliere un PDF testuale sintetico; ripetere con scansione sintetica e OCR
   locale disponibile. Rivedere nome, cognome, CF e data nella GPUI. Provare
   «Paziente: Rossi Mario», due identità e istruzioni ostili. Nessuna attribuzione
   automatica certa; i campi vanno verificati personalmente.
4. Prima del PIN, verificare zero nuovi pazienti/allegati. Annullare e rileggere
   l'esito. Ripetere con PIN errato, lockout, scadenza di 30 s e vista oltre 5 min:
   nessun effetto clinico. Un nuovo tentativo richiede nuova revisione.
5. Con PIN corretto, confermare una sola volta. Verificare cartella, appartenenza,
   PDF originale aperto e audit. Doppio clic e replay non devono duplicare nulla.
   Un duplicato richiede la scelta esplicita di creazione separata, mai merge.
6. Interrompere il client prima dell'invio e dopo il commit con risposta persa.
   Al riavvio rileggere i riferimenti conservati: `unknown` resta incerto,
   `applied` richiede apertura dell'allegato, `retired` richiede ritiro server.
   Non ripetere automaticamente l'execute. Verificare separatamente crash client
   e crash server, conservando ricevute e audit.
7. Per C-5 selezionare una terapia sintetica, rivedere paziente/versione/stato,
   confermare col PIN e verificare un solo effetto auditato. Provare selezione
   A/B/A, cambio archivio, altra sessione, concorrenza Web/Claude/Codex e risposta
   persa. La scelta Touch ID non supportata non deve consumare il tentativo PIN.
8. Per il solo accesso C-4, Leonardo esegue realmente Touch ID: successo, rifiuto,
   annullamento, lock del Mac durante il prompt, timeout, hardware indisponibile,
   lockout e PIN alternativo. Verificare peer/app assenti, nuova istanza, revoca,
   reload, riavvio e booleani forgiati. Nessuna prova automatica sostituisce questi
   gesti. Questa procedura non dichiara Touch ID disponibile per C-5 o C-6.

Per ogni caso registrare PASS, FAIL o non osservato, modalità PIN/Touch ID,
client e prove raccolte. Il successo del frame o di un doppio iniettato non
attesta né il gesto hardware né il rendering/interazione nei due host reali.

## Residui e semplificazioni candidate

- Il raccordo biometrico alle scritture necessita di una conferma legata al
  comando che il server possa verificare; il successo locale di LocalAuthentication
  o il GET di ammissibilità non bastano. Vietato aggiungere `approved: true`.
- C-6 Web deve usare il comando di dominio esistente e un'autorità corrente
  esplicita. Il create-flow generico già presente non prova questa parità.
- Consolidare gli elenchi dei comandi del frame/adapter solo se riduce codice e
  mantiene parser chiusi, CSP e prove di assenza di dati clinici. Non introdurre
  un nuovo registro di protocollo per questa tranche.
- Conservare i controlli di ownership, `issuedTo`, ricevuta `applied` e deposito
  dei riferimenti; nessuna rimozione motivata soltanto dalla duplicazione apparente.

## Verifiche automatiche della tranche

- Node mirati: 101/101. Parser finale: 31/31; gli stessi test sulla base
  riproducono 10 errori di attribuzione/ordine delle etichette generiche.
- Rust chat: 32 pass, 10 ignored; Rust documento: 14 pass. I casi ignorati
  non attestano firma degli host o hardware. Clippy workspace/all-targets con
  `gpui_platform/runtime_shaders` e `-Dwarnings`, fmt, typecheck e lint passano.
- Frame chat: 42/42; Web su `127.0.0.1:38591`: 19/19, conferma terapia e
  import documentale. Queste prove Chromium non sono qualifica dei desktop.
- Modello formale terapia, controlli negativi e mutanti: PASS. Never-regress,
  boundary import DB, attachment currentness, claims, import review e selezione
  test: PASS. Nessun input coperto dal modello terapia è stato cambiato.
- `npm run test:unit`: 9.129 test, 9.099 pass, 3 fail, 27 skip. I tre errori
  in `lib/chatgpt-execution/execution-mac.test.ts` richiedono sorgenti congelate
  tramite `MEDIFLOW_MAC_PUBLIC_SOURCE_DIR` e `MEDIFLOW_MAC_NATIVE_SOURCE`, assenti.
  Il modulo non cambia in questa tranche. La suite generale rimane rossa.
- `npm run build`: FAIL nel prebuild, `Build input metadata: private file is
  reachable`. Nessuna rimozione della fixture DB vietata o modifica del guard.
  Build production e installazione non sono dimostrate.

Le fixture HTTP rigide possono ricevere `GET /` dal polling loopback di T3
Code e fallire anche su codice esistente. Non sono state modificate; nei
due run Rust mirati qui registrati non è stato osservato tale fallimento.
Review indipendente del diff finale, CI e qualifica hardware restano aperte.

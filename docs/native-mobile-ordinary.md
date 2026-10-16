# Quattro esperienze ordinary e documenti sui client Apple

Tranche WUL-589, 16 ottobre 2026. Base `a5420afa3e3eed7cf598a51e3d3dc52e3d132a6e`;
integrazione e prove su prodotto installato restano distinte da questo adapter.
L'emendamento in [ADR0076](./adr/0076-paired-document-domain-write-policy.md)
limita l'eccezione AI alle quattro esperienze ordinary già presenti sul Mac.

## Percorso comune e autorità

Patient Insight e Smart Import compaiono nella scheda paziente, Treatment
Reasoning in Terapie e Document Synthesis in Documenti. iPhone/iPad riusano
`NativeOrdinaryInputs`, `NativeOrdinaryModel`, `NativeOrdinaryProjectionClient`,
`NativeOrdinaryViews` e il renderer della proposta terapeutica. Non hanno un
runtime di inferenza proprio e non creano autorità dal tipo di dispositivo.

Il trasporto resta HTTPS paired con pin TLS e cookie nativo dell'operatore.
L'host richiede pairing/token correnti, piattaforma coerente, ruolo `admin` o
`user` e capability esplicite `network.ai.central-runtime` e
`network.replica.readonly-patients`. L'issuer conserva la piattaforma effettiva
`macos`, `ios` o `ipados`; un client che cambia piattaforma o token perde il
binding. Il runtime host deve superare autonomamente la propria qualifica.
Il percorso v3 dei client Apple è WUL-777; questo adapter non cambia login,
chiavi, formati cifrati o custodia delle credenziali.

Le capability si concedono tramite il pairing canonico: creazione
`POST /api/v1/network/pairing-intents`, poi conferma esplicita dell'host
`POST /api/v1/network/pairing-intents/{intentId}/confirm`, protetta dal token
API locale. Non modificare SQLite o simulare una sessione per sbloccare la
funzione. Il grant `native.ai.configure` di ADR0135 riguarda esclusivamente le
preferenze dell'host: richiede ancora il file amministrativo 0600 descritto
nell'ADR e manca una UI per concederlo. Quel grant non è richiesto né sufficiente
per l'inferenza ordinary.

Preparazione selector-only, grant monouso delle fonti, proiezione revocabile,
consenso per contenuti esatti, login OpenAI, catalogo dell'operazione,
generazione, parser e chiusura restano quelli della lane originale. La UI non
riceve un comando di apply. Una chiusura non confermata impedisce un nuovo
invio. Lock, sessione/paziente cambiati, uscita dalla vista e background
rimuovono la proposta e invalidano l'operazione; le risposte tardive non possono
ripristinarla. Su iOS la pagina di device login è presentata con
`SFSafariViewController` dentro una sheet: il login può proseguire in primo piano,
mentre un vero passaggio in background rimane invalidante. Le risposte non
ammesse e gli stati `login_pending` mantengono la stessa semantica Mac.

## Importazione multipla

Il picker accetta più file. L'adapter apre una sola risorsa security-scoped per
volta, controlla la dimensione prima della lettura e riusa il writer cifrato
`uploadAttachmentForSelectedPatient`. I file non vengono precaricati in blocco
e gli upload sono sequenziali.

Ogni risultato distingue il salvataggio confermato con elenco aggiornato,
il salvataggio confermato con rilettura da completare, e un esito non confermato.
Negli ultimi due casi il lotto si ferma: i file restanti sono indicati come
non avviati e non vengono ritentati automaticamente. Il medico può controllare
l'archivio prima di riprovare; non viene dichiarato un successo globale.
Lo stop volontario nello stesso contesto conserva i file già confermati,
segnala l'esito non ancora confermato del file in corso e lascia i restanti
non avviati. Un ack utile ancora ricevuto può confermare quel file; una
cancellazione non dimostra che non sia stato salvato. Cambio paziente/sessione,
background e uscita cancellano invece nomi ed esiti per riservatezza. Una
risposta tardiva non riavvia il lotto; un task precedente ancora in chiusura
impedisce un nuovo batch.

## Prove della tranche e limiti

- Build `MediFlowMobileApp` Debug per iOS Simulator ARM64 e x86_64 con
  Xcode 26.6: compilazione della libreria condivisa e della shell iPhone/iPad,
  senza avvio del simulatore.
- 113 test Node con Node 24.21.0 e archivi sintetici isolati: issuer reale e
  pairing/righe sintetici; tutti e tre i client Apple, quattro consensi,
  binding delle fonti, revoca/rotazione/logout e perimetro proposal-only.
  Nessuna generazione remota o qualifica runtime viene simulata come PASS.
- 57 test Swift mirati su macOS: modello ordinary, proiezione, decifratura
  client originaria, invalidazione e upload documentale; include batch
  sequenziale, stop all'esito incerto, ack con refresh fallito, cancellazione
  con completamento tardivo, stop dopo un successo e cambio contesto.

Comandi riusabili dal checkout, con `DEVELOPER_DIR` esplicito, Node 24 e
`MEDIFLOW_DATA_DIR` sintetica nuova:

```sh
swift test --package-path native/MediFlowMac --filter 'NativeOrdinary|PairedAttachmentImportBatch|PairedPatientsWorkspaceModelDocumentsTests|TreatmentReasoning'
node scripts/run-strip-types.mjs --test lib/security/native-inference.test.cjs lib/security/native-ordinary-content.test.cjs lib/security/native-ordinary-host-sources.test.cjs lib/chatgpt-product/native-ordinary-contract.test.cjs lib/chatgpt-product/native-ordinary-ingress.test.cjs lib/chatgpt-product/native-ordinary-function-sources.test.cjs
```

Restano da esercitare sul candidato integrato: pairing e login v3 reali,
consenso/login/catalogo/generazione/cancel per ciascuna funzione, cambio
paziente e lock durante l'attesa, background e ritorno, file validi/oversize/
non leggibili e successo parziale. Su iPad verificare tastiera, focus,
rotazione e Dynamic Type; su entrambi verificare VoiceOver e copertura nel
selettore app. Simulatori e test Mac non sostituiscono i dispositivi fisici
richiesti da WUL-589; la qualifica totale rimane in WUL-694. Lo smoke ChatGPT
reale e la disponibilità del modello appartengono a WUL-778, non alla build.

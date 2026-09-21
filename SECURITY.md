<a id="security-policy-mediflow"></a>

# Politica di sicurezza di MediFlow

MediFlow tratta **dati sanitari**: la possibilità di lavorare in locale serve a
mantenerne il controllo, ma non elimina i rischi legati all’accesso, alla
conservazione o all’uso delle informazioni. Sicurezza e privacy orientano quindi
le scelte del progetto, non sono funzioni da aggiungere a valle.

Questo documento stabilisce quali confini non debbano essere superati e quali
requisiti minimi debba rispettare chi contribuisce.

---

## 📚 Riferimenti correlati

- [ARCHITECTURE.md](./ARCHITECTURE.md) (confini architetturali stabili)
- [docs/STATE_OF_THE_SYSTEM.md](./docs/STATE_OF_THE_SYSTEM.md) (stato del sistema e limiti operativi, con le rispettive date)
- [docs/topologia-dati-flussi.md](./docs/topologia-dati-flussi.md) (percorsi dei dati e confini di fiducia)
- [docs/walkthrough.md](./docs/walkthrough.md) (flussi operativi end-to-end)
- [docs/adr/](./docs/adr/README.md) (decisioni con impatto sicurezza)
- [docs/README.md](./docs/README.md) e [docs/markdown-index.md](./docs/markdown-index.md) (mappa e indice completo documentazione)

---

## 🔒 Principi di sicurezza fondamentali

Il punto di partenza è l’uso locale: nessuna uscita verso il cloud è ammessa se
non sia stata implementata e documentata esplicitamente. Da questa scelta
discendono quattro vincoli, che restano validi anche quando una funzione sia
facoltativa o accessibile soltanto dalla macchina dell’operatore.

- **Local-first di default**: i percorsi cloud non si attivano implicitamente.
- **Cifratura a riposo**: i campi clinici sensibili devono restare cifrati lato client. Non presentare l’intero file SQLite come completamente zero-knowledge finché identificativi, metadati e backup non siano coperti dallo stesso perimetro documentato.
- **Privilegio minimo**: le API locali devono essere autenticate e il proxy deve ammettere solo le destinazioni autorizzate.
- **Nessun dato reale nella repository**: mai committare dati di pazienti, siano essi informazioni sanitarie o identificative (PHI/PII).

---

<a id="️-threat-model-alto-livello"></a>
<a id="-threat-model-alto-livello"></a>

## ⚠️ Minacce e limiti della protezione

La protezione deve considerare non soltanto l’accesso dall’applicazione, ma anche
ciò che potrebbe essere sottratto o letto al di fuori di essa. Assumiamo che un
attaccante possa ottenere il file SQLite (`medical.db`) attraverso il furto del
disco, una perdita di dati dai backup o l’accesso al filesystem; assumiamo inoltre
che possa leggere log, crash report e screenshot.

Anche il traffico localhost resta sensibile: per i client nativi evitare HTTP
in chiaro quando possibile. Non sono ancora coperti né un sistema operativo
host completamente compromesso, per esempio da malware che registri i tasti e
acceda alla memoria, né attacchi mirati al dispositivo fisico mentre
l’applicazione è sbloccata.

---

## 🗄️ Protezione dati

### Dati a riposo (SQLite)

Il dato autorevole risiede in un singolo file SQLite nella directory dati di
MediFlow. Prima della scrittura, i campi sensibili vengono cifrati **lato
client**: è questa la protezione che il progetto può dichiarare, non
l’illeggibilità dell’intero database senza PIN. Una dichiarazione più ampia
richiede un ADR e una verifica dedicata.

I valori cifrati usano il formato:

```
ENC:<iv_b64>:<cipher_b64>
```

### Decifratura fallita e conservazione del ciphertext

Se un campo `ENC:` non può essere decifrato, perché la chiave manca o il dato è
corrotto, la UI mostra `[LOCKED DATA]`. Il segnaposto serve soltanto a rendere
visibile il problema e non deve mai essere persistito.

Il testo cifrato originale, o ciphertext, viene conservato e riscritto invariato
a ogni salvataggio. In questo modo un accesso senza chiave non diventa una
perdita di dati: nessun salvataggio successivo deve sovrascrivere il dato
clinico cifrato con il segnaposto, né con una sua nuova cifratura.

<a id="cancellazione-paziente-ed-erasure"></a>

### Cancellazione del paziente ed eliminazione dei dati

Il DELETE operativo rende reversibile la rimozione del paziente: registra un
contrassegno di cancellazione, o tombstone, controllando la versione, senza
eliminare fisicamente i dati. L’erasure GDPR segue invece una procedura
amministrata dedicata, con dry-run ed esecuzione, accessibile solo da una
sessione admin web. Questa procedura registra `patient.purged`; il ripristino
esplicito registra `patient.restored`.

Poiché i pazienti rimossi logicamente restano nei backup, una richiesta di
erasure deve comprendere anche gli artefatti già esportati. La purge non li
raggiunge.

### Chiavi e PIN

Il PIN **non viene mai salvato**. Da PIN e salt viene derivata la chiave che
protegge la master key, chiamata key-encryption key (KEK). La master key è
conservata cifrata e viene decifrata solo **in memoria**, durante una sessione
attiva.

> Se cambi il modello PIN / key derivation, devi scrivere prima un ADR.

---

## 🔌 API locali

Le API separano l’accesso della UI web da quello dei client nativi e dei
dispositivi abbinati all’host. MediFlow espone tre superfici:

- `/api/*` (web UI): protetta da sessione
- `/api/v1/*` (client native): protetta da token, versionata
- `/api/v1/network/*` (home-base opt-in): richiede un dispositivo abbinato, o paired, e parte dalla sola lettura. Le scritture sono limitate a profilo/status paziente, diario, terapie, checkup e osservazioni; la protezione richiede credenziale del dispositivo e sessione dell’operatore

Regole minime:
- Mai esporre endpoint sensibili senza autenticazione.
- Mantenere `/api/v1/*` stabile e retrocompatibile.
- Il bearer token locale non equivale a una sessione amministrativa umana:
  route di sistema distruttive o amministrative richiedono session cookie con
  admin web. In particolare audit, backup export/restore, backup scheduler,
  repair DB, purge e restore paziente e start/stop MLX non devono accettare
  solo il token locale.
- Le eccezioni che riconoscono il token fuori da `/api/v1/*` servono soltanto al supporto e all’avvio locale: cataloghi locali, settings/native bootstrap, proxy AI locale, controlli locali di salute e oscuramento dei dati identificativi, panoramica di rete e stato MLX in sola lettura. Non conferiscono privilegi amministrativi generali. Ogni nuova eccezione deve documentare perché non richieda una sessione admin web.

### Trasporto

La UI web usa HTTP su localhost. Il client nativo usa invece il proxy HTTPS
locale (`:3443`) e verifica il certificato atteso mediante certificate pinning
(vedi [docs/local-api-tls.md](./docs/local-api-tls.md)).

<a id="modalita-network-home-base"></a>

### Modalità network home-base

Il passaggio a `network-home-base` rende disponibili percorsi di rete espliciti,
non un accesso remoto generale. Restano valide le seguenti condizioni:

- il funzionamento locale predefinito non cambia: la modalità di rete richiede una scelta esplicita
- disattivare la modalità non revoca i pairing salvati: ogni token paired
  diventa inerte e le route del data plane rispondono
  `403 NETWORK_MODE_DISABLED` finché la modalità non viene riattivata
- `POST /api/v1/network/pairing-intents` è il percorso di avvio privo di PHI del dispositivo
  paired
- il primo data plane remoto (`/api/v1/network/patients*`) richiede sempre
  device paired + sessione operatore
- `PUT /api/v1/network/patients/{id}` richiede inoltre capability
  `network.replica.write-patient-profile` e `version`
- `/api/v1/network/patients/{id}/entries*` richiede capability diary dedicate,
  sessione operatore e `entries.version`; abilita solo create/update/soft-delete
  del diario clinico
- `/api/v1/network/patients/{id}/therapies*` richiede capability terapia
  dedicate, sessione operatore e `therapies.version`; abilita solo
  create/update/soft-delete delle terapie
- `/api/v1/network/patients/{id}/checkups*` richiede capability checkup
  dedicate, sessione operatore e `checkups.version`; abilita solo
  create/update/soft-delete dei checkup
- `/api/v1/network/patients/{id}/observations*` richiede capability osservazioni
  dedicate, sessione operatore e `observations.version`; abilita solo
  create/update/soft-delete delle osservazioni LOINC/UCUM
- restano esclusi cancellazione fisica remota, scritture remote di allegati/documenti, cataloghi, sincronizzazione per record, campi AI/documentali e ripieghi automatici su percorsi alternativi

### Lockout autenticazione PIN

La policy canonica è definita in [docs/adr/0017-auth-lockout-policy.md](./docs/adr/0017-auth-lockout-policy.md).

- Si applica a `/api/auth/login`, condiviso tra lock screen web e unlock macOS.
- Soglia: `5` tentativi falliti nella stessa finestra di `15 minuti`.
- Durata lockout: `15 minuti`.
- Reset completo su login valido; se la finestra precedente scade, il conteggio riparte da `1`.
- Contratto risposta:
  - `401 AUTH_INVALID_CREDENTIALS` finché il lockout non è attivo
  - `423 AUTH_LOCKED` quando il lockout è attivo, con header `Retry-After`
- Il bearer token `/api/v1` già bootstrapato non introduce una policy separata: il controllo avviene sul PIN condiviso prima dell'emissione della sessione web o dell'unlock native.

<a id="integrita-del-processo-per-lacquisizione-auth-web-h1a"></a>

### Integrità del processo di autenticazione web H1a

L’acquisizione privata H1a descritta in
[ADR 0105](./docs/adr/0105-web-auth-process-integrity-assumption.md) presuppone un
processo server fidato: né gli input della richiesta né gli adapter possono
modificare i prototype globali o alterare a runtime il codice dello stesso
processo. Se una contaminazione è già presente all’ingresso, o compare durante
una chiamata sincrona osservata, l’acquisizione deve essere negata senza
pubblicare la sessione né il titolare della proiezione, il projection owner.

Resta un rischio per la disponibilità. Una mutazione persistente e concorrente
di `Object.prototype.then`, durante la risoluzione della Promise nativa di
`cookies()`, può impedire l’acquisizione; non deve però produrre un contesto
autenticato, un’autorità recuperabile o lavoro successivo al diniego. Il rischio
va riprovato sul tree integrato H1b e nell’audit di sicurezza dell’esatto
candidato di release.

L’assunzione non copre un host compromesso, dipendenze malevole o plugin non
fidati eseguiti nello stesso processo. Non dimostra né l’intera catena di
autenticazione né la sicurezza generale del prodotto.

---

## 🧱 Proxy verso servizi locali (sicurezza SSRF)

Alcuni endpoint inoltrano richieste a servizi locali, per esempio Ollama. Perché
questa funzione non diventi un accesso a destinazioni arbitrarie, il proxy deve
rispettare tre regole minime:

- Permettere solo target **localhost / 127.0.0.1**.
- Permettere solo porte previste.
- Trattare ogni risposta come input non fidato.

## 🤖 Fabric locale e import clinico guidato

MediFlow deve poter essere usato anche senza AI. La Fabric organizza le funzioni
intelligenti facoltative e i relativi controlli; non trasferisce al modello la
responsabilità di modificare la cartella. I quattro percorsi della 0.8.5 sono
Patient Insight, Smart Import, Document Synthesis e Treatment Reasoning. Quando
leggono note del paziente, diario clinico o documenti analizzati, devono
rispettare anche queste regole:

- usare solo provider risolti dal punto di composizione di produzione sotto il controllo dell’host, il production root; i provider remoti richiedono un ciclo di vita attivo e una scelta esplicita
- trattare l'output del modello come **non fidato** finché un operatore non lo conferma
- non eseguire import silenziosi da testo libero verso diagnosi o terapie
- mantenere review esplicita prima di scrivere nuovi dati strutturati in scheda
- trattare `summarySnapshot` e `parseEvidenceArtifactSnapshot` degli allegati
  come artifact clinici locali, non come payload innocui di debug
- rendere visibili ricevuta di esecuzione, provenienza e validità rispetto alle fonti correnti, senza esporre prompt, output grezzo, credenziali o testo clinico
- rifiutare provider, modello, endpoint, venue, prompt, fallback o apply forniti
  dal caller

Anche quando un documento riporti un codice ICD esplicito, la diagnosi estratta
resta una proposta da rivedere. Per questo il payload automatico della sintesi
non include `patients.diagnoses` (vedi ADR 0084).

Quando siano configurati, Ollama serve Patient Insight, Smart Import e Document
Synthesis, mentre ATHENA su MLX serve soltanto Treatment Reasoning. L’host governa
separatamente i due cicli di vita: stato, revoca, autorizzazioni o percorsi
alternativi di un provider non valgono per l’altro. Gli adapter OpenAI e
Anthropic restano `default OFF` e non intervengono come ripiego automatico.

ATHENA richiede che runner e artefatto del modello siano locali. L’impostazione
controllata dall’host `MEDIFLOW_ATHENA_MLX_GENERATE_BIN` accetta soltanto un
percorso assoluto a `mlx_lm.generate`, senza argomenti, shell o risoluzione di
pacchetti. Il launcher `uvx` predefinito forza la modalità offline: se la cache
necessaria manca, interrompe l’operazione invece di cercare un’alternativa.
Avere il runner non dimostra quindi che ATHENA sia pronta in ogni ambiente.

AnyDoc è il primo passaggio automatico locale degli allegati e lavora in un
processo figlio con limiti di esecuzione e senza rete. Per i PDF supportati,
vengono classificate e materializzate soltanto le pagine `needsOcr`, poi
renderizzate e trattate da Apple Vision in locale, con rete negata. Il risultato
viene ricomposto conservando ordine, provenienza e hash e pubblicato soltanto
se la sorgente è ancora corrente. In presenza di errori, formati ambigui,
documenti cifrati o motore indisponibile, il percorso si arresta senza aggirare
i controlli.

DeepSeek-OCR 2/CUDA, benchmark di qualifica e readiness universale hanno stato
`OUT_OF_SCOPE_FOR_0.8.5_NON_BLOCKING`. Le route OCR legacy, dopo
l'autenticazione, rispondono `410`.

### Application Services e Headless

Gli adapter Fabric/Headless e le route sottili del perimetro 0.8.5 non accedono
direttamente al database: passano dai production root e dagli Application
Services controllati dall’host. È qui che si verificano validità del contesto e
autorizzazioni e si governano conflitti, transazioni e audit. Alcune route web
storiche importano ancora `dbServer`: la separazione descritta non va estesa a
esse per analogia. Anche la ricevuta Fabric ha un limite preciso: documenta
un’esecuzione, ma non concede un’autorizzazione.

Il Supervisor Node locale di produzione avvia Web standalone e MCP in processi
figli distinti, autenticati attraverso il canale IPC privato ereditato. Governa
contesto, finalità, ambito, durata dell’autorizzazione, revoca e audit. MCP
`stdio` e Mini espongono soltanto catalogo, ricerca terminologica locale,
lettura delle Open Loops del paziente selezionato, proposta di follow-up
`proposal_only` e interrogazione semantica limitata alla sola lettura.

Gli agenti usano dunque comandi MediFlow mediati: nessun adapter importa il
database, accetta autorità dal chiamante o apre un proprio listener. Il
candidato non autorizza sessioni agentiche generali e non dichiara installer,
onboarding o compatibilità con host MCP esterni.

F10 espone via MCP soltanto l’anteprima `pending -> completed|cancelled`. Prima
di confermare la scrittura, la UI web fidata rilegge la risorsa e richiede ruolo
medico attivo, verifica aggiuntiva dell’identità e gesto riferito a quella
specifica operazione. Il commit mantiene CAS, idempotenza, audit e ricevuta
atomici. Né la prova autorizzativa né il commit attraversano MCP; replay,
revoca, logout o cambio di selezione negano l’operazione.

Il planner semantico, collegato al Supervisor, resta in sola lettura. Può
eseguire al massimo due operazioni scelte da un insieme chiuso e autorizzato:
ricerca terminologica e Open Loops del paziente in contesto. Non produce SQL
libero, non importa il database e non supera finalità, ambito, budget o validità
del contesto stabiliti dall’host.

Su macOS 26 o successivo, la registrazione usa API Apple sul dispositivo, con
consenso e permessi espliciti. L’audio resta entro limiti definiti e soltanto in
RAM; la trascrizione entra nella bozza solo dopo la revisione. Non esiste una
scrittura clinica automatica. Le verifiche con microfono reale e la validazione
clinica restano fuori da quanto attestato dal candidato.

Questa distinzione chiarisce anche i due modelli architetturali. In
provider-in-MediFlow, la Fabric governa un provider al servizio di una funzione
applicativa; in MediFlow-in-intelligent-host, MCP/Mini raggiungono gli
Application Services governati attraverso RPC AIP ereditato. Il secondo modello
resta candidato e non autorizza installer, onboarding, sessioni agentiche
generali, listener o accesso diretto a SQLite.

### Modello provider F7

Scegliere un provider non significa avergli già assegnato un modello, una
credenziale e il permesso di svolgere ogni funzione. Il modello provider v2
separa perciò tipo di provider, istanza, autenticazione, modello, capacità,
gruppi, associazioni e insieme delle funzioni ammesse. Anche le classi di
credenziale restano distinte: `local_model`, `api_key`, `provider_oauth`
ufficiale e `host_subscription`. Nessuna implica le altre.

Un login consumer o un abbonamento non è, da solo, una credenziale di inferenza.
Un flusso `provider_oauth` deve essere ufficiale, documentato dal provider e
separato dalle sessioni consumer: token estratti, OAuth privati e protocolli
ricostruiti non sono ammessi.

Sono integrati gli adapter HTTPS ufficiali e la prova amministrativa Document
Synthesis, il cui risultato resta da rivedere. La route è riservata agli admin,
richiede l’intento esatto `run_synthetic_nonclinical_probe` e resta
`default OFF`. Ogni uso richiede un riferimento al segreto, un ciclo di vita
attivo e regole di uscita e conservazione dei dati governate dall’host. I test
simulano il trasporto: il candidato non prova credenziali né connessioni reali.

<a id="readiness-dei-provider-locali"></a>

### Disponibilità e verifica dei provider locali

[ADR 0092](./docs/adr/0092-limite-digest-bound-readiness-ai-locale.md) definisce
l'annotazione `available_unqualified` per i percorsi Ollama correnti.

L’annotazione descrive ciò che si sa sulla disponibilità e sulle relative
prove; non è uno stato operativo e non sostituisce `runtime`. Il fatto che un
modello sia locale, abbia un nome o presenti un determinato digest non dimostra
che sappia svolgere una funzione. Il confronto del digest prima e dopo
l’inferenza rileva alcune variazioni, ma non impedisce una sostituzione ABA,
con ritorno al modello iniziale durante l’esecuzione.

Né una ricevuta né una dichiarazione di tipo autorizzano un componente
consumatore. La qualificazione della disponibilità resta bloccata. ATHENA
mantiene attestazione, interruttore di arresto e ciclo di vita propri: il
runtime MLX generico usato per amministrazione e benchmark non ne prova la
disponibilità qualificata.

`clinical_application` e `engineering_operator` non condividono grant.

Nello stato documentato, iPhone e iPad usano l’host abbinato e non invocano
direttamente i provider. Un ADR successivo potrà definire capacità Apple sul
dispositivo: la descrizione attuale non le vieta.

Allo stesso modo, un endpoint loopback non dimostra `egress=none`. Un futuro
controllo di esecuzione esclusivamente locale deve verificare modello locale,
cloud disabilitato, strumenti, rete e processo. Le nuove API manterranno timeout
e annullamento interni, non accetteranno `AbortSignal` dal chiamante e
scarteranno i completamenti tardivi.

ADR 0092 non definisce il contratto Intelligence Fabric. ADR 0094 governa le
capability 0.8.5, le venue, i production root e l'assenza di authority caller.

> [!IMPORTANT]
> I quattro flussi AI clinici (patient-insight, smart-import,
> document-synthesis e treatment-reasoning) restano subordinati ai controlli
> di sicurezza, all’interruttore di arresto e alla governance dei modelli per
> le decisioni documentali. Nei percorsi AI locali la revisione viene prima
> dell’uso: nessuna scrittura clinica autonoma.

## ⚠️ Provider remoti con opt-in obbligatorio

Gli adapter ufficiali OpenAI e Anthropic dispongono di una prova amministrativa
con revisione del risultato. Per usarla servono sessione admin e intento
esatto; provider e uscita dei dati restano OFF se l’host non abbia autorizzato
esplicitamente entrambi. Quando è disabilitata, la factory non legge le
credenziali. Il trasporto simulato dei test non prova connessioni reali,
account, politiche di conservazione o idoneità al trattamento di dati clinici:
il comportamento predefinito resta `local-first`.

Regole minime:

- resta OFF senza opt-in provider ed egress espliciti
- usa soltanto la data class ammessa dalla policy host-owned
- non riceve authority clinica e non può generare apply automatici
- non espone segreti, prompt, output clinico o raw response in receipt e log
- non autorizza claim di zero retention senza prova dell'account

---

<a id="-logging-e-redazione"></a>

## 🔒 Log e oscuramento dei dati identificativi

I log servono a capire che cosa sia accaduto, non a ricostruire il contenuto
clinico: i dati sanitari non devono trapelare attraverso di essi. Gli
identificativi vanno oscurati secondo il contesto d’uso.

Il catalogo di riferimento per gli eventi di audit è definito in
[docs/adr/0015-audit-taxonomy-minimum-catalog.md](./docs/adr/0015-audit-taxonomy-minimum-catalog.md).

<a id="audit-record-vs-log-applicativi"></a>

### Distinzione tra audit e log applicativi

Le registrazioni di audit sono strutturate, versionate e ammettono soltanto
aggiunte, senza riscritture. I log applicativi devono contenere meno
informazioni e limitarsi ai dati tecnici con identificativi oscurati. Un log
testuale libero non deve sostituire il catalogo di audit.

<a id="non-loggare"></a>

### Dati da non registrare nei log
- campi paziente decifrati
- testo estratto dai documenti o contenuto OCR storico
- testo note/diario usato nei prompt AI
- suggerimenti clinici grezzi prima della conferma utente
- allegati caricati (base64)
- `summarySnapshot` o `parseEvidenceArtifactSnapshot` grezzi
- token, PIN, chiavi o salt
- prompt AI completi, risposte AI grezze e descrizioni cliniche prive di oscuramento degli identificativi

<a id="puoi-loggare-preferibile"></a>

### Dati preferibili per i log
- conteggi (es. numero record)
- timing (latenza)
- status code / classi di errore
- identificatori oscurati (es. primi 6 caratteri di un id)
- numeri di versione e flag booleane
- nomi di superfici tecniche (`web`, `native`, `api`, `job`)

### Audit v1

Quando implementi o estendi il writer audit:

- usa il catalogo `audit.v1` dell'ADR 0015
- consenti solo `eventType`, `outcome`, `actorRef`, `subjectRef` con identificativi oscurati, `sourceSurface`, timestamp e metadati strutturati
- mantieni fuori dal catalogo qualsiasi testo libero, payload clinico o
  informazione necessaria solo al rendering UI
- se un valore può identificare un paziente al di fuori del database locale, oscuralo o calcolane l’hash prima di registrarlo nei log o esportarlo

Ogni nuovo log va scritto assumendo che possa finire in un crash report:
deve contenere il minimo necessario per capire il problema e intervenire.

---

## 🔑 Gestione segreti

Non committare `.env` con valori reali. Se introduci variabili d’ambiente,
documentale nei file pertinenti (`docs/native-setup.md` o README/CONTRIBUTING)
ed evita di richiedere segreti per l’uso locale predefinito.

---

<a id="-dependency-e-security-checks"></a>

## 🧪 Controlli sulle dipendenze e sulla sicurezza

Prima di una release o di un merge rilevante, si consigliano i seguenti
controlli:

```bash
npm run lint
npm run build
npm audit
npm run check:never-regress
npx tsc --noEmit
```

Opzionali (se usati nella toolchain):
- secret scanning (es. gitleaks)
- SAST / dependency auditing in CI

---

## ⚠️ Segnalazione vulnerabilità

Se ritieni di aver trovato una vulnerabilità, preferisci un canale riservato,
come GitHub Security Advisories / Security tab, quando disponibile. Se non lo
è, apri una issue **senza dettagli sensibili**: descrivi impatto e area
coinvolta, fornisci i passi minimi per riprodurre il problema e non includere
dati reali, token o payload decifrati.

La segnalazione deve sempre indicare versione o commit interessato, scenario
d’attacco e differenza tra comportamento atteso e osservato.

# ADR 0111: routing OCR selettivo per pagina con DeepSeek-OCR 2

Date: 2026-09-01
Status: Accepted

Issue: [GitHub #278](https://github.com/Wulfgardr/mediflow/issues/278)

Program line: candidata `0.8.5`, packet `F6`

Related: [ADR 0088](./0088-deterministic-pdf-page-router.md),
[ADR 0092](./0092-limite-digest-bound-readiness-ai-locale.md),
[ADR 0099](./0099-ocr-document-locator-and-source-currentness.md),
[ADR 0107](./0107-anydoc-local-attachment-extraction.md) e
[ADR 0110](./0110-riapertura-governata-programma-intelligente-085.md).

## Problema

AnyDoc estrae localmente il testo utile degli allegati. Nel tree corrente una
pagina priva di testo utile porta l'intero documento a revisione manuale. La
riapertura governata della `0.8.5` richiede DeepSeek-OCR 2 solo per le pagine
che ne hanno bisogno, senza inviare al modello le pagine native e senza
riattivare la filiera OCR ritirata.

Una semplice chiamata al modello non basta. Il packet deve legare routing,
sorgente corrente, artifact eseguibili, profilo hardware, qualità e
ricomposizione. Deve inoltre fallire chiuso quando una sola di queste prove
manca.

## Precedenza e stato

Questo ADR dettaglia soltanto il packet `F6` riaperto da ADR 0110.

- Conserva da ADR 0107 AnyDoc come ingresso unico per l'estrazione locale e
  come autorità della decisione per pagina.
- Sostituisce soltanto l'esito manuale terminale delle pagine che AnyDoc marca
  positivamente `needsOcr`.
- Conserva da ADR 0099 la sorgente host-owned, il locator volatile monouso e i
  controlli di currentness.
- Non riattiva la capability terminale `ocr`, le route legacy o i provider
  storici. Introduce la nuova identità versionata
  `mediflow.ocr.deepseek_ocr2.page.v1`.

L'accettazione non consegna adapter, modello, supporto hardware, benchmark o
runtime. Fino ai gate di questo ADR, scansioni e immagini continuano a
richiedere revisione manuale.

## Decisione

DeepSeek-OCR 2 diventa una continuazione locale e selettiva del percorso
AnyDoc. Il caller chiede l'estrazione dell'allegato corrente; non può chiedere
OCR, scegliere pagine, modello, runner, profilo hardware o fallback.

La sequenza vincolante è:

```text
allegato corrente host-owned
  -> locator monouso e currentness ADR 0099
  -> decisione AnyDoc per pagina
  -> testo nativo per le pagine utili
  -> rendering solo delle pagine needsOcr
  -> DeepSeek-OCR 2 locale pin-by-digest
  -> validazione deterministica per pagina
  -> ricomposizione ordinata e completa
  -> evidenza review-only, writes=0, apply=none
```

### Routing governato da AnyDoc

Nel pacchetto `@firecrawl/anydoc@0.2.4` fissato dal tree, la conversione di un
PDF misto non restituisce Markdown parziale: rigetta con un `NeedsOcrError` che
espone soltanto `pages` 1-based e `pageCount`. Questi due campi sono l'autorita
del routing, ma non contengono il testo delle altre pagine. L'adapter non deve
quindi inventare un risultato page-level da un output che AnyDoc non produce.

Quando `pages` non e vuoto, un materializzatore deterministico e
dependency-pinned separa il PDF in pagine singole senza estrarne testo e senza
decidere il routing. Per ogni indice non presente in `pages`, AnyDoc viene
eseguito sul PDF di una sola pagina per ottenere il testo nativo; per gli
indici presenti in `pages`, soltanto il renderer produce l'input ammesso al
modello. Numero, ordine e corrispondenza con `pageCount` vengono riconfermati.
Un disaccordo tra il segnale sul documento e l'esito della pagina isolata
termina in `review_required` per l'intero documento.

Il materializzatore e un boundary proprio: libreria, versione, lock, limiti e
digest devono essere revisionati nel packet che lo introduce. Non puo
estrarre testo, correggere pagine, rasterizzare silenziosamente o diventare un
router alternativo. Il worker corrente, che riduce `needsOcr` al solo exit code
`21`, non soddisfa il contratto perche perde `pages` e `pageCount`; deve essere
esteso o affiancato da un envelope bounded prima dell'integrazione runtime.

Il primo segnale sul PDF assegna gli indici presenti in `pages` a `needsOcr` e
il complemento a `native_unmaterialized`: quest'ultimo nome registra soltanto
che AnyDoc non ha segnalato OCR, non che esista gia testo nativo. Dopo la
materializzazione e la conversione AnyDoc della singola pagina, il solo esito
positivo diventa `native`.

Al termine della materializzazione, ogni pagina PDF ha un indice 1-based e uno
dei soli tre esiti pubblicabili:

- `native`: il testo utile viene conservato e la pagina non viene renderizzata
  per il modello;
- `needsOcr`: la pagina è ammessa al renderer e a DeepSeek-OCR 2;
- `review_required`: l'estrazione non è affidabile o supera un limite; la
  pagina e l'intero documento vengono negati alla ricomposizione automatica.

Solo un esito positivo `needsOcr` autorizza l'ammissione tecnica della pagina.
Errore del parser, documento cifrato o malformato, limite di risorsa, pagina
mancante e risultato ambiguo non vengono convertiti in `needsOcr`.

Il contratto v1 copre soltanto PDF con ordine pagina stabile. Le immagini
singole non sono un formato ammesso da AnyDoc 0.2.4 e restano a revisione
manuale finche un ADR successivo non definisce un'autorita di routing distinta.
Gli altri formati senza una mappa di pagina stabile restano sul percorso
AnyDoc nativo o a revisione manuale; non vengono rasterizzati in modo
implicito.

### Sorgente, pagina e ricevuta

Il nodo risolve i byte e la currentness. Il caller non fornisce attachment ID,
hash, revisione o locator come autorità. Prima del rendering e prima della
pubblicazione, lo stesso owner verifica:

- `documentSourceRef`;
- `documentRevision`;
- `documentFreshnessEpoch`;
- hash SHA-256 dei byte sorgente;
- ordine e numero totale delle pagine.

Ogni pagina produce una ricevuta PHI-safe con almeno:

- indice pagina, esito AnyDoc e motivo di ammissione;
- hash dell'input renderizzato e digest del renderer;
- identità del runtime profile;
- digest di codice, runner, lock dipendenze, configurazione, modello e pesi;
- hash dell'output normalizzato, versione del validatore e qualità misurata;
- esito, durata bounded e classe di risorsa, senza testo o percorso locale.

La ricevuta di ricomposizione contiene il source binding corrente, la sequenza
ordinata degli hash nativi e OCR, gli ID delle ricevute pagina, l'hash del
risultato e l'esito complessivo. Non contiene testo clinico, prompt, immagini,
segreti o identificativi paziente. Una ricevuta descrive un'esecuzione; non è
authority e non autorizza apply.

### Artifact ufficiali e pin-by-digest

Il solo upstream ammesso è il repository ufficiale
[DeepSeek-OCR-2](https://github.com/deepseek-ai/DeepSeek-OCR-2) con il relativo
[modello ufficiale](https://huggingface.co/deepseek-ai/DeepSeek-OCR-2).
L'abilitazione richiede un manifest locale immutabile che fissi:

- commit upstream e SHA-256 dell'archive sorgente revisionato;
- SHA-256 di ogni artifact modello e peso;
- SHA-256 del runner, del lock dipendenze e della configurazione;
- licenza osservata per ciascun artifact e procedura di provenienza;
- versione del renderer e del normalizzatore.

Il runtime non scarica codice, modelli o dipendenze. Non usa un tag mobile,
`latest`, un nome modello generico o un daemon Ollama. Se l'upstream richiede
moduli Python custom, questi vengono revisionati, fissati nel manifest e
provisionati localmente; il caricamento dinamico remoto e
`trust_remote_code` restano disabilitati durante l'esecuzione.

Il controllo dei digest determina l'insieme di artifact ammesso. Non viene
presentato come prova causale su un host compromesso e non supera il limite di
readiness di ADR 0092.

### Contratto runtime e hardware

Al `2026-09-01` il
[model card ufficiale](https://huggingface.co/deepseek-ai/DeepSeek-OCR-2)
dichiara licenza Apache-2.0 e inferenza Transformers su GPU NVIDIA, con percorso
testato su Python 3.12.9, CUDA 11.8, PyTorch 2.6.0 e FlashAttention 2.7.3. Il
runner di esempio invoca esplicitamente `.cuda()`. Queste sono dichiarazioni
upstream osservate, non una qualifica MediFlow.

Il preflight dell'host corrente rileva `Mac16,5`, Apple M4 Max `arm64`, 36 GB di
memoria unificata, Metal 4, macOS 27.0 e Python 3.14.7; non rileva `nvidia-smi`
o `nvcc`. L'upstream ufficiale non documenta in quel model card un percorso
Metal/Apple Silicon. L'host corrente non e quindi compatibile con il percorso
CUDA ufficiale e testato e non puo qualificare il primo runtime profile.

Il gate hardware della slice e pertanto
`HOLD_HARDWARE_UPSTREAM_RUNTIME`: il collegamento del volume Xcode non cambia
backend, driver o compatibilita del modello. Il gate puo chiudersi soltanto con
un host locale compatibile con il percorso upstream fissato, oppure con un
adattamento Apple separatamente revisionato, manifestato e benchmarkato che
non venga rappresentato come runtime upstream gia supportato.

DeepSeek-OCR 2 resta disabilitato finché non esiste almeno un
`runtimeProfileId` qualificato sullo stesso tree e sugli stessi digest. Ogni
profilo dichiara in modo immutabile:

- sistema operativo, architettura, runtime Python e backend di calcolo;
- acceleratore ammesso e versioni driver/runtime, oppure `cpu` esplicito;
- RAM, VRAM e spazio temporaneo minimi;
- byte, pagine, pixel e dimensioni massime dell'input;
- timeout di pagina e documento, memoria residente massima e output massimo;
- concorrenza, fissata a `1` finché un benchmark separato non qualifica un
  valore maggiore;
- digest del pacchetto artifact e del benchmark che qualifica il profilo.

I valori numerici appartengono al manifest versionato e devono essere fissati
prima del benchmark. Un campo assente, un digest diverso o hardware non
allowlisted produce `runtime_profile_unqualified` e revisione manuale.

Non esistono selezione `auto`, passaggio trasparente fra CPU e acceleratore,
fallback Apple Vision, fallback Ollama, provider remoto o profilo alternativo.
Un profilo diverso richiede manifest e benchmark propri.

Il runner usa un processo figlio bounded con ambiente allowlisted, directory
temporanea dedicata, artifact read-only e rete negata. Non accetta shell,
argomenti liberi, endpoint, model ID o `AbortSignal` dal caller. Timeout e
terminazione appartengono all'host; ogni completamento tardivo viene scartato.

### Validazione e ricomposizione

Il validatore di qualità è deterministico e versionato. Non usa una
autovalutazione del modello come unico segnale. Algoritmo, scala e soglia
minima vengono congelati nel manifest prima del benchmark.

La ricomposizione conserva l'ordine originale:

- usa il testo AnyDoc soltanto per le pagine `native`;
- usa l'output validato DeepSeek-OCR 2 soltanto per le pagine `needsOcr`;
- richiede una e una sola pagina risultante per ogni indice atteso;
- non pubblica testo parziale e non avvia consumer downstream se manca una
  pagina o se la currentness è cambiata.

Digest non valido, profilo non qualificato, timeout, terminazione, memoria
esaurita, output malformato, qualità assente o sotto soglia e ricomposizione
incompleta terminano in revisione manuale. Non viene tentato un altro runtime.

## Benchmark sintetico italiano

La promozione richiede un corpus versionato composto soltanto da documenti
italiani sintetici. Deve includere almeno PDF nativi, scansioni, documenti
misti, scansione tardiva, pagine ruotate, rumore, tabelle, moduli, accenti,
date, quantità e codici interamente fittizi.

Il manifest del corpus fissa prima dell'esecuzione:

- split e hash delle fixture e del ground truth;
- soglie per false negative di routing, CER, WER ed exact match dei campi
  strutturati sintetici;
- completezza, ordine e preservazione delle pagine native;
- soglia del validatore runtime;
- limiti di latenza, memoria e dimensione per ciascun runtime profile.

Il gate richiede zero pagine OCR necessarie omesse dal router, zero pagine
native inviate al modello, ricomposizione completa e rispetto di tutte le
soglie pre-dichiarate. Il report registra tree SHA, artifact digest, profilo
hardware, comandi ed esiti senza contenuto delle fixture.

Un benchmark verde misura il corpus e il profilo esatti. Non dimostra qualità
clinica generale, supporto su altro hardware o readiness di release.

## Riuso storico consentito

Il router per pagina di ADR 0088 e il bridge/receipt O4 della precedente linea
OCR sono riferimenti concettuali per ordine, limiti, currentness e receipt.
In particolare, i commit storici
`e37c94d63535e77b1c3dbf1cdc37a10df9c8a0e5` e
`658f916bb1f2c07f1b952b128e0ea253759f610a` non sono ancestry richiesta né
componenti riusabili byte-exact.

Non vengono ripristinati `@firecrawl/pdf-inspector`, PDF.js come fallback,
Ollama OCR, `deepseek-ocr` v1, code storiche, replay legacy o route ritirate.
Ogni eventuale codice ripreso richiede una nuova review sul contratto presente.

## Conseguenze

- Le pagine native evitano rendering e modello.
- I documenti misti possono essere completi senza perdere il testo nativo.
- Il supporto è più stretto: hardware e artifact non qualificati tornano a
  revisione manuale.
- Ogni nuovo profilo hardware richiede un benchmark separato.
- Receipt e digest aumentano la tracciabilità, senza creare authority o un
  claim di origine causale assoluta.

## First thin slice e gate

La prima slice usa fixture sintetiche e un solo runtime profile:

1. introdurre i contratti pagina, manifest, profilo e receipt;
2. conservare `NeedsOcrError.pages/pageCount`, introdurre il materializzatore
   PDF revisionato e rieseguire AnyDoc soltanto sulle pagine native isolate;
3. integrare renderer e runner ufficiale pin-by-digest, offline e bounded;
4. ricomporre un PDF misto con pagine native e `needsOcr`;
5. eseguire unit test di admissione e denial, E2E di ricomposizione e benchmark
   sintetico italiano sullo stesso tree;
6. verificare che `/api/ocr/extract`, `/api/pdf-extract` e i replay legacy
   restino auth-first `410` e non importino il nuovo runner.

Prima dell'enable devono passare anche i casi di digest mismatch, source race,
locator riusato, profilo non qualificato, timeout, memoria esaurita, output
malformato, qualità sotto soglia, pagina mancante, tentativo di rete negato e
completamento tardivo.

## Regole di arresto

Fermare il packet se:

- una pagina non `needsOcr` raggiunge il modello;
- il complemento di `NeedsOcrError.pages` viene trattato come testo parziale o
  promosso da `native_unmaterialized` senza una conversione AnyDoc isolata;
- DeepSeek-OCR 2 o il caller decide il routing;
- compare download runtime, egress, endpoint remoto o custom code non fissato;
- un tag o nome sostituisce un digest verificato;
- hardware non qualificato avvia il runner o viene selezionato un fallback;
- una route legacy, replay o coda storica torna eseguibile;
- una receipt contiene PHI/PII, testo, immagini, percorsi o segreti;
- una ricomposizione parziale raggiunge Document Synthesis o altri consumer;
- source binding, currentness, review, `writes=0` o `apply=none` vengono
  aggirati;
- test o benchmark usano dati reali.

## Non-obiettivi e claim ceiling

Questo ADR non implementa runtime, provisioning, route, UI, schema, backup,
provider cloud, apply clinico o supporto hardware universale. Non autorizza
Apple Vision, Ollama OCR, le route legacy o un consumer paired diretto.

Il claim massimo fino al completamento dei gate è: **contratto accettato per OCR
locale selettivo per pagina con AnyDoc come router e DeepSeek-OCR 2 ufficiale
pin-by-digest; nessun nuovo runtime o profilo hardware è ancora consegnato**.

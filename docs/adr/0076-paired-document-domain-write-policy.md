# ADR 0076: policy di scrittura del dominio documentale per il client paired

Date: 2026-07-10
Status: Accepted

## Problema

La postura write del boundary paired esclude da sempre le scritture AI e
document-derived: la formula "campi AI/document-derived e provenance
documentale restano fuori" e ripetuta in ogni ADR di famiglia write
([ADR 0052](./0052-network-patient-profile-write-boundary.md),
[ADR 0054](./0054-network-therapy-write-boundary.md) e successivi) e il
boundary del diario la applica oggi con un rifiuto 403 esplicito sia sui campi
AI (`aiSummary`, `documentInsights`, `documentInsightId`, `sourceDocumentId`)
sia sul campo `attachments` non vuoto (`lib/network-entry-write.ts`).

La Wave 5 della parita del client universale Apple porta il dominio
documenti e le superfici AI-adiacenti sul client nativo. Senza una decisione
dedicata queste superfici nascono view-only e la parita documentale resta
nulla: un medico non puo caricare un referto dal telefono, che e il caso
d'uso a piu alto valore dell'intera ondata. Questo ADR e la decisione
dedicata che la postura richiedeva.

## Contesto

Fatti verificati sul tip della lane (Wave 4):

- Gli allegati vivono nella tabella `attachments`: i byte stanno nella
  colonna `data` come stringa base64 sigillata `ENC:` dal client insieme a
  `name` e `path`; l'host non decifra e valida solo pattern e dimensione
  reale del payload (`lib/attachment-payload.ts`,
  `app/api/attachments/route.ts`). Il limite host e
  `MEDIFLOW_ATTACHMENT_MAX_BYTES` (default 25 MB).
- Il PUT host sugli allegati aggiorna solo campi document-derived:
  `summarySnapshot`, `parseEvidenceArtifactSnapshot` e lo stato della coda
  OCR con state machine dedicata (`app/api/attachments/[id]/route.ts`,
  `lib/domain/documents/document-ocr-queue.ts`). Il DELETE e un hard delete
  e la tabella non ha colonna `version`.
- L'estrazione OCR gira interamente lato client web (`lib/pdf-service`);
  l'host riceve al massimo testo gia estratto e hash del documento tramite
  l'endpoint di replay, mai il documento grezzo.
- `documentInsights` e un campo `ENC:` del record paziente: ogni sua
  mutazione e una scrittura document-derived sul paziente.
- I quattro kill switch AI (`aiPatientInsightKillSwitch`,
  `aiDocumentSynthesisKillSwitch`, `aiSmartImportKillSwitch`,
  `aiTreatmentReasoningKillSwitch`) sono righe della tabella `settings`
  raggiunta via `ApiTable('/api/settings')`, quindi sono leggibili anche
  dall'host SQLite. `GET /api/v1/network/ai-runtime` oggi richiede solo
  `requireLocalApiToken`, non riporta i kill switch e la lista `surfaces`
  non include treatment-reasoning.
- `/api/visit-session/draft` e un compute deterministico: regex ed
  euristiche testuali piu una ricerca sul catalogo farmaci locale, nessuna
  invocazione di modello, nessuna scrittura su database
  (`lib/visit-transcript-draft.ts`). Il piano ondate lo chiamava "bozza AI"
  ma l'implementazione non lo e.
- Il contenuto delle voci di diario e HTML sigillato `ENC:`: il server non
  puo sanitizzarlo. La sanitizzazione avviene solo nei client, con allowlist
  condivisa in `lib/clinical-rich-text.ts`.
- [ADR 0073](./0073-treatment-reasoning-athena-boundary.md) definisce la
  tassonomia `review_only` / `form_prefill_only` / `no_write` per le
  proposte AI: nessuna promozione implicita a scrittura.

## Opzioni

1. Mantenere l'intero dominio view-only sul client paired, come previsto dal
   piano in assenza di decisione.
2. Sbloccare il dominio per intero: upload, curation degli insight, replay
   OCR, applicazione Smart Import dal client paired.
3. Classificare le scritture per origine del contenuto e sbloccare solo le
   classi compatibili con la postura: contenuto manuale e compute senza
   persistenza si, artefatti document-derived e invocazione AI no.

## Trade-off

- Opzione 1: zero rischio ma parita documentale nulla; il gap piu sentito
  della matrice resta aperto e la Wave 5 si riduce a viste read-only.
- Opzione 2: massima parita ma viola lo spirito della postura (l'host
  diventerebbe bersaglio di scritture AI remote), moltiplica le superfici di
  audit e obbliga a risolvere subito concurrency e soft-delete su una
  tabella che non li ha.
- Opzione 3: parita reale dove il contenuto e responsabilita diretta del
  medico, nessuna apertura del piano AI, costo contenuto in guardie nuove e
  validazione dei riferimenti. E la linea coerente con ADR 0073 e con la
  distinzione gia operante tra contenuto manuale e derivato.

## Decisione

Adottare l'opzione 3. Le scritture del dominio documentale si classificano
in cinque classi normative; ogni route boundary nuova o estesa dichiara la
classe che serve.

**Classe A, contenuto documentale manuale: CONSENTITA.** Il client paired
puo creare allegati tramite una nuova famiglia di capability documenti
(lettura e create separate). I campi `name`, `path` e `data` viaggiano
sigillati `ENC:` e la route li rifiuta se arrivano in chiaro; `patientId`
deve riferire un paziente attivo dello scope. Il limite di dimensione e
quello wire dell'host sul payload cifrato (Content-Length e byte del
valore sigillato): i byte raw del file non sono verificabili da un host
keyless, `size` resta un metadato dichiarato dal client come sul web, e il
precheck del client stima l'overhead di base64 e sigillo prima dell'invio.
Niente PUT paired (l'intera superficie PUT host e
document-derived) e niente DELETE paired (hard delete, escluso dalla
postura): curation e cancellazione restano su host e web.

**Classe B, riferimenti da record clinici manuali ad allegati:
CONSENTITA come campo sigillato.** Il campo `attachments` delle voci di
diario e cifrato dal client come ogni campo clinico `ENC:`: un host keyless
non puo leggere gli id riferiti, quindi la validazione di ownership
server-side e impossibile senza rompere la cifratura o duplicare i legami
in chiaro. Il rifiuto 403 sul campo non vuoto viene sostituito da una
guardia di sigillo: il valore o e vuoto o e sigillato `ENC:`, mai un array
in chiaro nella colonna cifrata. La validazione di ownership (ogni id
riferito esiste ed appartiene allo stesso paziente della voce) e
responsabilita del client che detiene le chiavi, eseguita prima del
sigillo e dimostrata da test nativi dedicati. Restano vietati per presenza
tutti i campi AI/document-derived delle voci.

**Classe C, artefatti document-derived: ESCLUSA.** `summarySnapshot`,
`parseEvidenceArtifactSnapshot`, stato della coda OCR, replay OCR,
`documentInsights`, `aiSummary` e ogni provenance documentale restano
scritture host/web. Il client nativo li mostra in sola lettura.

**Classe D, invocazione AI: ESCLUSA, stato leggibile.** Nessuna route
paired di generazione o chat. Il client paired ottiene pero lo stato in
sola lettura: `GET /api/v1/network/ai-runtime` passa alla dual-auth di
discovery, la risposta include lo stato dei quattro kill switch e la
superficie treatment-reasoning. Il client nativo rispetta lo stato letto ed
e fail-closed quando non riesce a leggerlo.

**Classe E, compute deterministici senza persistenza: CONSENTITA.** Il
generatore di bozza visita (deterministico, nessuna scrittura) diventa
esponibile al boundary come endpoint compute-only. Il risultato entra nel
diario esclusivamente attraverso la revisione dell'utente e le capability
di scrittura manuale esistenti, con semantica `form_prefill_only` di
ADR 0073. Lo stesso vale per i prefill da insight gia persistiti (per
esempio suggerimento follow-up che precompila il form controlli): il record
risultante e una scrittura manuale con provenance nel campo cifrato, come
sul web.

Vincolo trasversale di sanitizzazione: il contenuto HTML delle voci e
cifrato, quindi il server non puo sanitizzarlo mai. Ogni client che scrive
HTML deve sanitizzare prima di sigillare, con la stessa allowlist di
`lib/clinical-rich-text.ts`; il port nativo va verificato con fixture di
parita contro l'implementazione web.

## Conseguenze

Diventa possibile la parita documentale reale: caricare un referto da
iPhone, iPad o Mac, vederlo nell'archivio, allegarlo a una voce di diario e
leggere insight e sintesi gia prodotti dall'host. Il piano AI resta
host-only e osservabile, coerente con la separazione decisa nel piano
ondate.

Diventa piu oneroso il boundary: la famiglia documenti nasce con guardie
ENC per presenza, la disciplina di ownership dei riferimenti vive nel
client e nei suoi test (il server garantisce solo il sigillo), e la coda
OCR resta asimmetrica (un allegato caricato dal client paired viene
processato da web/host in un secondo momento). Se in futuro
serviranno delete o update paired degli allegati, servira prima portare
soft-delete e concurrency ottimistica sulla tabella.

## Stop Rules

Fermarsi e aprire ADR o issue separata se una proposta:

- espone invocazione AI, generazione o chat su `/api/v1/network/*`;
- scrive dal client paired un campo di Classe C, incluso il replay OCR;
- introduce DELETE o PUT paired sugli allegati;
- applica bozze o candidati senza revisione esplicita dell'utente
  (auto-write), in violazione della tassonomia ADR 0073;
- trasforma il generatore di bozza visita da deterministico a model-powered
  senza rivedere questo ADR;
- rimuove la validazione client-side di ownership dei riferimenti di
  Classe B o ammette riferimenti in chiaro nella colonna cifrata;
- aggira o ignora lo stato dei kill switch letti dal boundary.

# Addendum ADR0076 — sole proposte OpenAI ordinarie su Mac

Data: 18 settembre 2026. Stato: candidato locale, non ammissione runtime.
Run: 3f2e6f2ad2e84651b2069c50776bfe16. Decisione da integrare prima del codice.

L'ADR0076 originale è citato dall'indice ma non incluso nella fotografia fornita.
Questo addendum non ne ricostruisce né sostituisce il contenuto.

La deroga mirata consente al solo Mac paired, con sessione operatore autentica e
capability di inferenza correnti, di richiedere i quattro percorsi nominati di
ADR0134 e ricevere una proposta review-only nella funzione di origine.
Smart Import e Document Synthesis non acquisiscono alcun endpoint di apply,
persistenza document-derived, aggiornamento automatico del paziente o writer.
Patient Insight e Treatment Reasoning rimangono anch'essi proposta-only.

L'accesso al contenuto documentale passa dall'Application Service di acquisizione
esistente e dal suo source authority, con soli raccordi di issuer/registry per Mac.
Non cambia la decodifica, non si introduce decrittazione server, non si cambia OCR,
né si aggirano dinieghi preesistenti (per esempio sorgenti cifrate non estraibili
nel percorso host). L'autorità nativa non espone commit di review durevole o OCR.

Consenso, ruolo/capability, selezione, appartenenza all'ambulatorio, revisioni,
redazione, parser, pubblicazione e chiusura restano condizioni congiunte. Le UI
non chiamano writer e non riutilizzano risultati dopo cambio contesto. Nessun
ampliamento riguarda mobile, la UI Web o l'ammissione di dati reali WUL-688.


## Correzione source authority — follow-up 9e7ecb80 (18 settembre 2026)

Base candidata: `c00539ff273da8cf53b45970a0dcb310a89b2b77`. Questo delta
precede il codice. Il client Mac non trasmette testo, proiezioni, diagnosi,
terapie, timestamp di cattura o revisioni delle fonti. Trasmette soltanto
patientId, ambulatoryId, patientRevision e un input discriminato chiuso:
`{selector: "current_patient_insight"}`, `{selector: "current_smart_import"}`,
`{selector: "current_treatment_reasoning"}`, oppure `{attachmentId}` per
Document Synthesis. Gli input delle altre funzioni e ogni chiave aggiuntiva
sono negati prima di creare un'operazione o acquisire contenuti.

Il nuovo Application Service `server-session-clinical-context-native-sources`
acquisisce le righe correnti host, sotto l'owner nativo autentico e la selection
lease originale. Usa la membership e currentness canoniche; non legge dal DTO
le fonti. Le proiezioni sono costruite internamente e validate dai parser delle
funzioni originali. Patient Insight riusa la stessa selection lease, invece di
sostituirla. Smart Import mantiene l'attacher e il broker originali; Treatment
Reasoning mantiene il broker/commit originali. Document Synthesis conserva il
capture/ingest AnyDoc autorizzato: attachmentId non e una prova di contenuto.

Un capture opaco in memoria lega sessione, owner, funzione, lease, review epoch,
revisione e digest SHA-256 delle righe effettivamente acquisite. Non e un handle
serializzabile. Prima di ogni dispatch e prima della pubblicazione si ripetono
le verifiche di owner/lease e la lettura delle fonti. Una modifica di contenuto,
versione, inclusione, tombstone o freshness documentale invalida il capture
anche se patientRevision non cambia. Il veto delle fonti attraversa il product
attempt fino al guard immediatamente precedente a `transport.request` e resta
attivo durante parser, commit proposal-only e cleanup. Non basta un polling.
La prima revoca osservata rende il capture terminale; non si rinnova implicitamente.

Si leggono esclusivamente righe host nel perimetro paziente/ambulatorio. Nessuna
nuova decrittazione, scrittura, persistenza di proiezioni, estrazione alternativa
o fallback. Contenuti `ENC:` nel set selezionato, fonti malformate/non leggibili,
assenza di evidenze o limiti superati negano la funzione: non sono sostituiti da
testo Mac, da dati inventati o da riassunti di un altro paziente. Questo limite
non qualifica l'uso su cartelle cifrate; la qualificazione richiede l'acquisizione
canonica gia autorizzata. C2/OS/PIN/drain e ammissione clinica restano invariati.

La currentness e basata sulle revisioni canoniche e sulle osservazioni alle
barriere sincrone. Non attesta modifiche esterne mutate e ripristinate senza
incrementare le revisioni tra due letture. Nessun test locale concede readiness.

### Politica di selezione host del follow-up (@Codex)

La richiesta HTTP di preparazione e limitata a 4096 byte UTF-8. Gli identificativi
sono stringhe non vuote, senza spazi iniziali/finali, controlli C0/DEL o surrogate
isolate: massimo 160 unita UTF-16 per paziente/ambulatorio e 200 per attachmentId.
patientRevision e un intero sicuro JavaScript nell'intervallo 1..9007199254740991.
I DTO Swift codificano lo stesso discriminante; nessun dizionario di input libero.

La cattura host legge note e diagnosi della cartella selezionata, poi sottoinsiemi
ordinati stabilmente (data decrescente e ID crescente a parita di data): Patient
Insight usa al massimo 12 eventi e 12 terapie attive; Smart Import 6 eventi,
3 sintesi di allegati e fino a 64 terapie attive (il rilevamento della 65a nega);
Treatment Reasoning 2 eventi, 4 terapie attive, 3 osservazioni, 1 sintesi allegato
e fino a 3 diagnosi. La cartella non viene dichiarata integralmente riassunta.
Le diagnosi sono validate fino a 64 righe; testi oltre 262144 unita UTF-16 o non
leggibili negano, mentre estratti validi vengono minimizzati ai limiti dei parser
canonici senza spezzare coppie surrogate. Non sono consultati i dati grezzi dei
blob allegati dai tre selettori di cartella.

Il digest comprende i valori letti e le revisioni dei figli, i riferimenti e
la freshness delle sintesi documentali, oltre agli identificativi clinici usati
nella redazione. Cambiare una riga selezionata senza aumentare patientRevision
nega comunque. Righe fuori dal sottoinsieme non sono fonti dell'operazione.
La cattura ha durata massima cinque minuti, ulteriormente limitata dal lease
originale, e nessun rinnovo. Un nuovo consenso richiede una nuova acquisizione.

## Raccordo ENC nativo — WUL689_NATIVE_CLIENT_DECRYPT_20260919 (@Codex)

Data: 19 settembre 2026. Base pubblica immutabile:
`4fbb1c44d5cf674c911761cae03b1141693123f3`. Stato: candidato locale;
nessuna ammissione clinica o qualificazione di piattaforma. Questo delta viene
scritto prima del codice e sostituisce **soltanto** il diniego ENC incondizionato
del raccordo Mac del 18 settembre, non le sue altre condizioni.

`prepare` resta un DTO chiuso selector-only. L'host autentica sessione nativa,
owner e selection lease, cattura il sottoinsieme ordinato già previsto e le
revisioni/digest correnti. Prima di creare qualsiasi ordinary attempt può
rispondere `needs_source_projection`, con grant opaco monouso e roster chiuso
di soli selettori riga/campo. Il roster non contiene testo, ciphertext, chiavi,
PIN o authority ricostruibile. Il grant dura al massimo 30 secondi ed è una
risorsa del lifecycle nativo e della selezione; non rinnova il lease. La fase
successiva ha budget 120 secondi, sempre intersecato con la scadenza originaria.
Le catture restano limitate a cinque minuti e 16 grant pendenti per processo.

Dopo il grant, il Mac effettua letture fresche HTTP tramite
`HomeBasePatientsClient`, usando la connessione workspace corrente e la sola
master key già sbloccata. Nessun accesso SQLite/LocalPatientsDataSource. Decifra
in RAM esattamente i campi nominati. `POST ordinary/project` risolve l'authority
dal grant autentico in `X-MediFlow-Ordinary-Projection`, prima del corpo.
PI/SI/TR hanno un corpo JSON discriminato per funzione, limitato a 2 MiB,
con righe e campi esatti e ordinati. Il limite di ogni stringa è 262144 unità
UTF-16. Campi non cifrati restano quelli riletti dall'host. Righe/campi mancanti,
aggiuntivi, duplicati, riordinati, altro discriminante, residui `ENC:` o
`[LOCKED DATA]`, UTF-8/JSON non validi e plaintext non leggibile negano l'intera
operazione: nessuna riduzione silenziosa del set.

SourceRevision, cattura, scadenza, selezione, review epoch, membership,
revisioni e digest ciphertext sono valori privati host-owned, non sostituibili
da metadati del caller. Prima/dopo ogni attesa di acquisizione, prima/dopo
parsing e minimizzazione, immediatamente prima del dispatch e della
pubblicazione sono verificati gli stessi owner e source capture. La prima
revoca osservata è terminale, incluso A→B→A. Questo non attesta mutazioni
esterne ripristinate senza revisioni tra due osservazioni.

Document Synthesis estende la source authority AnyDoc nativa già esistente:
un locator e un witness privati nascono dalla stessa cattura del ciphertext.
Il client rilegge e decifra `data` dell'allegato selezionato e consegna soltanto
un corpo binario bounded (25 MiB). Il medesimo ingest AnyDoc, la sua continuazione
OCR e il parser DS producono la proiezione; non si aggiungono reader, motori,
percorsi OCR o decrittazione server. Il witness di ciphertext resta veto-only
fino al dispatch e alla pubblicazione, anche dopo il finalize dei byte.

La provenienza di questa acquisizione è esattamente
`authenticated_client_decryption`, `ciphertextEquality: not_attested`.
L'host attesta la currentness della riga cifrata e il set ricevuto dal client
fidato, **non** un legame crittografico tra plaintext e ciphertext. Le proiezioni
passano dai parser canonici prima dell'ordinary attempt; consenso, redazione,
login, catalogo, provider e commit proposal-only restano invariati.

`DELETE ordinary/project`, autenticato con lo stesso grant, ritira anche una
preparazione senza attemptId. Abort, lock/logout, scadenza e invalidazione UI
revocano sincronicamente e azzerano i buffer mutabili posseduti; unregister e
dispose che possono rientrare negli owner sono differiti alla microtask.
Stringhe immutabili Swift/JavaScript e copie interne dei parser seguono ARC/GC:
non si promette secure erasure dell'intero processo. Nessuna persistenza o log
di plaintext. Client precedenti rifiutano la nuova fase senza invio provider;
nessun retry o fallback implicito. C2, OS, PIN, drain, packaging, writer,
auto-apply e ammissione WUL-688 rimangono fuori scope.

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

# ADR 0175: dossier clinico da cartella

Stato: proposta per WUL-804. Data: 2026-11-03.
Integra [ADR 0084](./0084-document-diagnoses-review-only.md) e
[ADR 0087](./0087-registro-proposte-diagnostiche-documentali.md): è la lane
contrattuale separata che ADR 0084 richiede per un apply.

## Problema

Il medico ha cartelle di impegnative, referti, verbali di invalidità e documenti
protesici già riferibili a pazienti in MediFlow. Vuole conservarli nella scheda giusta,
leggerne il contenuto e aggiornare la scheda. Una perfetta estrazione semantica non è
attestabile automaticamente: il sistema deve conservare originale e testo, proporre
fatti con evidenza, rendere visibili le omissioni e non dichiarare completo un parziale.

## Decisione

Il flusso vive nella Web locale, dove il client possiede la chiave
(`/patients/import/dossier`, raggiungibile da Nuova scheda, Importa elenco e dalla
sezione Documenti della scheda). Non usa modelli, né locali né remoti: funziona con
le funzioni AI spente.

1. **Inventario.** I file selezionati si leggono nel browser; ogni file ha uno stato.
   I byte vanno a `POST /api/documents/dossier-extraction`, in sola lettura: sessione
   Web, richiesta loopback same-origin, limite di 25 MiB, una richiesta alla volta.
   L'host esegue AnyDoc e, per le pagine immagine, l'OCR locale esistente. Nessun
   allegato, nessuna scrittura, nessun contenuto nei log. Buste `.p7m`, archivi e
   messaggi di posta si conservano senza estrazione.
2. **Identità prima dell'archiviazione.** Il nome della cartella non decide il
   paziente. Più codici fiscali paziente nel gruppo, o un codice diverso da quello
   della scheda scelta, bloccano il gruppo. Un codice coincidente o assente richiede
   comunque la conferma esplicita del medico. La nuova scheda si crea dal percorso
   ordinario `/patients/new`.
3. **Originali.** Ogni fonte diventa un allegato D-04 cifrato dal writer ordinario
   (ENC), con il record dossier già nell'artefatto al momento della creazione.
   La fonte su disco deve avere lo sha256 dell'inventario. È conservata solo dopo
   rilettura e decifratura byte-identica. Un allegato già presente con gli stessi
   byte si riusa e non si duplica. La ripresa riconosce le fonti dallo sha256
   cifrato nell'artefatto, mai dal nome.
4. **Record dossier.** Vive come chiave aggiuntiva `dossier`
   (`mediflow.document_dossier.v1`) dentro l'artefatto
   `mediflow.document_parse_evidence_artifact.v1` di
   `attachments.parse_evidence_artifact_snapshot`, campo già cifrato. I consumer v1
   leggono lo stesso formato. Il testo completo si conserva una sola volta in
   `parseBundle.rawMarkdownExcerpt`, oppure inline quando un artefatto v1
   preesistente va mantenuto. Ogni lettura lo verifica con lo sha256 registrato.
   Un artefatto esistente non v1 non viene mai sovrascritto.
5. **Proposte.** Ci sono parser solo dove sono affidabili: righe di laboratorio,
   codici ICD etichettati e codici di esenzione del catalogo locale. Il documento
   intero è sempre proposto come voce di diario. Ogni altro tipo (diagnosi, anamnesi,
   farmaci, prestazioni con voci, ausili, scale riportate, valutazioni, referti di
   imaging, invalidità, contesto assistenziale) si aggiunge o corregge a mano.
   Date e codici non si inventano; una negazione blocca l'applicazione; una terapia
   da documento è storica salvo scelta esplicita; un totale di scala trascritto è una
   nota, non una scala somministrata.
6. **Revisione e applicazione.** Le decisioni si salvano con CAS sulla currentness
   mostrata (D-02). L'applicazione assegna e persiste nell'artefatto le identità
   opache dei record prima di ogni invio. Poi scrive con i writer ordinari (P-01 con
   versione, T-03, O-03, E-03, SP-06, SP-03, PR-03), rilegge e registra l'esito nel
   record. Un esito incerto si rilegge; un 409 non vale come successo. Sessione,
   contesto e artefatto si ricontrollano dopo ogni await.
7. **Copertura e ricevuta.** Un documento è completo solo con originale riletto,
   testo verificato, ogni proposta decisa, residuo rivisto e scritture confermate.
   La ricevuta aggregata riporta conteggi, senza nomi, testo, codici o identificativi.

## Confine proposte/decisioni/comandi

`lib/domain/documents/dossier-import.ts` resta nel perimetro di
`check:ai-clinical-writes` e non scrive. Le scritture stanno in
`lib/document-dossier-session.ts`, che usa le porte di `lib/document-dossier-ports.ts`
sulla facade `db`. Il roster le registra come X-14. `lib/document-dossier-session.test.ts`
prova il chiamante reale su un archivio sintetico con semantica CAS, 409 ed esiti
incerti.

## Limiti dichiarati

- AnyDoc non divide in pagine il testo nativo: le pagine si contano solo sui
  marcatori dell'OCR locale. Negli altri casi l'unità è il documento.
- AnyDoc può unire in un paragrafo le righe di un PDF nativo. Il parser di laboratorio
  lavora per riga e in quel caso non propone valori: il testo resta integro e il medico
  aggiunge le osservazioni a mano. Nessuna euristica ricompone le righe.
- Se l'OCR fallisce su una pagina, l'estrazione dell'intero documento non riesce.
  L'originale resta conservato, il documento resta incompleto e il medico può
  aggiungere a mano ciò che legge nell'originale.
- Un artefatto deve restare sotto il limite di aggiornamento di 4 MiB di D-02.
  Oltre questo limite la fonte è segnalata e non viene acquisita.
- La crescita dello storage si misura sulla serializzazione cifrata effettiva di ogni
  fonte acquisita; non si stima con un fattore fisso. La copertura del corpus reale si
  attesta sul runtime, documento per documento, e non coincide con la consegna software.
- Nessuna cancellazione di originali o backup. L'acquisizione non è conservazione a norma.
- `scripts/document-evidence-backfill-live-db.ts --rebuild-existing` ricostruisce l'artefatto
  v1 e perderebbe la chiave `dossier`: non va usato su allegati con dossier.

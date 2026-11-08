# ADR 0175: dossier clinico da cartella

Stato: proposta per WUL-804. Data: 2026-11-03.
Integra [ADR 0084](./0084-document-diagnoses-review-only.md) e
[ADR 0087](./0087-registro-proposte-diagnostiche-documentali.md): è la lane
contrattuale separata che ADR 0084 richiede per un apply. Riusa il comando
documento→anagrafica di [ADR 0042](./0042-document-driven-new-patient-review-and-prudent-therapy-persistence.md).
Aggiornamento 2026-11-03: [ADR 0176](./0176-estrazione-preparata-per-il-dossier.md) aggiunge l'estrazione preparata,
un file esterno di proposte con citazioni verificate sul testo conservato.

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

Aggiornamento 8 novembre 2026, [PR #883](https://github.com/Wulfgardr/mediflow/pull/883):
anche il client GPUI sul Mac host consuma questo flusso. Usa `LocalHostAccess`,
con origine loopback e seconda autenticazione Web P3 già aperta. Senza questo
accesso non avvia la revisione né scrive e mostra il requisito nella sezione
Documenti. Non rimanda al browser.

Il client mantiene in Rust chiavi, cifratura e porte HTTP. Un processo Node 24
locale, senza chiavi, cookie o accesso ai file clinici, esegue la stessa sessione
TS del Web: inventario, parser, claim CAS, applicazione e rilettura. Il bundle è
incorporato nell'eseguibile GPUI e viene rigenerato con
`node scripts/build-dossier-worker.mjs`. Il processo riceve i soli byte selezionati
sul canale privato del padre. Il verificatore Rust confronta integralmente i
risultati del verificatore TS prima che la sessione possa proseguire.
Le porte di scrittura restano chiuse durante la revisione e si aprono solo per
la scheda confermata dal gesto del medico. Il ritiro interrompe il processo
locale, il contesto ed ogni invio successivo. Il piccolo file temporaneo contiene
solo il codice del bundle, mai documenti, chiavi o stato del dossier.

Questa aggiunta non modifica `/api/v1`, OpenAPI, schema, formato ENC/ENC2 o il
confine di Classe C di ADR 0076. I writer sono sempre quelli Web elencati qui.
La revisione GPUI mantiene le proposte dubbie visibili, accetta il verificato per
scheda ed include le sintesi solo dopo la scelta «Ho letto le sintesi».

1. **Inventario.** I file selezionati si leggono nel browser; ogni file ha uno stato.
   I byte vanno a `POST /api/documents/dossier-extraction`, in sola lettura: sessione
   Web, richiesta loopback same-origin, limite di 25 MiB, una richiesta alla volta.
   L'host esegue AnyDoc e, per le pagine immagine, l'OCR locale esistente. Nessun
   allegato, nessuna scrittura, nessun contenuto nei log. Buste `.p7m`, archivi e
   messaggi di posta si conservano senza estrazione.
2. **Identità prima dell'archiviazione.** Il nome della cartella non decide il
   paziente. Tutti i codici fiscali validi partecipano al confronto, anche quelli
   di attribuzione incerta: la vicinanza a un’intestazione ASST o al nome di un medico
   non basta a escluderli. Si escludono solo codici con etichetta professionale
   completa sulla stessa riga di ogni occorrenza, senza testo narrativo davanti.
   Una parola nella riga precedente non attribuisce il codice al professionista.
   I vecchi artefatti senza questa
   attestazione restano da confrontare. Più codici distinti nel gruppo, o un codice
   diverso dalla scheda scelta, bloccano il gruppo; tutti i codici letti sono visibili. Un codice coincidente o assente richiede
   comunque la conferma esplicita del medico.
3. **Nuova scheda.** Se nessuna scheda è adatta, un PDF del gruppo entra nel comando
   documento→anagrafica esistente (stage, revisione, PIN, allegato ENC2 riletto). Le
   proposte d'anagrafica (codice fiscale paziente, cognome e nome etichettati, data di
   nascita etichettata) entrano nei campi solo con un gesto del medico. Dopo la
   creazione il lotto riprende sulla nuova scheda e l'allegato del comando viene
   riconosciuto per byte e riusato, non duplicato. Nessun dato personale va nell'URL o
   nello storage del browser.
4. **Originali.** Ogni fonte diventa un allegato D-04 cifrato dal writer ordinario
   (ENC), con il record dossier già nell'artefatto al momento della creazione. La fonte
   su disco deve avere lo sha256 dell'inventario. È conservata solo dopo rilettura e
   decifratura byte-identica dei byte correnti, ripetuta a ogni riacquisizione;
   l'attestazione è legata alla `sourceRef` host dell'allegato e non vale per un'altra.
   Un allegato già presente con gli stessi byte si riusa. La ripresa riconosce le fonti
   dallo sha256 cifrato nell'artefatto, mai dal nome.
5. **Record dossier.** Vive come chiave aggiuntiva `dossier`
   (`mediflow.document_dossier.v1`) dentro l'artefatto
   `mediflow.document_parse_evidence_artifact.v1` di
   `attachments.parse_evidence_artifact_snapshot`, campo già cifrato. I consumer v1
   leggono lo stesso formato. Il testo completo si conserva una sola volta in
   `parseBundle.rawMarkdownExcerpt`, oppure inline quando un artefatto v1 preesistente
   va mantenuto o il testo arriva da una nuova estrazione. Ogni lettura lo verifica con
   lo sha256 registrato. Un artefatto esistente non v1 non viene mai sovrascritto. Il
   backfill delle evidenze salta ogni artefatto con chiave `dossier`, anche con
   `rebuildExisting` e anche se il record è malformato o di una versione futura.
6. **Proposte.** Solo da regole locali e deterministiche, sempre con evidenza:
   - righe di laboratorio (parser esistente); le righe di una tabella unite in un
     paragrafo dall'estrattore si ricompongono solo dove compaiono almeno due intervalli
     di riferimento, e la riga ricostruita è segnalata; codice LOINC e unità UCUM solo
     per corrispondenza esatta di nome e unità col catalogo locale, mai per voci con una
     variante in validazione clinica;
   - codici ICD etichettati, codici di esenzione del catalogo;
   - sezioni esplicite (etichetta del vocabolario seguita da «:» o titolo markdown):
     diagnosi, anamnesi (anche familiare), terapia, prestazioni richieste con voci, NRE,
     priorità e quesito, ausili con codice ISO solo se scritto e stato documentato,
     invalidità con percentuale e indennità se scritte, valutazione, indicazioni,
     contesto assistenziale;
   - totali di scale nominate (Barthel, MMSE e altre) con valore direttamente associato al nome o a un’etichetta di punteggio; anni e intervalli futuri restano residui. Mese/anno o giorno/mese/anno prima del punteggio non diventano un totale; un valore successivo si propone solo dopo un separatore o un’etichetta esplicita.
   Ogni proposta conserva negazione, soggetto (paziente o familiare: una diagnosi di un
   familiare diventa anamnesi familiare, usando la sezione esplicita del codice anche nei paragrafi uniti; un punto o un codice ICD precedente non bastano a cambiare soggetto), riferimento temporale e incertezza. Date e
   codici non si inventano; una terapia da documento è storica salvo scelta esplicita;
   un totale di scala trascritto è una nota, non una scala somministrata; una richiesta
   non è mai un farmaco. Il documento intero è proposto come voce di diario e il testo
   che nessuna proposta copre resta visibile come residuo da rivedere.
7. **Confronto.** Stesso soggetto (codice, farmaco e data, esame e data) con contenuto
   diverso è un conflitto, mai un duplicato. L'uguaglianza è clinica, non lessicale:
   segno, qualificatori `<`/`>`, decimali con virgola, unità UCUM, dosi, stati e date
   restano significativi.
8. **Revisione e applicazione.** Le decisioni si salvano con CAS sulla currentness
   mostrata (D-02); la revisione non elimina fatti, non tocca registro né
   autorizzazioni e non modifica un fatto con una scrittura in volo. Per ogni fatto
   l'applicazione persiste con CAS un'autorizzazione (claim) con l'impronta dell'esatta
   revisione del fatto, rilegge il record dossier subito prima di ogni invio (anche per
   ogni voce di prestazione), scrive con i writer ordinari (P-01 con versione, T-03,
   O-03, E-03, SP-06/SP-03, PR-03), rilegge e confronta tutti i campi clinici del
   payload, poi registra l'esito con l'impronta e rilascia il claim. Un esito incerto
   tiene il claim e la ripresa rilegge prima di qualunque nuovo invio. Un timeout o un
   errore di trasporto resta incerto anche se la prima rilettura è vuota: il commit
   potrebbe essere ancora in corso. Un 409 non vale
   come successo. Sessione e contesto si ricontrollano prima e dopo ogni confine di
   scrittura; una revoca resta revoca, non un errore di rete.
9. **Riprova dell'estrazione.** Un documento con estrazione non riuscita si può
   rileggere dall'originale conservato (sha256 verificato) e rielaborare in locale. Il
   tentativo è registrato; i codici fiscali riletti vengono confrontati con la scheda e
   una discordanza blocca l’applicazione. Il controllo viene ripetuto sulla scheda
   corrente prima delle scritture. Il nuovo testo entra inline; i fatti già presenti e le loro
   decisioni restano; le nuove proposte arrivano da decidere e il residuo torna da
   rivedere.
10. **Copertura, misure e ricevuta.** Un documento è completo solo con originale riletto
    sulla sorgente corrente, testo verificato, ogni proposta decisa, residuo rivisto e
    ogni scrittura confermata per la revisione decisa. Lo spazio si misura sulla
    serializzazione cifrata effettiva: l'originale all'acquisizione (nel record della
    fonte), l'artefatto alla lettura. Ciò che non è misurato si conta come tale. La
    ricevuta aggregata del paziente riporta conteggi, senza nomi, testo, codici o
    identificativi.

## Confine proposte/decisioni/comandi

`lib/domain/documents/dossier-import.ts`, `dossier-sections.ts` e
`dossier-clinical-equality.ts` restano nel perimetro di `check:ai-clinical-writes` e
non scrivono. Le scritture stanno in `lib/document-dossier-session.ts`, sulle porte di
`lib/document-dossier-ports.ts` che usano la sola facade `db`. Il roster le registra come
X-14. `lib/document-dossier-session.test.ts` prova il chiamante reale su un archivio
sintetico con semantica CAS, 409, esiti incerti e revisioni concorrenti.

Il claim non rende atomici browser e writer: fra l'ultima rilettura e la scrittura
resta una finestra in cui un client che modificasse l'artefatto fuori da questa
revisione non verrebbe visto. Il flusso dossier rifiuta queste modifiche, il backfill
non tocca gli artefatti con dossier e un'esecuzione interrotta resta segnalata come
incerta. Un'atomicità vera richiederebbe un comando host che verifichi currentness
dell'artefatto e scriva il record clinico nella stessa transazione: è un nuovo writer
ad alto rischio, fuori da questo ADR.

## Limiti dichiarati

- AnyDoc può unire le righe di un PDF nativo. La segmentazione per etichette funziona
  anche sul paragrafo unito; le righe di laboratorio si ricompongono solo nel caso
  descritto sopra. Il resto resta testo integro e residuo da rivedere.
- AnyDoc non legge HTML in questa configurazione. Le pagine si contano solo sui
  marcatori dell'OCR locale. Se l'OCR fallisce su una pagina, l'estrazione dell'intero
  documento non riesce: l'originale resta conservato, il documento incompleto e la
  riprova è manuale.
- La nuova scheda da documento accetta solo PDF fino a 10 MiB e richiede un operatore
  amministratore con PIN, come il comando esistente.
- Un artefatto deve restare sotto il limite di aggiornamento di 4 MiB di D-02.
  Oltre questo limite la fonte è segnalata e non viene acquisita.
- Le misure sono caratteri della serializzazione cifrata del client: non includono
  l'ingombro SQLite, gli indici né i backup. Un originale già presente in MediFlow non è
  misurato da questo flusso.
- La copertura del corpus reale si attesta sul runtime, documento per documento, e non
  coincide con la consegna software. Nessuna cancellazione di originali o backup;
  l'acquisizione non è conservazione a norma.

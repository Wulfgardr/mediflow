# ADR 0177: MediFlow utilizzabile ovunque, la Lombardia come modulo

Data: 2026-11-03. Stato: **Proposed**.
Decisione di prodotto di Leonardo del 3 novembre 2026; questo ADR la registra
e ne fissa l'applicazione. Estende [ADR 0158](./0158-territorial-packs.md)
(pacchetti territoriali, Accepted) e [ADR 0170](./0170-territorial-service-extension-points.md);
non cambia autorità, migrazione conservativa, conservazione o restore fissati lì.

## Decisione di Leonardo

MediFlow nasce utilizzabile ovunque nel mondo. La Lombardia è un modulo di
personalizzazione: passaggi ai portali (handover), SISS e PRREG, protesica con
le codifiche lombarde. ICD è generale. I farmaci oggi vengono da AIFA, ma il
sistema deve accettare un catalogo con campi codificati di qualunque agenzia o
ente che classifica i farmaci. Per la protesica, un'altra regione o un altro
utilizzatore deve poter caricare il proprio prontuario con codifiche pensate
come quelle lombarde; con la personalizzazione lombarda attiva tutto funziona
come oggi.

## Meccanismo di attivazione già presente

Il modulo lombardo coincide con il pacchetto territoriale `lom` di ADR 0158.
Non esiste un secondo interruttore e questo ADR non ne introduce:

- contratto `mediflow.territorial-packs.v1`, assetti `core`, `core+it`,
  `core+it+lom` (`lib/territorial-pack-contract.ts`);
- stato per installazione nella chiave `territorial.packs` delle impostazioni
  dell'archivio host, con revisione monotona; le due chiavi sono negate ai
  writer generici (`lib/security/settings-write-policy.ts`);
- migrazione monouso all'apertura dell'archivio (`initializeTerritorialPacks`
  in `lib/sqlite-schema-open.ts`): un archivio esistente riceve
  `core+it+lom`, uno nuovo parte da `core`. L'archivio di Leonardo è
  esistente, quindi resta lombardo senza alcuna azione;
- due soli canali di cambio: `PUT /api/system/territorial-packs` dalla
  sessione Web del nodo home-base con `confirmed: true`, revisione attesa e
  generazione dell'archivio, oppure il comando del supervisore
  `--territorial-packs <assetto> --expected-revision <n> --confirm`;
- lettura per i writer con `requireTerritorialPack(db, 'it' | 'lom')`, dentro
  la transazione; per i client paired nel campo `territorialPacks` di
  `/api/v1/network/capabilities`.

Altre corsie che legano comportamenti alla giurisdizione (per esempio un
profilo di conservazione legale) leggono questa stessa capacità; un profilo
lombardo corrisponde a `core+it+lom`.

## Applicazione

### Funzioni lombarde solo col modulo attivo

Prima di questo ADR il modulo governava soltanto i cinque writer della
protesica. Ora:

- Web: la sezione «SISS e FSE» della scheda paziente, la sua voce nella rail,
  l'area «SISS e portali» del cockpit, la scheda «SISS» delle sotto-aree e
  l'azione «Prepara SISS» compaiono solo con `core+it+lom`. La lettura
  avviene da `GET /api/system/territorial-packs`; finché non è letta o se non
  è valida, le funzioni restano nascoste.
- Host: `POST /api/siss-handoffs`, `PUT` e `DELETE /api/siss-handoffs/:id`,
  `POST /api/siss/context` e `POST /api/siss/prescription` rispondono 403
  `TERRITORIAL_PACK_DISABLED` senza scrivere né preparare aperture di portale.
  La lettura del diario dei passaggi resta disponibile come storico.
- L'esportazione FHIR R4 resta nelle azioni della scheda: non è una funzione
  regionale.
- In Impostazioni, Profilo, «Personalizzazione territoriale» mostra l'assetto
  e lo cambia con conferma esplicita attraverso il canale Web già ammesso.

### Catalogo farmaci con fonte dichiarata

Il catalogo attivo resta uno, nella tabella `drugs`, senza migrazione di
schema. AIFA è una delle fonti:

- fonte AIFA: invariata (download esplicito, caricamento manuale, manifest
  `aifaCatalogManifest`, svuotamento amministrativo);
- altra agenzia: file CSV con fonte dichiarata (agenzia o ente, codifica,
  versione, data, URL facoltativo), associazione delle colonne a codice,
  denominazione, principio attivo, ATC, forma, confezione, classe di
  rimborsabilità e titolare, anteprima con conteggi e campioni, conferma
  esplicita (`POST /api/drugs/catalog-import`). Il manifest va nella chiave
  `drugCatalogSource`, riservata al writer del catalogo;
- la sostituzione è atomica con CAS sullo snapshot visto in anteprima,
  conferma aggiuntiva sotto il 90% delle voci e audit
  `reference_data.drug_catalog.updated` nella stessa transazione. Un
  caricamento AIFA successivo rimuove il manifest dell'altra fonte, e
  viceversa;
- le terapie salvate non cambiano: conservano nome, AIC, ATC e principio
  attivo registrati. Con un catalogo non AIFA la ricerca dichiara la codifica
  e il campo AIC della nuova terapia resta vuoto; ATC e principio attivo
  restano campi codificati comuni.

La tabella non ha una colonna per la forma: quando è associata, la forma
precede la confezione nello stesso campo. Una colonna dedicata richiede una
nuova versione di schema e resta un passo successivo.

### Protesica

L'importazione del prontuario è già generale: CSV `prosthetics-csv-v1` con le
otto colonne del modello lombardo (sistema di codifica, codice, descrizione,
versione, fonte, ambito, validità), associazione delle colonne, anteprima,
conferma, fonte con ente e data, originali conservati; la ricerca filtra per
fonte.

#### Seconda consegna, 2026-11-03

I cinque writer ordinari delle prescrizioni protesiche (creazione, modifica
e cancellazione host; creazione e modifica paired) ammettono anche `core` e
`core+it` quando il prontuario contiene almeno una voce collegata a una fonte
con nome ed ente dichiarati. La verifica avviene nella stessa transazione
IMMEDIATE della scrittura e dell'audit. Senza questo prontuario rispondono
412 `PROSTHETICS_CATALOG_REQUIRED`, senza effetti, e chiedono di caricarlo nei
Repertori. OpenAPI 1.54.0 documenta il nuovo codice 412 anche sui due writer
paired, con deroga contrattuale tracciata: prima il rifiuto territoriale era
403; i client precedenti ricevono ancora un errore esplicito.
Restano invariati permessi, ambito, versioni concorrenti e snapshot
delle voci selezionate.

Con `core+it+lom` resta disponibile anche la registrazione manuale senza
prontuario, come prima. Le codifiche del prontuario non attestano accesso o
conformità ai servizi regionali: il passaggio SISS/PRREG, compresa l'azione
`prosthetics.open`, richiede sempre `lom`. Le prove di mancata riattivazione
di ADR 0158 usano ora i writer reali del diario SISS; lo storico resta leggibile.

## Conseguenze

- Una nuova installazione parte senza SISS, PRREG e portali regionali; chi li
  usa li attiva in Impostazioni o con il supervisore. Un archivio esistente
  conserva il comportamento attuale.
- Attivare la Lombardia non concede accesso ai servizi regionali né prova
  conformità ai loro profili.
- Restano fuori: app Apple e GPUI (non leggono ancora la capacità per
  nascondere sezioni), client paired che ricevono il catalogo farmaci senza la
  codifica dichiarata, codice fiscale obbligatorio, testi e lingua, cataloghi
  multipli attivi insieme, colonna della forma farmaceutica.

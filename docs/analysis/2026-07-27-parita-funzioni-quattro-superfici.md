# Parita di funzione fra web, iPhone, iPad e macOS

Data: 2026-07-27
Metodo: nove lane in parallelo, una per dominio clinico, ciascuna in sola lettura
sul worktree, con l'obbligo di cercare in due modi diversi prima di dichiarare
un'assenza. **186 azioni confrontate, 68 divari.**

Le assenze deliberate non sono contate come divari: la sezione `.host` esiste
solo su macOS perche' l'amministrazione dell'archivio si offre solo da loopback,
e `.repertori` e' macOS-only perche' il mobile raggiunge gli stessi cataloghi dai
selettori di terapia ed esenzione.

## Come leggere questo documento

Ogni divario dichiara **se il contratto esiste gia'**. E' il dato che conta: quasi
tutti i divari trovati finora erano di solo client, cioe' la rotta o il metodo
c'erano e mancava il collegamento. Dove c'e' scritto `da creare` serve prima una
decisione, non solo codice.

## Divari a costo basso (40)

### Controllo dello stato nel modulo di modifica web. Il form non registra il campo status e lo schema zod applica default('active'), quindi salvare una modifica su una terapia sospesa o conclusa la riporta ad attiva senza che nessuno lo abbia chiesto.

- Manca su: **web** · dominio: Terapie
- Contratto: contratto pronto — `si, PUT app/api/therapies/[id]/route.ts:120-126 valida e scrive status; il nativo lo usa gia' con lo stesso vocabolario`
- File da toccare: `components/therapy-manager.tsx (schema :20-30, startEditing :81-99, onSubmit :110-129, modulo :311-404)`

### Data di inizio e data di fine modificabili sul web. Oggi startDate e' sempre l'istante della creazione e endDate e' solo un effetto collaterale di Concludi, quindi una terapia inserita in ritardo non e' correggibile.

- Manca su: **web** · dominio: Terapie
- Contratto: contratto pronto — `si, POST app/api/therapies/route.ts:105-106 e PUT app/api/therapies/[id]/route.ts:128-143 accettano startDate e endDate, con null esplicito per azzerare`
- File da toccare: `components/therapy-manager.tsx (schema :20-30, onSubmit :110-168, modulo :311-404)`

### Scelta del contesto di somministrazione, ambulatorio o domicilio, al momento di compilare una scala. Sul nativo l esito viene salvato sempre senza luogo, mentre la stessa voce creata dal web lo porta, quindi due somministrazioni identiche risultano diverse a seconda della superficie che le ha registrate.

- Manca su: **ios+macos** · dominio: Scale cliniche
- Contratto: contratto pronto — `Si, interamente. Il campo setting e' gia' nel payload di creazione voce: native/MediFlowMac/Sources/MediFlowCore/HomeBaseModels.swift:877 e 884-892. Lo store lo scrive e lo normalizza (stringa vuota verso NULL) in native/MediFlowMac/Sources/MediFlowCore/SQLiteClinicalStore.swift:203 e 377, e il generatore FHIR lo legge gia' (FHIRBundleGenerator.swift:348 distingue setting == "home"). La rotta usata dal client paired e' app/api/v1/network/patients/[id]/entries/route.ts, la stessa che il web alimenta con setting dal suo lato.`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/ClinicalScaleFormView.swift (aggiungere un Picker o segmento "Luogo" con le due voci, accanto al punteggio dal vivo alla riga 38, e portarne il valore in onSubmit); native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceModel.swift:1053-1095 (accettare il parametro e passarlo come setting nel HomeBaseEntryCreatePayload della riga 1084); i due chiamanti del form, AppleFoundation/PairedPatientsWorkspaceView.swift:151-159 e AppleFoundation/ClinicalWorkspaceViews.swift:881-886.`

### Raggiungibilita' del catalogo globale delle scale sul web. La pagina /scales esiste ed e' completa, ma nessun collegamento nel prodotto ci porta: le due voci "Scale cliniche" della navigazione puntano altrove. Sul nativo il catalogo e' una destinazione di primo livello, tab su iPhone e riga di sidebar su iPad e Mac.

- Manca su: **web** · dominio: Scale cliniche
- Contratto: contratto pronto — `Si, manca solo il collegamento: la pagina e' app/scales/page.tsx, gia' funzionante, con scelta della scala e poi del paziente. Verificato con due ricerche indipendenti, per stringa di rotta (l unica occorrenza di /scales fuori dalle rotte per paziente e' il router.push interno alla pagina stessa, riga 104) e per etichetta ("Scale cliniche" compare solo in components/kree8/areas/scheda-area.tsx:98, che apre l area scheda, e in components/kree8/areas/real-patient-area.tsx:337, che punta a modules#scale).`
- File da toccare: `components/kree8/areas/scheda-area.tsx:98 e components/kree8/areas/real-patient-area.tsx:337 (fare puntare almeno una delle due voci a /scales, oppure aggiungerne una nuova); in alternativa la navigazione del cockpit in components/kree8/kree8-clinical-cockpit.tsx, dove convivono le aree e le rotte canoniche.`

### Punteggio in tempo reale durante la compilazione sul web. Chi somministra vede solo l avanzamento, non il totale accumulato ne' l interpretazione corrente, mentre sul nativo entrambi sono sempre a schermo.

- Manca su: **web** · dominio: Scale cliniche
- Contratto: contratto pronto — `Si, il calcolo e' gia' disponibile lato client: scale.scoringLogic e scale.interpretation sono invocate in components/scale-engine.tsx:72-73, ma solo dentro finish(). Bastano le stesse due chiamate sullo stato answers corrente. Il riferimento da eguagliare, compreso il massimo teorico, e' ClinicalScaleFormView.swift:38-43 con maxScore da ClinicalScales.swift:34-36.`
- File da toccare: `components/scale-engine.tsx (intestazione, righe 87-95, accanto alla barra di avanzamento); se si vuole anche il denominatore, lib/scale-definitions.ts va affiancato da un massimo calcolato dalle opzioni come fa il nativo.`

### Coerenza delle aree cliniche nel catalogo globale web. Il catalogo raggruppa in "Cognitivo e umore" e "Autonomia e mobilita", mentre la pagina scale del paziente e tutte le superfici native usano quattro aree: Equilibrio, Autonomia, Cognitivo, Umore. La stessa scala si presenta quindi sotto due nomi diversi a seconda della porta da cui si entra.

- Manca su: **web** · dominio: Scale cliniche
- Contratto: contratto pronto — `Si, la funzione che assegna l area corretta esiste gia' in due copie allineate fra loro: app/patients/[id]/scales/page.tsx:14-20 e native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedScalesSection.swift:156-169.`
- File da toccare: `app/scales/page.tsx:30-46 (sostituire il campo category della SCALE_CATALOG con la stessa assegnazione di getScaleArea, e lasciare invariato il raggruppamento che gia' lavora per categoria).`

### Rinominare un ambulatorio dalla pagina web: la lista offre reparto, predefinita, svuota ed elimina, ma nessun modo per cambiare il nome

- Manca su: **web** · dominio: Impostazioni, ambulatori e connessione
- Contratto: contratto pronto — `si, PUT /api/ambulatories/[id] (app/api/ambulatories/[id]/route.ts:7) attraverso updateAmbulatory che accetta name (lib/ambulatory-write.ts:103); il nativo lo usa gia`
- File da toccare: `app/settings/ambulatories/page.tsx (riga 131 AmbulatoryNode, riga 237 handleSetDefault come modello di chiamata con version)`

### Indicare l'indirizzo di un ambulatorio dal nativo: il campo si legge ma non si scrive

- Manca su: **ios+macos** · dominio: Impostazioni, ambulatori e connessione
- Contratto: contratto pronto — `si, address e' gia nei modelli Swift (HomeBaseModels.swift:761 e 790) e accettato da createAmbulatory e updateAmbulatory (lib/ambulatory-write.ts:67 e 107)`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/SettingsWorkspaceView.swift (modello righe 137-195, form righe 519-525, riga 615 dove l'indirizzo e' gia mostrato)`

### Mostrare quali capability l'host ha effettivamente concesso a questo dispositivo: si vede solo il diniego della singola capability quando una sezione si chiude

- Manca su: **ios+macos** · dominio: Impostazioni, ambulatori e connessione
- Contratto: contratto pronto — `si, la risposta di /api/v1/network/capabilities e' gia scaricata e conservata da ClinicalWorkspaceCapabilitiesStore (ClinicalWorkspaceViews.swift:164-170)`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/SettingsWorkspaceView.swift (nuova sezione accanto a "Funzioni AI", riga 428), native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/ClinicalWorkspaceViews.swift per esporre l'elenco oltre al predicato`

### Azione che inserisce il template S/O/A/P nel corpo della voce: sul web le quattro righe sono solo un placeholder che sparisce appena si scrive

- Manca su: **web** · dominio: Diario clinico per paziente
- Contratto: contratto pronto — `Non serve contratto, e' tutto lato client. Il nativo passa lo scheletro dal transcoder in PairedPatientsWorkspaceModel.swift:1137`
- File da toccare: `app/patients/[id]/entries/new/page.tsx:707-711 oppure components/clinical-rich-text-editor.tsx per aggiungere il pulsante alla barra`

### Filtro per tipo di voce nel diario del paziente

- Manca su: **web** · dominio: Diario clinico per paziente
- Contratto: contratto pronto — `Si'. Le voci sono gia' tutte in memoria (app/patients/[id]/modules/page.tsx:71-78) e la rotta di rete accetta gia' il parametro type (app/api/v1/network/patients/[id]/entries/route.ts:38)`
- File da toccare: `components/timeline.tsx accanto al toggle del cestino :86-94`

### Campo titolo nella creazione di una voce: il web deduce il titolo dal tipo e l'operatore non puo' scriverlo

- Manca su: **web** · dominio: Diario clinico per paziente
- Contratto: contratto pronto — `Si'. db.entries.add scrive gia' title (app/patients/[id]/entries/new/page.tsx:297-308) e il nativo lo espone come campo facoltativo`
- File da toccare: `app/patients/[id]/entries/new/page.tsx:291-301 e il modulo attorno a :449-491`

### Etichette per i tipi phone e other nella riga del diario: TYPE_LABELS copre solo visit, remote, note, scale, quindi una voce creata dal nativo mostra la stringa grezza phone oppure other

- Manca su: **web** · dominio: Diario clinico per paziente
- Contratto: contratto pronto — `Si', e' solo una mappa di presentazione. lib/patient-workspace.ts:229-249 e components/clinical-river-timeline.tsx:25-33 conoscono gia' phone, ma nessuna delle due conosce other e clinicalEntryTypeLabel lo fa cadere nel default Nota`
- File da toccare: `components/timeline-entry-card.tsx:20-32 (TYPE_ICONS e TYPE_LABELS), lib/patient-workspace.ts:229, components/clinical-river-timeline.tsx:25`

### Data della voce: il nativo invia sempre l'istante corrente, non si puo' retrodatare una voce ricostruita

- Manca su: **ios+macos** · dominio: Diario clinico per paziente
- Contratto: contratto pronto — `Si'. Il campo date e' gia' nel payload (native/MediFlowMac/Sources/MediFlowCore/HomeBaseModels.swift:875) e la rotta lo normalizza (lib/network-entry-write.ts:45). Manca solo il controllo e il passaggio del valore`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientDiarySection.swift:372-427 per il DatePicker, PairedPatientsWorkspaceModel.swift:1021 per smettere di passare Date()`

### Luogo della voce (ambulatorio o domicilio): il nativo non lo chiede e lo lascia sempre nullo, ma poi il web lo mostra come chip Amb o Dom

- Manca su: **ios+macos** · dominio: Diario clinico per paziente
- Contratto: contratto pronto — `Si'. setting e' gia' nel payload (HomeBaseModels.swift:877 e :885) e nella scrittura di rete (lib/network-entry-write.ts:47)`
- File da toccare: `PairedPatientDiarySection.swift:372-427 per il selettore, PairedPatientsWorkspaceModel.swift:1013-1030 per passarlo`

### Il tipo remote non esiste nel nativo: una voce creata dal web come Remoto non prende chip di tipo e non ricade sotto nessuna voce del filtro tranne Tutte

- Manca su: **ios+macos** · dominio: Diario clinico per paziente
- Contratto: contratto pronto — `Si', e' solo un enum di dominio piu' stretto della realta' dei dati. Il server non valida l'insieme dei tipi (lib/api-v1-clinical-write-normalization.ts:426)`
- File da toccare: `native/MediFlowMac/Sources/MediFlowCore/ClinicalStatusTypes.swift:8-27 e native/MediFlowMac/Sources/MediFlowCore/EntryFiltering.swift:5-34`

### Motivazione di eliminazione obbligatoria: il web la impone per l'audit clinico, il nativo la dichiara facoltativa e invia null quando e' vuota

- Manca su: **ios+macos** · dominio: Diario clinico per paziente
- Contratto: contratto pronto — `Si'. La rotta accetta gia' la motivazione sigillata e la respinge se presente ma vuota (lib/api-v1-clinical-lifecycle.ts:39-45). La differenza e' solo nella soglia imposta dal client`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedDiaryDeleteSheet.swift:16 e :36-48 per rendere il campo obbligatorio e disabilitare la conferma quando e' vuoto`

### La parola Annulla indica due azioni diverse dentro la stessa scheda diario: eliminare la voce e scartare le modifiche in corso; e la stessa eliminazione si chiama Annulla sulla riga ed Elimina nel foglio e sul web

- Manca su: **ios+macos** · dominio: Diario clinico per paziente
- Contratto: contratto pronto — `Non serve contratto, e' solo etichetta. E' esattamente il caso gia' corretto sul web dal commit 48eee4cbc, una parola per una azione`
- File da toccare: `PairedPatientDiarySection.swift:295 (riga voce) contro :350 (scarta modifiche), coerenti con PairedDiaryDeleteSheet.swift:26 e :44`

### Il segnaposto di campo illeggibile sul web e' la stringa tecnica [LOCKED DATA], senza spiegazione e in inglese dentro una interfaccia italiana

- Manca su: **web** · dominio: Diario clinico per paziente
- Contratto: contratto pronto — `Si'. getLockedFields e isLockedDataPlaceholder esistono gia' (lib/locked-field-guard.ts:12 e :21) e permettono di riconoscere il campo bloccato in fase di resa`
- File da toccare: `components/timeline-entry-card.tsx attorno a :219-224 per il contenuto e alla riga titolo, lib/locked-field-guard.ts:6 per la costante`

### Le righe native mostrano la categoria come stringa grezza del contratto invece dell etichetta italiana, quindi una prescrizione creata dal web appare come lab, imaging, standard invece che Laboratorio, Imaging, Ausilio standard. Stesso effetto sulla priorita, resa come Priorita ROUTINE.

- Manca su: **ios+macos** · dominio: Prescrizioni di servizio e protesiche
- Contratto: contratto pronto — `si, il valore arriva gia nel summary; manca solo la funzione di titolo, gemella di quelle gia presenti per lo stato (PairedServicePrescriptionStatus.title(for:) in PairedClinicalTypes.swift:71)`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientPrescriptionSections.swift:113 e :115 (prestazioni), :292 (protesica); etichette da specchiare da components/service-prescription-manager.tsx:68-85 e components/prosthetic-prescription-manager.tsx:45-52`

### I contatori Aperte e Referti hanno lo stesso nome ma una base di calcolo diversa: il web li calcola sulle prescrizioni, il nativo sulle voci. Con una prescrizione da sei voci il web dice 1 aperta e il nativo 6.

- Manca su: **ios+macos** · dominio: Prescrizioni di servizio e protesiche
- Contratto: contratto pronto — `si, entrambi i dati sono gia in memoria su tutte le superfici`
- File da toccare: `native/MediFlowMac/Sources/MediFlowCore/ServicePrescriptionParsing.swift:73-84 (ServicePrescriptionFiltering.counters); riferimento web components/service-prescription-manager.tsx:239-246`

### L ordinal delle voci parte da indici diversi sulla stessa tabella: il web scrive 0, 1, 2 e il nativo 1, 2, 3. La lista nativa stampa l ordinal come prefisso di riga, quindi la stessa scheda mostra una numerazione che parte da zero o da uno a seconda di dove e stata creata la prescrizione.

- Manca su: **ios+macos** · dominio: Prescrizioni di servizio e protesiche
- Contratto: contratto pronto — `si, il server accetta l intero cosi com e (lib/service-prescription-write.ts:243) e ordina per ordinal (:388)`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceModel.swift:2569; riferimento web components/service-prescription-manager.tsx:297`

### Il matchStatus della voce viene deciso su basi diverse: il web guarda il codice effettivo, compreso quello ereditato dal padre quando la voce e una sola, il nativo guarda solo il codice scritto nella riga. Una prescrizione con codice sul padre e una sola voce nasce manual dal web e unmatched dal nativo, quindi la stessa voce si presenta come da codificare invece che manuale.

- Manca su: **ios+macos** · dominio: Prescrizioni di servizio e protesiche
- Contratto: contratto pronto — `si, il campo e gia nel payload e nel set ammesso (lib/prescription-domain.ts:17)`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceModel.swift:2577 (matchStatus calcolato su draft.serviceCode invece che sul risultato di ServicePrescriptionParsing.childServiceCode gia calcolato alla riga :2573); riferimento web components/service-prescription-manager.tsx:305`

### L apertura di Protesica-RL (Assistente RL) non esiste sul client nativo. E il portale gemello del PRREG per il dominio protesico e sul web sta accanto ad esso con lo stesso identico meccanismo di copia CF e apertura.

- Manca su: **ios+macos** · dominio: Prescrizioni di servizio e protesiche
- Contratto: **contratto da creare** — `si, nessuna rotta da creare: l azione e interamente client-side. L URL e gia in lib/siss-urls.ts:10 (PROTESICA_RL) e il seam nativo esiste gia in SystemActions.swift:14-51, che oggi conosce solo prescrittivoRegionale`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/SystemActions.swift:55-59 (aggiungere l URL), PairedPatientsWorkspaceModel.swift:2825-2852 (generalizzare openPrregHandoff), PairedPatientDetailSection.swift:236-241 (voce iOS) e PairedPatientsWorkspaceView.swift:479-484 (voce macOS)`

### Le etichette delle stesse azioni divergono fra web e nativo: Segna prenotata contro Prenota, Segna eseguita contro Esegui, Nuova voce e Salva voce contro Nuova prescrizione protesica e Salva protesica, Prescrittivo Regionale (PRREG) contro Prescrittivo regionale. Divergono anche i titoli di sezione: Prestazioni prescritte contro Prestazioni e Diario ausili e prescrizioni contro Protesica.

- Manca su: **web+ios** · dominio: Prescrizioni di servizio e protesiche
- Contratto: contratto pronto — `si, solo testo di interfaccia, nessun contratto coinvolto`
- File da toccare: `da decidere quale superficie si allinea. Nativo: PairedPatientPrescriptionSections.swift:157, :163, :343, :395, :22, :61 e PairedPatientDetailSection.swift:239 piu PairedPatientsWorkspaceView.swift:482. Web: components/service-prescription-manager.tsx:801, :811, :432 e components/prosthetic-prescription-manager.tsx:211, :308, :227`

### L'Agenda nativa non dice di cosa tratta l'appuntamento: mostra solo nome paziente e data, mentre il web mostra il titolo del checkup

- Manca su: **ios+macos** · dominio: Viste trasversali: Agenda, Diario globale, Analytics
- Contratto: contratto pronto — `Si, gia decodificato lato client: GET /api/v1/network/checkups (app/api/v1/network/checkups/route.ts:14) restituisce title (lib/network-checkup-read.ts:35) e il campo esiste in HomeBaseCheckupSummary.title (native/MediFlowMac/Sources/MediFlowCore/HomeBaseModels.swift:455). Viene perso nella mappatura`
- File da toccare: `native/MediFlowMac/Sources/MediFlowCore/AgendaPresentation.swift:24-36 (aggiungere title ad AgendaCheckup), native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/ClinicalWorkspaceViews.swift:295-302 e :598-609`

### Analytics non e raggiungibile dalla navigazione web: la pagina esiste ma nessun elemento dell'interfaccia la collega

- Manca su: **web** · dominio: Viste trasversali: Agenda, Diario globale, Analytics
- Contratto: contratto pronto — `Si, la pagina esiste ed e completa: app/analytics/page.tsx:170. Manca solo la voce di navigazione`
- File da toccare: `components/kree8/cockpit-shared.tsx:141-160 (elenco AREAS e PRIMARY_AREA_IDS) oppure un rimando esplicito dalla testata di components/kree8/kree8-workspace-shell.tsx`

### Sul web, dopo un errore di lettura del ponte candidati o del riepilogo audit, non esiste alcun comando per ritentare

- Manca su: **web** · dominio: Viste trasversali: Agenda, Diario globale, Analytics
- Contratto: contratto pronto — `Si, entrambe le rotte esistono e sono autenticate col cookie di sessione: app/api/clinical-agenda/candidates/route.ts:17 e app/api/system/audit`
- File da toccare: `components/kree8/kree8-clinical-cockpit.tsx:293-316 e components/kree8/cockpit-shared.tsx:832-843 per il ponte, app/analytics/page.tsx:181-213 e :398-405 per l'audit`

### Il filtro dell'agenda per categoria esiste solo sul web

- Manca su: **ios+macos** · dominio: Viste trasversali: Agenda, Diario globale, Analytics
- Contratto: contratto pronto — `Non serve rotta: la categoria e derivata dalla data lato client (lib/patient-workspace.ts:187, oggi diventa urgente e il resto manuale). La stessa derivazione e disponibile in AgendaPresentation`
- File da toccare: `native/MediFlowMac/Sources/MediFlowCore/AgendaPresentation.swift, native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/ClinicalWorkspaceViews.swift:577-615`

### Il controllo di prontezza FSE del paziente non e' invocabile da solo: sul nativo la validazione parte esclusivamente come pre-check dentro l'esportazione FHIR, quindi non si possono vedere blocchi e attenzioni prima di decidere di esportare.

- Manca su: **ios+macos** · dominio: Documenti e FSE
- Contratto: contratto pronto — `Si', completamente: HomeBasePatientsClient.fetchFseValidatePatient (HomeBasePatientsClient.swift:1192) su GET /api/v1/network/fse/validate-patient sotto capability network.fse.validate, con DTO HomeBaseValidatePatientExportResponse gia' dotato di totalErrorCount, totalWarningCount e delle due categorie per profilo.`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceModel.swift (nuova proprieta' pubblicata piu' metodo che riusa la chiamata gia' presente a riga 2780) e native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientDocumentsSection.swift (nuovo blocco accanto a fseDocumentValidationSection, riga 456)`

### Sul web un documento si puo' solo guardare in un iframe: non si puo' scaricare ne' consegnare al sistema. Il nativo offre "Condividi" e "Prepara condivisione".

- Manca su: **web** · dominio: Documenti e FSE
- Contratto: contratto pronto — `Si', e non serve nessuna rotta: il blob e' gia' nel client (db.attachments) e components/document-viewer.tsx:18 ne crea gia' un object URL.`
- File da toccare: `components/document-upload.tsx:445-461 (azione accanto a Visualizza ed Elimina) e/o intestazione di components/document-viewer.tsx:35-53`

### Non si puo' condividere il Report PDF dal web: viene solo scaricato. Il nativo lo affianca a un ShareLink.

- Manca su: **web** · dominio: Documenti e FSE
- Contratto: contratto pronto — `Si', tutto client-side: lib/report-service.ts:341 usa doc.save, basta esporre anche doc.output('blob') e riusare lo schema di condivisione gia' scritto per FHIR in app/patients/[id]/modules/page.tsx:578-592.`
- File da toccare: `lib/report-service.ts (restituire il file oltre a salvarlo) e app/patients/[id]/modules/page.tsx:630-642 (nuova azione accanto a Report PDF)`

### Il caricamento nativo accetta un file per volta, mentre il web ne accetta fino a dieci in un colpo. Su una cartella di referti la differenza si sente.

- Manca su: **ios+macos** · dominio: Documenti e FSE
- Contratto: contratto pronto — `Si': POST /api/v1/network/patients/[id]/attachments e' gia' per singolo file e uploadAttachmentForSelectedPatient e' gia' per singolo file, quindi basta iterare.`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientDocumentsSection.swift:91 (allowsMultipleSelection) e :133-158 (handlePickedAttachmentFile deve ciclare su urls invece di prendere solo il primo)`

### Il web non mostra ne' permette di cambiare lo stato di un controllo (Da fare, Completato, Annullato). Il campo esiste solo come input nascosto e resta 'pending' per sempre, quindi un follow-up eseguito non si puo' chiudere

- Manca su: **web** · dominio: Controlli e osservazioni
- Contratto: contratto pronto — `si, completo. PUT /api/checkups/[id] (app/api/checkups/[id]/route.ts:31) valida e canonicalizza lo stato via normalizeCheckupUpdateInput (lib/api-v1-clinical-write-normalization.ts:762-770), e il client invia gia' status nella update esistente (app/patients/[id]/edit/page.tsx:100). Non serve toccare il server`
- File da toccare: `components/patient-form.tsx:182 (sostituire l'input nascosto con un selettore a tre valori dentro CheckupsFieldArray, righe 124-198) e app/patients/[id]/modules/page.tsx:945-957 (mostrare lo stato sulla riga follow-up)`

### Il client nativo scrive nel campo descrizione dell'osservazione il display inglese del catalogo invece dell'etichetta italiana, quindi la stessa misura si legge in due lingue a seconda della superficie che l'ha creata

- Manca su: **ios+macos** · dominio: Controlli e osservazioni
- Contratto: contratto pronto — `si. Il catalogo restituisce gia' displayIt (lib/terminology.ts:174-182) e il modello nativo lo decodifica gia' (native/MediFlowMac/Sources/MediFlowAppleShared/HomeBaseCatalogModels.swift:104). Il dato arriva e non viene usato`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceModel.swift:2479-2496 (usare displayIt nelle due selectObservationCodeTerminology) e native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientClinicalSections.swift:562 (stessa preferenza nella lista risultati)`

### Il nativo non propone l'unita' di misura predefinita dell'analita scelto, quindi nulla impedisce di salvare una glicemia in mmHg. Il web questo errore lo previene

- Manca su: **ios+macos** · dominio: Controlli e osservazioni
- Contratto: contratto pronto — `si. defaultUnit e' gia' nel catalogo servito (lib/terminology.ts:179) e gia' decodificato lato nativo in HomeBaseCatalogModels.swift accanto a displayIt`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceModel.swift:2479 e 2492 (alla selezione del codice LOINC impostare anche l'unita' se il campo e' vuoto), specchio di components/observation-manager.tsx:345-348`

### La data di nascita non e correggibile sul nativo: si puo solo indicare alla creazione, poi resta una riga di sola lettura nella scheda.

- Manca su: **ios+macos** · dominio: Ciclo di vita del paziente
- Contratto: contratto pronto — `si su entrambi i lati, non serve toccare niente sotto il client: birthDate e gia PatchValue<Date> in MediFlowCore/HomeBaseModels.swift:1012 e il server ha normalizeBirthDateForUpdate in lib/patient-write-normalization.ts:140`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientDetailSection.swift:339-372 (un DatePicker accanto ai campi anagrafici, come quello di creazione in PairedPatientsWorklistView.swift:905-908), PairedPatientsWorkspaceModel.swift:1334-1353 e 1449-1466 (stato editPatientBirthDate e passaggio nel payload)`

### Tipo di presa in carico (Continuativa o Episodica) e motivo obbligatorio del cambio di stato: sul nativo non si vedono e non si scrivono.

- Manca su: **ios+macos** · dominio: Ciclo di vita del paziente
- Contratto: contratto pronto — `si su entrambi i lati: monitoringProfile e statusReason sono gia dichiarati in MediFlowCore/HomeBaseModels.swift:1004-1005 e accettati in lib/patient-write-normalization.ts:153-154; manca solo la valorizzazione`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientDetailSection.swift:339-372 (Picker piu campo motivo che compare al cambio), PairedPatientsWorkspaceModel.swift:1449-1466 (aggiungere i due argomenti al payload)`

### Il selettore dell'ambulatorio attivo sul web. Il nativo lascia scegliere in quale ambulatorio si sta lavorando e la lista si filtra di conseguenza; sul web l'ambito e deciso da un cookie che nessuna interfaccia sa cambiare.

- Manca su: **web** · dominio: Ciclo di vita del paziente
- Contratto: contratto pronto — `si: POST app/api/context/route.ts:6 imposta il cookie ambulatory_id, GET alla riga 34 lo rilegge, e i lettori sono gia in campo (app/api/patients/route.ts:77, app/api/v1/network/patients/route.ts:45). Nessun chiamante client, verificato per percorso e per stringa.`
- File da toccare: `components/kree8/kree8-workspace-shell.tsx oppure components/kree8/areas/incarico-area.tsx accanto ai chip di ambito, leggendo l'elenco da db.ambulatories come fa app/settings/ambulatories/page.tsx:39`

### Il web chiama "scheda" cio che il nativo chiama "paziente": Nuova scheda contro Nuovo paziente, Elimina scheda contro Elimina paziente, Archivia scheda contro Archivia paziente. Il riallineamento del 26 luglio ha corretto Export e Ripristina ma non ha guardato questa coppia.

- Manca su: **web** · dominio: Ciclo di vita del paziente
- Contratto: contratto pronto — `non pertinente, e solo testo`
- File da toccare: `components/kree8/areas/incarico-area.tsx:213, app/patients/new/page.tsx:237, components/patient-action-modal.tsx:68. Da decidere consapevolmente: sul web "scheda" e coerente con se stesso in tutta l'interfaccia, quindi la scelta e fra allineare il web al nativo o dichiarare la divergenza come intenzionale.`

## Divari a costo medio (24)

### Ricerca ICD e scelta Prevenzione nel collegamento clinico del modulo terapia nativo. Il Picker offre solo le diagnosi gia' presenti in cartella, quindi una terapia preventiva o legata a un codice non ancora registrato resta senza indicazione codificata.

- Manca su: **ios+macos** · dominio: Terapie
- Contratto: contratto pronto — `si, ICDCatalog.search e' gia' in-app e usato in PairedPatientDetailSection.swift:394; diagnosisCode e diagnosisName sono campi in chiaro di HomeBaseTherapyCreatePayload e HomeBaseTherapyUpdatePayload`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientTherapiesSection.swift:364 e native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceModel.swift:1898-1910`

### Motivazione dell'annullamento chiesta all'operatore sul nativo. Oggi softDeleteTherapy scrive la costante mobile-paired-operator-cancelled, quindi l'audit non distingue un doppione da un errore di trascrizione.

- Manca su: **ios+macos** · dominio: Terapie
- Contratto: contratto pronto — `si, HomeBaseTherapyUpdatePayload porta gia' deletionReason cifrato con sealField; la rotta lo accetta in app/api/v1/network/patients/[id]/therapies/[therapyId]/route.ts`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceModel.swift (softDeleteTherapy, blocco :2098-2131) e native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceView.swift:236-246`

### Esportazione del piano terapeutico completo sul web. Il Report PDF stampa solo le attive, quindi non esiste sul web l'equivalente del riepilogo nativo con attive, sospese e concluse.

- Manca su: **web** · dominio: Terapie
- Contratto: **contratto da creare** — `parziale: i dati sono gia' letti da db.therapies.query e lib/report-service.ts genera gia' un PDF; il generatore del riepilogo per stato e' da creare, il canone testuale e' TherapyPlanDocument.swift`
- File da toccare: `lib/report-service.ts:207-240, components/therapy-manager.tsx (intestazione sezione :254-266), app/patients/[id]/modules/page.tsx:594-641`

### Storico delle somministrazioni sul web. Il punteggio salvato sparisce dalla scheda: non compare nella timeline, non ha una sezione propria, e riemerge solo dentro il PDF del referto. Di conseguenza sul web non si puo' nemmeno rileggere, correggere o cancellare una valutazione registrata per sbaglio.

- Manca su: **web** · dominio: Scale cliniche
- Contratto: contratto pronto — `Si, sia in lettura sia in scrittura. Le voci sono gia' in db.entries con metadata.score e metadata.interpretation, e la lista filtrata e' gia' calcolata come scaleEntries in app/patients/[id]/modules/page.tsx:329. Il componente che disegna punteggio e interpretazione esiste gia' e li gestisce: components/timeline-entry-card.tsx:232-241. Per la cancellazione la rotta e' app/api/entries/[id]/route.ts. Il modello di presentazione da imitare e' native/MediFlowMac/Sources/MediFlowCore/ScaleHistoryPresentation.swift:31-54, che ricava titolo, punteggio su massimo e interpretazione con fallback sulle righe del contenuto.`
- File da toccare: `app/patients/[id]/modules/page.tsx (la sezione con id "scale", righe 896-926, e' il posto naturale: scaleEntries e' gia' in ambito alla riga 329); in alternativa o in aggiunta app/patients/[id]/scales/page.tsx, che ha gia' l ancora "#salvataggio" alle righe 113-121 dove oggi si promette che l esito diventa una voce del diario; eventualmente components/timeline-entry-card.tsx se si preferisce riammettere il tipo scala nella timeline invece di dargli una sezione.`

### Creare un reparto sotto una sede dal nativo, e vedere la gerarchia invece di un elenco piatto

- Manca su: **ios+macos** · dominio: Impostazioni, ambulatori e connessione
- Contratto: contratto pronto — `si, parentId e' gia in NetworkAmbulatorySummary (HomeBaseModels.swift:749) e nei payload (761-762, 791), validato lato server da validateParent (lib/ambulatory-write.ts:46)`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/SettingsWorkspaceView.swift (SettingsAmbulatoriesModel righe 137-195 per il campo di scelta, ambulatoryRow riga 596 per il rientro e l'etichetta di relazione)`

### Richiedere l'associazione del dispositivo dall'app: oggi identificativo e token del client paired vanno ottenuti fuori dall'app e incollati nei campi

- Manca su: **ios+macos** · dominio: Impostazioni, ambulatori e connessione
- Contratto: contratto pronto — `si e non richiede autenticazione: POST /api/v1/network/pairing-intents (app/api/v1/network/pairing-intents/route.ts:24, logica in lib/network-home-base-server.ts:150); nessun file Swift lo cita`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/HomeBasePatientsClient.swift per la chiamata, native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorklistView.swift righe 41-44 per sostituire i due campi da incollare`

### Vedere e confermare sull'host i dispositivi in attesa di associazione: nessuna pagina web usa gli intenti di pairing

- Manca su: **web** · dominio: Impostazioni, ambulatori e connessione
- Contratto: contratto pronto — `si ma protetto dal token locale: GET elenco (app/api/v1/network/pairing-intents/route.ts:11) e POST conferma (app/api/v1/network/pairing-intents/[intentId]/confirm/route.ts:9) usano requireLocalApiToken (lib/security/local-api-auth.ts:41), quindi il browser ha bisogno di una rotta a cookie di sessione o di un componente server`
- File da toccare: `nuova pagina sotto app/settings/ (accanto a app/settings/diagnostica/page.tsx), voce in lib/settings-navigation.ts gruppo sicurezza-dati, eventuale ampliamento auth a requireSessionOrLocalToken come in app/api/settings/[key]/route.ts:20`

### Cambiare la modalita operativa dell'host dalla vista Host su macOS: la modalita si legge e non si scrive

- Manca su: **macos** · dominio: Impostazioni, ambulatori e connessione
- Contratto: contratto pronto — `si, PUT /api/settings/network.mode passa da requireSessionOrLocalToken (app/api/settings/[key]/route.ts:41) e la vista ha gia il cookie di sessione; manca solo un metodo di scrittura nel client, che oggi ha solo get e l'export (HomeBaseHostAdminClient.swift:124 e 95)`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/HomeBaseHostAdminClient.swift, native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/HostAdminWorkspaceView.swift riga 270 networkSection`

### Modifica di una voce di diario esistente: nessun punto di ingresso sul web, ne' dalla riga della timeline ne' da una pagina dedicata

- Manca su: **web** · dominio: Diario clinico per paziente
- Contratto: contratto pronto — `Si', completo. PUT app/api/entries/[id]/route.ts:31 con normalizeEntryUpdateInput che accetta type, title, content, date, setting, metadata, attachments (lib/api-v1-clinical-write-normalization.ts:499-532); lato client db.entries.update esiste gia' (lib/db.ts:787) ed e' usato dal ripristino in components/timeline.tsx:66`
- File da toccare: `components/timeline-entry-card.tsx (nuovo pulsante Modifica accanto a Elimina), components/timeline.tsx (stato di modifica e chiamata a db.entries.update con entry.version), eventualmente una nuova app/patients/[id]/entries/[entryId]/edit/page.tsx se si preferisce la pagina intera`

### Selettore per referenziare allegati gia' caricati del paziente quando si crea una voce

- Manca su: **web** · dominio: Diario clinico per paziente
- Contratto: contratto pronto — `Si'. La colonna entries.attachments e' la stessa e il web la scrive gia' con gli id dei file appena caricati (app/patients/[id]/entries/new/page.tsx:297-308); gli allegati esistenti sono interrogabili con db.attachments.query({ patientId })`
- File da toccare: `app/patients/[id]/entries/new/page.tsx, sezione #allegati :714-769`

### Gli enum nativi non parlano il vocabolario del contratto. PairedServicePrescriptionCategory (specialistica, laboratorio, diagnostica, riabilitazione, altro), PairedServicePrescriptionPriority (u, b, d, p minuscoli), PairedPrescriptionSource (manual, importato, integrazione), PairedProstheticPrescriptionCategory (protesi, ortesi, ausilio, altro) e lo stato protesico ordered non esistono nei set accettati dal server. Il modello li invia grezzi con .rawValue senza mappatura, quindi con i valori di default (categoria specialistica, priorita p, categoria ausilio) ogni creazione nativa viene respinta con 400 Unsupported.

- Manca su: **ios+macos** · dominio: Prescrizioni di servizio e protesiche
- Contratto: contratto pronto — `si, gia esistente: lib/prescription-domain.ts:2-15 definisce i set validi, applicati in lib/service-prescription-write.ts:121-125 e lib/prosthetic-prescription-write.ts:97-98 dietro app/api/v1/network/service-prescriptions/route.ts e app/api/v1/network/prosthetic-prescriptions/route.ts`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedClinicalTypes.swift:81-99, :102-118, :121-135, :156-192, :195-211; controllo dei default in native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceModel.swift:211, :212, :226, :232, :242 e nei reset :4175-4205`

### Nel diario globale nativo mancano stato della voce (Bozza, Firmata, Registrata) e provenienza con autore, che il web mostra su ogni voce

- Manca su: **ios+macos** · dominio: Viste trasversali: Agenda, Diario globale, Analytics
- Contratto: contratto pronto — `Si, il dato e gia sul client: la rotta espone metadata e setting (lib/network-entry-read.ts:36-37) e HomeBaseEntrySummary li porta gia (native/MediFlowMac/Sources/MediFlowCore/HomeBaseModels.swift:144-145). Manca solo la lettura`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/ClinicalWorkspaceViews.swift:314-329 (arricchire GlobalDiaryWorkspaceRow), :377-386 e :682-707`

### Dal diario globale e dall'agenda nativi non si puo aprire il quadro del paziente: le righe non sono toccabili

- Manca su: **ios+macos** · dominio: Viste trasversali: Agenda, Diario globale, Analytics
- Contratto: contratto pronto — `Si, e solo cablaggio: PairedPatientsWorkspaceModel.loadPatient esiste (native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceModel.swift:880) e il gesto e gia realizzato in ClinicalWorkspaceViews.swift:888-893 per le Scale. Serve in piu un modo di cambiare sezione dalla vista`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/ClinicalWorkspaceViews.swift:552-634 e :637-716, piu il passaggio della selezione di sezione da native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundationViews.swift:201 e :323-341 e da native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/MacWorkspaceRootView.swift:63-65`

### Dal diario globale nativo non si puo aprire una nuova voce clinica, mentre il web offre Nuova voce su ogni riga

- Manca su: **ios+macos** · dominio: Viste trasversali: Agenda, Diario globale, Analytics
- Contratto: contratto pronto — `Si: la scrittura nativa esiste gia per paziente come "Nuova voce online" (native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientDiarySection.swift:373) sulla capability network.replica.write-clinical-diary`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/ClinicalWorkspaceViews.swift:668-715, riusando il compositore di PairedPatientDiarySection.swift:365-421`

### Analytics nativo non usa i pazienti gia in memoria e in cache: senza connessione dichiara l'indisponibilita anche quando l'elenco con le diagnosi e gia disponibile

- Manca su: **ios+macos** · dominio: Viste trasversali: Agenda, Diario globale, Analytics
- Contratto: contratto pronto — `Si, il dato e gia presente: PairedPatientsWorkspaceModel.loadPatients legge con includeDiagnoses (native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceModel.swift:821-829) e salva l'elenco decifrato nella cache cifrata (:856-860), ripristinata da restoreCachedPatientList (:3998-4025)`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/ClinicalWorkspaceViews.swift:404-458, calcolando su workspaceModel.patients quando la lettura di rete fallisce`

### Su macOS cmd-R nel menu Vai ricarica l'elenco pazienti anche quando in primo piano ci sono Agenda, Diario o Analytics, con la stessa parola Aggiorna del bottone in toolbar che invece ricarica la vista

- Manca su: **macos** · dominio: Viste trasversali: Agenda, Diario globale, Analytics
- Contratto: contratto pronto — `Si, ogni vista ha gia il proprio load(): AgendaWorkspaceModel.load (ClinicalWorkspaceViews.swift:269), GlobalDiaryWorkspaceModel.load (:345), PopulationAnalyticsWorkspaceModel.load (:419). Manca l'inoltro dalla scene`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/MacWorkspaceRootView.swift:53-61 e :317-319, piu l'esposizione dei modelli di sezione alla MediFlowMacSceneModel`

### Su macOS mancano i candidati esterni da e-mail e calendario, che il web mostra sotto l'agenda

- Manca su: **macos** · dominio: Viste trasversali: Agenda, Diario globale, Analytics
- Contratto: contratto pronto — `Si, la rotta esiste con la stessa autenticazione gia usata dal client host nativo: app/api/clinical-agenda/candidates/route.ts:17 usa requireSession, come /api/system/audit gia chiamata da HomeBaseHostAdminClient.swift:53-60`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/HomeBaseHostAdminClient.swift (nuovo metodo verso api/clinical-agenda/candidates) e native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/ClinicalWorkspaceViews.swift:577-615 dietro un ramo #if os(macOS)`

### La verifica FSE di un singolo record (terapia o osservazione) non ha nessuna superficie web: nessun file di app/ o components/ chiama la rotta, che esiste ma non e' raggiungibile da un operatore.

- Manca su: **web** · dominio: Documenti e FSE
- Contratto: contratto pronto — `Si': app/api/v1/fse/validate-document/route.ts (POST {profile, document|payload}), logica in lib/fse-validate-document.ts e lib/fse-validation.ts (validateProfileDocument). Attenzione: quella rotta e' protetta da requireLocalApiToken, non dal cookie di sessione, quindi serve una sorella con requireSession sul modello di app/api/fse/validate-patient/route.ts.`
- File da toccare: `app/api/fse/validate-document/route.ts (da creare, requireSession + validateFseDocumentPayload); pannello nella sezione #documenti di app/patients/[id]/modules/page.tsx:850-895 oppure nuovo components/fse-document-validation-panel.tsx`

### Il web non permette di correggere un'osservazione gia' registrata: esistono solo creazione ed eliminazione, quindi una misura sbagliata va cancellata e riscritta perdendo la riga originale

- Manca su: **web** · dominio: Controlli e osservazioni
- Contratto: contratto pronto — `si. PUT /api/observations/[id] (app/api/observations/[id]/route.ts:28) con normalizeObservationUpdateInput, e ApiTable.update sa gia' fare la scrittura versionata con gestione del 409 (lib/db.ts:425-446). Manca solo la forma in pagina`
- File da toccare: `components/observation-manager.tsx (aggiungere accanto a deleteObservation, riga 278, un percorso di modifica che precompili il form gia' presente e chiami db.observations.update con la version della riga)`

### Su iPhone, iPad e Mac gli intervalli di riferimento non esistono: non si possono inserire alla creazione o modifica di un'osservazione, e i valori ricevuti dall'home-base non vengono letti ne' mostrati. Un valore fuori norma appare identico a uno nella norma

- Manca su: **ios+macos** · dominio: Controlli e osservazioni
- Contratto: contratto pronto — `si, in entrambe le direzioni e senza modifiche al server. In scrittura le rotte di rete usano normalizeObservationCreateInput e normalizeObservationUpdateInput che leggono refLow, refHigh e refText (lib/api-v1-clinical-write-normalization.ts:831-836 e 917-927, richiamate da lib/network-observation-write.ts:189 e 234). In lettura lib/network-observation-read.ts:37-39 li mette gia' nella risposta che il client scarta`
- File da toccare: `native/MediFlowMac/Sources/MediFlowCore/HomeBaseModels.swift:467-487 (refLow, refHigh, refText in HomeBaseObservationSummary), righe 1343-1419 (stessi campi nei due payload), native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientClinicalSections.swift:461-532 (due campi nel form) e 279-372 (riferimento e pastiglia sulla riga), native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceModel.swift:2311 e 2377 (passare i valori nei payload)`

### Il cestino dei pazienti e il comando Ripristina. Il web promette all'utente che il paziente eliminato "potra essere ripristinato da li", ma non esiste nessuna schermata che mostri i tombstone ne nessun pulsante che li riporti indietro.

- Manca su: **web** · dominio: Ciclo di vita del paziente
- Contratto: contratto pronto — `si, completo: GET app/api/system/restore-patient/route.ts:15 elenca i soft deleted con nome, data e motivo, POST alla riga 41 li ripristina con audit patient.restored. Entrambi gia protetti da isWebAdminSession.`
- File da toccare: `components/kree8/areas/incarico-area.tsx (terzo chip di ambito accanto ad Attivi e Archivio, righe 160-172) piu un componente lista che consumi le due rotte; in alternativa una sezione in app/settings/zona-pericolo/page.tsx se si vuole tenerlo dietro il ruolo admin`

### Motivo e nota dell'archiviazione sul client nativo. Un paziente archiviato da iPhone, iPad o Mac arriva sul web con il riquadro "Motivo" vuoto, indistinguibile da un dato non ancora inserito.

- Manca su: **ios+macos** · dominio: Ciclo di vita del paziente
- Contratto: contratto pronto — `si lato server (lib/patient-write-normalization.ts:155-156, con azzeramento automatico alla riattivazione alle righe 182-183); no lato Swift, i due campi non sono in HomeBasePatientUpdatePayload`
- File da toccare: `native/MediFlowMac/Sources/MediFlowCore/HomeBaseModels.swift:993-1029 (aggiungere archiveReason e archiveNote come PatchValue<String>), native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientArchiveSheet.swift (Picker con le tre voci piu nota libera), PairedPatientsWorkspaceModel.swift:1539-1546 (passare i due valori a setSelectedPatientArchived)`

### Il controllo del codice fiscale gia presente in fase di creazione. Sul nativo si puo creare una seconda scheda con lo stesso CF senza che niente lo segnali.

- Manca su: **ios+macos** · dominio: Ciclo di vita del paziente
- Contratto: contratto pronto — `parziale: nessuna guardia server (lib/network-patient-write.ts non legge mai taxCode) e nessun indice unico, ma la lettura per confrontare c'e gia, fetchPatients in HomeBasePatientsDataSource.swift:45 e usata dal modello subito dopo ogni creazione`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceModel.swift:1296-1331 (confronto sull'elenco gia in memoria prima della POST, con avviso e scorciatoia alla scheda trovata); se si vuole chiudere il buco per davvero, la guardia va in lib/network-patient-write.ts e in app/api/patients/route.ts`

### Sul web il ciclo di vita e nascosto dentro Modifica: chi ha imparato archivia, riattiva ed elimina accanto al paziente su iPhone, sul web deve entrare in /edit e scorrere fino in fondo a un modulo lungo.

- Manca su: **web** · dominio: Ciclo di vita del paziente
- Contratto: contratto pronto — `si, sono le stesse chiamate db.patients.update e db.patients.delete gia usate; e solo una questione di dove stanno i pulsanti`
- File da toccare: `app/patients/[id]/modules/page.tsx:594-640 (la barra azioni ha gia Modifica, Esporta FHIR e Condividi FHIR: manca il menu con archivia, riattiva ed elimina), riusando components/patient-action-modal.tsx senza duplicare la logica di app/patients/[id]/edit/page.tsx:176-225`

## Divari a costo alto, o che chiedono una decisione (4)

### Revocare dall'host un dispositivo gia associato: la "Dissocia" nativa cancella solo le credenziali locali

- Manca su: **web+ios** · dominio: Impostazioni, ambulatori e connessione
- Contratto: **contratto da creare** — `da creare: lib/network-home-base-server.ts espone intenti, conferma e autenticazione (righe 141-220) ma nessuna revoca, e non esiste alcuna occorrenza di revoke nello stato di pairing`
- File da toccare: `lib/network-home-base-server.ts e lo stato di pairing che serializza, nuova rotta sotto app/api/v1/network/, poi il consumatore lato host`

### L handoff PRREG fatto dal client nativo non lascia traccia nel diario dei passaggi SISS, mentre quello fatto dal web scrive una riga con esito started. Il diario risulta quindi incompleto per il paziente seguito dall app nativa.

- Manca su: **ios+macos** · dominio: Prescrizioni di servizio e protesiche
- Contratto: **contratto da creare** — `parziale, da creare lato boundary: esiste la rotta locale app/api/siss-handoffs/route.ts e la tabella sissHandoffs, ma non esiste nessuna app/api/v1/network/siss-handoffs, quindi il client paired non ha oggi come scrivere`
- File da toccare: `lato host app/api/v1/network/siss-handoffs/ (nuova, sul modello di app/api/v1/network/prosthetic-prescriptions/route.ts) piu la capability corrispondente; lato client native/MediFlowMac/Sources/MediFlowAppleShared/HomeBasePatientsClient.swift e PairedPatientsWorkspaceModel.swift:2825; riferimento web components/siss-patient-context-panel.tsx:441-458`

### Agenda e Diario nativi non hanno alcuna lettura offline: senza home-base restano vuoti anche subito dopo una lettura riuscita

- Manca su: **ios+macos** · dominio: Viste trasversali: Agenda, Diario globale, Analytics
- Contratto: **contratto da creare** — `Parziale: il meccanismo di cache esiste (native/MediFlowMac/Sources/MediFlowAppleShared/HomeBasePatientCacheStore.swift:47) ma conserva solo la lista pazienti. Per checkup e voci la cache e da creare`
- File da toccare: `native/MediFlowMac/Sources/MediFlowAppleShared/HomeBasePatientCacheStore.swift, native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/ClinicalWorkspaceViews.swift:254-311 e :331-401`

### Spostare o assegnare un paziente a un ambulatorio diverso da quello in cui e nato. Nessuna delle tre superfici lo sa fare; l'appartenenza si fissa alla creazione e resta li.

- Manca su: **web+ios** · dominio: Ciclo di vita del paziente
- Contratto: contratto pronto — `si, abbondante e mai usato: app/api/patients/move/route.ts:16, /assign/route.ts:14, /unassign/route.ts:14, /duplicate/route.ts:15, piu ambulatoryId accettato dal PUT (lib/patient-write-normalization.ts:165) e la logica di appartenenza primaria in lib/patient-ambulatory-membership.ts`
- File da toccare: `web: hooks/use-patient-clipboard.ts:14 e gia scritto e non ha consumatori, va agganciato alla lista in components/kree8/areas/incarico-area.tsx, oppure un campo ambulatorio in components/patient-form.tsx; nativo: la stessa azione andrebbe in AppleFoundation/PairedPatientDetailSection.swift accanto alle altre voci di ciclo di vita. Vale anche per macOS, che condivide gli stessi file.`

## Tracce operative

Istruzioni per completare a mano cio' che resta, per dominio.

### Terapie

- Stato nel modulo web: in components/therapy-manager.tsx aggiungi un controllo di stato al form (tre voci Attiva, Sospesa, Conclusa, le stesse etichette di MediFlowCore/ClinicalStatusTypes.swift:38-46), valorizzalo in startEditing (:81-99) con setValue('status', therapy.status) e verifica che onSubmit (:121-129) non spedisca piu' il default. Se preferisci una correzione minima e sicura, in edit togli status dall'oggetto inviato a db.therapies.update: lo stato lo cambiano gia' Sospendi, Concludi e Riprendi.
- Date sul web: sempre in components/therapy-manager.tsx estendi therapySchema (:20-30) con startDate e endDate opzionali, aggiungi due campi data nella griglia del modulo (:311-404) e passa i valori a db.therapies.add (:132-144) e db.therapies.update (:121-129). Ricorda la trappola gia' annotata a riga :191-194: per cancellare endDate serve null esplicito, undefined viene rimosso da JSON.stringify e la rotta non azzera nulla.
- Ricerca ICD nel nativo: in PairedPatientTherapiesSection.swift sostituisci il Picker "Diagnosi collegata" (:364) con lo stesso schema gia' usato in PairedPatientDetailSection.swift:391-422, cioe' un TextField piu' ICDCatalog.search(query, limit: 6). Serve pero' portare anche il nome: oggi therapyDiagnosisName in PairedPatientsWorkspaceModel.swift:1907 lo risolve solo dalle diagnosi del paziente, quindi aggiungi due @Published (newTherapyDiagnosisName e editTherapyDiagnosisName) oppure fai cadere il codice scelto sul percorso model.addDiagnosis, che aggiunge la diagnosi alla cartella come fa gia' il web in therapy-manager.tsx:146-167. Per la voce Prevenzione usa il codice PREV e il titolo Prevenzione, esattamente come therapy-manager.tsx:379.
- Motivazione di annullamento sul nativo: il dialogo di conferma in PairedPatientsWorkspaceView.swift:236-246 non puo' ospitare un campo di testo, un confirmationDialog non lo accetta. Trasformalo in uno sheet dedicato sul modello di PairedDiaryDeleteSheet.swift, che risolve gia' lo stesso problema per il diario, e passa il testo raccolto a softDeleteTherapy come parametro al posto della costante. Usa l'etichetta del web per la richiesta, Motivazione dell'eliminazione, e il placeholder Es. inserimento duplicato (therapy-manager.tsx:222-223).
- Esportazione del piano sul web: aggiungi accanto a Nuova terapia, nell'intestazione della sezione in components/therapy-manager.tsx:254-266, un comando Esporta piano che produca lo stesso testo del nativo. Il canone e' TherapyPlanDocument.swift: intestazione Piano terapeutico (riepilogo), righe Paziente e Generato, gruppi In corso, Sospese, Concluse, terapie ordinate per nome farmaco, terapie annullate escluse. Se lo generi come PDF appoggiati a lib/report-service.ts:207-240 e ricorda che li' il filtro e' sulle sole attive.
- Vocabolario: se decidi di allineare anche le etichette, la coppia da scegliere e' una sola per la stessa operazione di soft delete. Oggi il web dice Elimina (therapy-manager.tsx:513-517) e il nativo dice Annulla (PairedPatientTherapiesSection.swift:294). Vale anche per il campo motivation, che il web chiama Indicazione o nota clinica (:357) e il nativo Motivazione (:361).
- Non toccare: la sezione Terapie e' un unico file condiviso montato sia da AppleFoundationViews.swift:326 sia da MacWorkspaceRootView.swift:201, senza rami #if os. Ogni modifica in PairedPatientTherapiesSection.swift arriva contemporaneamente a iPhone, iPad e Mac, quindi non servono duplicati per piattaforma.

### Scale cliniche

- Contesto della somministrazione sul nativo. Apri native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/ClinicalScaleFormView.swift e aggiungi nella prima Section, subito sotto il Text del punteggio (riga 38), un controllo di luogo con le due sole etichette gia' usate dal web: "Ambulatorio" e "Domicilio" (app/patients/[id]/scales/[scaleId]/page.tsx:129-155; il titolo della sezione web e' "Contesto", il sottotitolo "Dove viene somministrata"). Tieni i valori tecnici identici a quelli del web, cioe' ambulatory e home, non tradotti. Poi porta il valore fuori dal form cambiando la firma di onSubmit, e in native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceModel.swift alla funzione submitScale (riga 1053) passalo come argomento setting dell inizializzatore HomeBaseEntryCreatePayload alla riga 1084: il parametro esiste gia' con valore predefinito nil, quindi e' una riga sola. Ricordati dei due chiamanti del form, PairedPatientsWorkspaceView.swift:151-159 e ClinicalWorkspaceViews.swift:881-886, e del ramo DEBUG di seed alla riga 1068 che oggi scrive setting: nil.
- Storico scale sul web. Il dato e' gia' pronto: in app/patients/[id]/modules/page.tsx la costante scaleEntries alla riga 329 contiene esattamente le voci che servono, e oggi viene usata solo per il referto alla riga 636. Dentro la CollapsibleSection con id "scale" (riga 896), sotto i link di avvio, aggiungi l elenco degli esiti. Per decidere cosa mostrare in ogni riga copia la logica di native/MediFlowMac/Sources/MediFlowCore/ScaleHistoryPresentation.swift:37-54: titolo da metadata.title con ripiego sul titolo della voce, punteggio nella forma punteggio su massimo, interpretazione da metadata.interpretation con ripiego sulla riga di contenuto che inizia per Interpretazione:. Usa l intestazione nativa "Storico somministrazioni" (PairedScalesSection.swift:108) e, quando non c e' nulla, la stessa frase onesta del nativo, "Nessuna scala registrata per questo paziente." (riga 111). Se invece preferisci riammettere le scale nella timeline, il punto e' la riga 333 dello stesso file: il filtro e' commentato come scelta deliberata, quindi va rimosso consapevolmente e non per distrazione, e components/timeline-entry-card.tsx:232-241 disegna gia' punteggio e interpretazione senza modifiche.
- Rendere raggiungibile /scales. La pagina e' completa e orfana. Il posto piu' economico e' components/kree8/areas/scheda-area.tsx:98, dove la voce "Scale cliniche" oggi si limita a riaprire l area scheda: falla puntare a /scales quando nessun paziente e' selezionato, e lascia il comportamento attuale quando un paziente c e' gia'. Verifica anche components/kree8/areas/real-patient-area.tsx:337, che manda a modules#scale ed e' corretto cosi' nel contesto del paziente. Per coerenza con il nativo l etichetta di destinazione globale dovrebbe essere semplicemente "Scale", come la sezione in native/MediFlowMac/Sources/MediFlowAppleShared/AppleRolloutModel.swift:90.
- Punteggio dal vivo sul web. In components/scale-engine.tsx sposta le due chiamate della riga 72 e 73 fuori da finish(), calcolandole sullo stato answers a ogni render, e mostrale nell intestazione accanto alla barra di avanzamento (righe 87-95). Usa la stessa forma del nativo, "Punteggio: N/M", da ClinicalScaleFormView.swift:38. Per avere il denominatore serve un massimo teorico: il nativo lo ricava sommando l opzione piu' alta di ogni domanda (ClinicalScales.swift:34-36), quindi la stessa somma su scale.questions[].options funziona senza toccare lib/scale-definitions.ts. Attenzione: sul web una domanda non ancora risposta semplicemente non compare in answers, quindi il totale parziale e' corretto per costruzione, ma l interpretazione mostrata a meta' compilazione va etichettata come provvisoria per non farla leggere come esito.
- Allineare le aree del catalogo globale. In app/scales/page.tsx le righe 30-36 assegnano a mano due categorie che non esistono altrove. Sostituiscile con la stessa attribuzione gia' scritta in app/patients/[id]/scales/page.tsx:14-20, che coincide con PairedScalesSection.area(for:) del nativo: tinetti in Equilibrio, adl e iadl in Autonomia, mmse in Cognitivo, gds in Umore. Il raggruppamento alle righe 39-46 lavora gia' su quel campo e non va toccato. Vale la pena estrarre quella funzione in lib/scale-definitions.ts cosi' le due pagine web smettono di poter divergere di nuovo.
- Verifiche da fare dopo, senza fidarsi del solo compilato. Per il contesto: una scala inviata dal nativo deve produrre una voce con setting valorizzato, leggibile poi dal web; il confronto vero e' fra la voce creata dalle due superfici sullo stesso paziente sintetico su :3101, mai su :3000. Per lo storico web: le voci gia' salvate dal nativo devono comparire nella nuova sezione senza migrazioni, perche' la forma dei metadata e' gia' quella (ClinicalScales.swift:238-250). La prova nativa di riferimento esiste gia' ed e' MediFlowMobileAppUITests.swift:1249-1264, che apre ADL dal menu diario, verifica il punteggio dal vivo e invia: se aggiungi il controllo di luogo, quel test va esteso, non riscritto.

### Impostazioni, ambulatori e connessione

- Rinomina sul web: in app/settings/ambulatories/page.tsx aggiungi uno stato di riga dentro AmbulatoryNode (riga 131) e un handler modellato su handleSetDefault (riga 237), che gia legge target.version e chiama db.ambulatories.update; il corpo da mandare e' { name, version }. Usa l'etichetta del nativo, cioe' "Rinomina", e per coerenza con la riga nativa metti il pulsante accanto a "Usa come predefinita".
- Indirizzo sul nativo: in SettingsWorkspaceView.swift aggiungi una proprieta pubblicata newAddress a SettingsAmbulatoriesModel (riga 137) e passala a HomeBaseAmbulatoryCreatePayload(name:address:type:) nel metodo create (riga 184); il campo del form va dopo la riga 519 con l'etichetta del web, cioe' "Indirizzo (opzionale)". Per la modifica usa HomeBaseAmbulatoryUpdatePayload(expectedVersion:address:) con PatchValue, non una stringa nuda, altrimenti non si puo distinguere fra vuoto e omesso.
- Reparti sul nativo: sempre in SettingsWorkspaceView.swift, aggiungi un Picker sopra "Crea ambulatorio" con la stessa semantica del web, cioe' una voce "Sede principale" che vale nessun padre piu' l'elenco degli ambulatori gia caricati in ambulatoriesModel.ambulatories; passa parentId nel payload di creazione. Nella riga di lista (riga 596) mostra la relazione con la stessa frase del web, "Reparto di NOME", ricavando il nome dal parentId gia presente nel riepilogo.
- Associazione dal dispositivo: la POST degli intenti non chiede autenticazione, quindi l'app puo chiederla da sola. Aggiungi in HomeBasePatientsClient.swift una chiamata a /api/v1/network/pairing-intents con deviceName, clientPlatform, appVersion e requestedCapabilities (lo schema del corpo e' leggibile in scripts/network-home-base-ambulatory-write.test.mjs:52) e mostrala nel foglio di collegamento sopra i campi 41-44, cosi l'operatore legge un codice invece di incollare un token.
- Conferma sull'host dal web: la coppia elenco piu' conferma e' pronta ma vive dietro requireLocalApiToken, quindi una pagina di browser non la raggiunge come sta. O aggiungi una rotta parallela che usi requireSessionOrLocalToken come fa app/api/settings/[key]/route.ts:20, o leggi gli intenti da un componente server. La pagina va sotto app/settings/ e va registrata in lib/settings-navigation.ts nel gruppo "Sicurezza e Dati"; per le etichette riusa il vocabolario del nativo, cioe' "Dispositivi associati" e "Dissocia".
- Modalita operativa su macOS: HomeBaseHostAdminClient ha solo il verbo di lettura (riga 124). Aggiungi un metodo di scrittura verso /api/settings/network.mode con il cookie di sessione gia in mano allo store, e collegalo in HostAdminWorkspaceView.swift dentro networkSection (riga 270). Usa le stesse due parole del web, cioe' "Abilita home-base" e "Disattiva home-base", e tieni la scrittura dietro il controllo isLocalHost gia presente alla riga 30.
- Elenco capability sul nativo: ClinicalWorkspaceCapabilitiesStore conserva gia le chiavi in availableKeys (ClinicalWorkspaceViews.swift:132). Esponi una proprieta ordinata e disegnala come sezione di sola lettura in SettingsWorkspaceView.swift accanto a "Funzioni AI" (riga 428), riusando settingsStatusRow (riga 646) e la stessa dicitura Attivo e Disattivato gia usata per i kill switch.
- Allineamento lessicale, tre punti soli e tutti a costo zero: il web dice "Usa come predefinita" dove il nativo dice "Rendi predefinito"; il web dice "Nome medico" dove il nativo dice "Nome visualizzato" pur scrivendo lo stesso campo; il web dice "Privacy Mode" dove il nativo dice "Oscura contenuti clinici". Nei primi due casi conviene la parola del nativo perche' nomina l'oggetto reale, nel terzo conviene quella del nativo perche' e' in italiano e dice cosa succede.

### Diario clinico per paziente

- Modifica voce sul web, il pezzo grosso. Aprire components/timeline-entry-card.tsx e aggiungere un terzo pulsante accanto a Elimina, etichetta Modifica per restare sulla parola del nativo. Lo stato di modifica sta in components/timeline.tsx, che ha gia' il pattern giusto in handleRestore alle righe 53-76: legge entry.version, chiama db.entries.update e mostra il toast. Passare title, content e type; il 409 di conflitto e' gia' costruito da buildEntryVersionConflictPayload, quindi in caso di versione non coincidente dire di ricaricare, esattamente come fa il nativo nella frase di PairedPatientDiarySection.swift:364.
- Tipi di voce, il divario che sporca i dati e non solo l'interfaccia. Decidere una volta se il tipo di contatto a distanza si chiama remote o phone. Se si sceglie il nome web, aggiungere il caso a native/MediFlowMac/Sources/MediFlowCore/ClinicalStatusTypes.swift:8 con titolo Remoto e il corrispondente caso in EntryFiltering.swift:5. In ogni caso completare la mappa web components/timeline-entry-card.tsx:27 con phone e other, perche' oggi mostra la stringa grezza, e togliere other dal ramo default di clinicalEntryTypeLabel in lib/patient-workspace.ts:245, dove una voce Altro viene etichettata Nota, che e' peggio di non etichettarla.
- Motivazione di eliminazione. Il web la impone in components/timeline.tsx:26-35 con requireReason. Portare la stessa soglia sul nativo in PairedDiaryDeleteSheet.swift: cambiare l'etichetta del campo alla riga 16 da Motivazione (facoltativa) a Motivazione, e disabilitare il pulsante di conferma alla riga 46 anche quando la motivazione ripulita e' vuota. La rotta accetta gia' la motivazione sigillata, non serve toccare il boundary.
- Una parola per una azione, dentro il nativo. In PairedPatientDiarySection.swift la parola Annulla compare due volte con due significati: riga 295 elimina la voce, riga 350 scarta le modifiche. Portare la riga 295 su Elimina, che e' gia' la parola del foglio (PairedDiaryDeleteSheet.swift:26 e :44) e del web, e lasciare Annulla solo al gesto che scarta. E' lo stesso ragionamento del commit 48eee4cbc, applicato all'altra sponda.
- Data e luogo sul nativo. Il payload e' gia' pronto: HomeBaseEntryCreatePayload ha date e setting (MediFlowCore/HomeBaseModels.swift:875 e :877). Aggiungere nel composer di PairedPatientDiarySection.swift:372-427 un DatePicker e un Picker a due voci con le stesse parole del web, Ambulatorio e Domicilio da entries/new/page.tsx:429 e :443, poi smettere di passare Date() fisso in PairedPatientsWorkspaceModel.swift:1021 e passare setting invece di lasciarlo nullo.
- Template S/O/A/P sul web. Il nativo carica ClinicalSOAPTemplate.html nel documento editor e chiede conferma se il campo non e' vuoto. Sul web basta un pulsante accanto al titolo Scrivi la voce in app/patients/[id]/entries/new/page.tsx:690-712 che scriva lo stesso scheletro nello stato content, con la stessa etichetta Template S/O/A/P e la stessa domanda di conferma Sostituire il contenuto? gia' scritta in PairedPatientsWorkspaceView.swift:225-233.
- Allegati referenziati sul web. Aggiungere nella sezione #allegati di entries/new/page.tsx:714 un elenco a spunta degli allegati gia' del paziente, letti con db.attachments.query({ patientId: id }), e unire gli id scelti a quelli dei file appena caricati nell'array attachments passato a db.entries.add alla riga 305. L'etichetta del nativo e' semplicemente Allegati (ClinicalRichTextEditorView.swift:257), con Rimuovi tutti come azione secondaria.
- Filtro per tipo sul web. Le voci sono gia' tutte in memoria in modules/page.tsx:71-78, quindi e' un filtro locale. Metterlo in components/timeline.tsx accanto al toggle del cestino e usare le stesse cinque etichette del nativo, Tutte, Note, Visite, Telefoniche, Altre, che stanno in MediFlowCore/EntryFiltering.swift:16-24.
- Aggiornare docs/apple-parity-matrix.json prima di fidarsene. Due righe del dominio diario sono superate dai fatti: dichiara come residuo nativo la vista degli allegati, che ora esiste (PairedPatientDiarySection.swift:230-257), e descrive l'editor nativo come sola lettura, mentre ClinicalRichTextEditorView.swift e' un editor a blocchi completo. Il residuo vero che la matrice non nomina e' l'assenza di modifica sul web.

### Prescrizioni di servizio e protesiche

- Parti dal divario 1 perche gli altri sono cosmetici e questo blocca una funzione. Apri native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedClinicalTypes.swift e riscrivi quattro enum copiando i raw value da lib/prescription-domain.ts:2-15. PairedServicePrescriptionCategory diventa lab, imaging, visit, rehab, screening, procedure, other con titoli Laboratorio, Imaging, Visita, Riabilitazione, Screening, Procedura, Altro presi da components/service-prescription-manager.tsx:68-76. PairedServicePrescriptionPriority diventa routine, P, D, B, U, unknown con i titoli Routine, Programmata (P), Differibile (D), Breve (B), Urgente (U), Non indicata presi da :78-85. PairedPrescriptionSource diventa manual e document_review con Manuale e Da documento revisionato presi da :611-612; legacy_therapy_cleanup e solo di lettura, non va offerto nel picker. PairedProstheticPrescriptionCategory diventa standard, oxygen, repair, replacement, trial, other con i titoli di components/prosthetic-prescription-manager.tsx:45-52, e PairedProstheticPrescriptionStatus perde ordered e acquista draft, submitted, authorized secondo components/prosthetic-prescription-manager.tsx:35-43.
- Dopo aver toccato gli enum aggiorna i default in PairedPatientsWorkspaceModel.swift:211 (visit al posto di specialistica), :212 (routine al posto di p), :232 (standard al posto di ausilio) e gli stessi tre valori nelle funzioni di reset a :4175-4205, altrimenti il form riparte con un valore che non esiste piu.
- Per il divario 2 aggiungi in PairedClinicalTypes.swift due funzioni title(for:) statiche per categoria prestazione e categoria protesica, esattamente come quella gia presente per lo stato a :71, e usale in PairedPatientPrescriptionSections.swift:113 e :292 al posto di prescription.category. Per la priorita a :115 usa il titolo dell enum invece di priority.uppercased(), cosi Priorita ROUTINE torna a leggersi Routine.
- Il divario 6 e la modifica piu breve con il ritorno piu visibile. In SystemActions.swift:55-59 aggiungi static let protesicaRL con la stringa https://operatorisiss.servizirl.it/assistantrl/home/ presa da lib/siss-urls.ts:10, e lascia il commento che dice che la stringa e la stessa del web. Poi trasforma openPrregHandoff (PairedPatientsWorkspaceModel.swift:2825) in una funzione che riceve l URL e il nome del portale, mantenendo intatte le quattro combinazioni di esito copia e apertura. Infine aggiungi la voce Protesica-RL accanto a Prescrittivo regionale in PairedPatientDetailSection.swift:236-241 per iOS e in PairedPatientsWorkspaceView.swift:479-484 per macOS, usando l etichetta esatta del web, Protesica-RL, e il simbolo figure.walk.motion gia usato per la sezione protesica.
- Sui divari 4 e 5 la correzione sta in tre righe di PairedPatientsWorkspaceModel.swift. A :2569 cambia ordinal: index + 1 in ordinal: index. A :2577 sostituisci draft.serviceCode == nil con il valore gia calcolato a :2573, cioe decidi manual o unmatched sul risultato di ServicePrescriptionParsing.childServiceCode, che e quello che fa childServiceCodeForDraft nel web a components/service-prescription-manager.tsx:183-188.
- Il divario 3 si chiude in ServicePrescriptionParsing.swift:73-84 cambiando la base di open e reports da items a prescriptions, cioe filtrando prescriptions con la stessa condizione che il web usa a components/service-prescription-manager.tsx:239-246. Lascia total e items come sono: quelli combaciano gia.
- Prima di dichiarare chiuso il divario 1 aggiorna anche la prova, altrimenti resta invisibile come lo e stata finora. scripts/network-home-base-prescriptions-write.test.mjs:309-360 costruisce i payload con i valori del web, quindi il verde non ha mai toccato il vocabolario nativo. Serve o un caso che invii i valori prodotti dal picker nativo, o un test Swift che confronti PairedServicePrescriptionCategory.allCases.map(rawValue) con SERVICE_PRESCRIPTION_CATEGORIES, sul modello del golden contract gia usato per FHIR.
- Correggi la nota in PairedPatientPrescriptionSections.swift:50: dice che dopo il salvataggio la modifica testuale resta sul web, ma il web non ha nessun form di modifica per le prestazioni. La frase onesta e che nessuna superficie offre la modifica testuale post-creazione e che dal client nativo restano solo le transizioni di stato.
- In PairedPatientDetailSection.swift le proprieta patientHeaderActions (:177), patientHeaderActionsGrid (:259) e patientHeaderActionButtons (:270) non sono piu chiamate dal body, che dalla riga :35 usa primaryEditAction piu patientActionsOverflowMenu. Quel blocco morto contiene un secondo pulsante Prescrittivo regionale (:319-327) e fa credere, leggendo il file, che su iPhone l azione compaia due volte. Va rimosso o riagganciato, altrimenti ogni revisione futura del dominio ripete lo stesso errore di lettura.
- Il diario handoff (divario 7) e l unico che costa davvero, perche il contratto non esiste: non c e nessuna app/api/v1/network/siss-handoffs. Prima di scriverlo decidi se vuoi che il client nativo alimenti il diario o se il diario resti la memoria della sola postazione host. Se la risposta e la seconda, la strada onesta e piu corta e dichiararlo nella nota della sezione nativa e in docs/apple-parity-matrix.json:306, dove oggi il diario e elencato come residuo e non come scelta.

### Viste trasversali: Agenda, Diario globale, Analytics

- Titolo dell'appuntamento in Agenda nativa: aprire native/MediFlowMac/Sources/MediFlowCore/AgendaPresentation.swift, aggiungere una proprieta title ad AgendaCheckup (struct a riga 24), poi in native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/ClinicalWorkspaceViews.swift riga 295 passare $0.title, che HomeBaseCheckupSummary porta gia, e mostrarlo come titolo di riga a :601 spostando il nome paziente nella riga di metadati. Il web usa il ripiego "Appuntamento clinico" quando il titolo e vuoto, lib/patient-workspace.ts:182: usare la stessa parola.
- Stato e provenienza nel diario globale nativo: in native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/ClinicalWorkspaceViews.swift aggiungere a GlobalDiaryWorkspaceRow (riga 314) i campi ricavati da entry.metadata e entry.setting, popolandoli a :377-386. Le parole da riusare sono quelle del web in components/kree8/areas/diario-area.tsx:50-76: "Bozza", "Firmata", "Registrata" per lo stato, e "Ambulatorio", "Ospedale", "Assistenza domiciliare", "Diario locale" per la fonte, con prefissi "Fonte: " e "Autore: " come a :195-196. Le chiavi da leggere in metadata sono workflowStatus o status, e authorName, author o signedBy.
- Apri quadro da una riga: il gesto gia funzionante da copiare e in native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/ClinicalWorkspaceViews.swift:888-893, che chiama workspaceModel.loadPatient. Per Agenda e Diario serve in piu portare la selezione di sezione dentro le viste: su iPhone e iPad il binding e lo @State section di AppleFoundationViews.swift:201, usato a :323; su macOS e MediFlowMacSceneModel.select, MacWorkspaceRootView.swift:63. Passare una closure onOpenPatient alle due viste e cambiare sezione in .patients dopo loadPatient. L'etichetta da usare e "Apri quadro", la stessa del web.
- Nuova voce dal diario globale nativo: riusare il compositore gia presente in native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientDiarySection.swift:365-421. L'etichetta nativa esistente e "Nuova voce online", quella web e "Nuova voce": scegliere una sola parola e allineare entrambe, tenendo conto che il nativo scrive sempre online e la parola aggiuntiva dichiara un vincolo reale.
- Analytics raggiungibile sul web: aggiungere la voce in components/kree8/cockpit-shared.tsx, elenco AREAS a riga 141 e PRIMARY_AREA_IDS a riga 160, oppure un rimando esplicito dalla testata. Attenzione: AreaId (:41) e AREA_ID_VALUES (:52) non contemplano analytics e la pagina vive fuori dal cockpit, in app/analytics/page.tsx: la via meno invasiva e un collegamento verso /analytics accanto a Repertori, con etichetta "Analisi" coerente con l'eyebrow gia usato a app/analytics/page.tsx:239. La parola nativa e "Analytics", AppleRolloutModel.swift:89: decidere quale delle due vale su entrambe.
- Ritenta dopo errore sul web: in components/kree8/kree8-clinical-cockpit.tsx estrarre il fetch di riga 299 in una funzione richiamabile e offrire un comando nel ramo di errore del pannello, components/kree8/cockpit-shared.tsx:832-843. Stessa cosa in app/analytics/page.tsx: loadAuditSummary a riga 185 e gia una funzione, basta esporla e aggiungere il comando nel ramo di errore a :400-405. La parola nativa e "Aggiorna", ClinicalWorkspaceViews.swift:614.
- Analytics offline sul nativo: in native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/ClinicalWorkspaceViews.swift, PopulationAnalyticsWorkspaceModel.load (riga 419) deve ricevere anche i pazienti gia in memoria. Il modello di lista li carica con includeDiagnoses e li salva decifrati nella cache cifrata, PairedPatientsWorkspaceModel.swift:821-829 e :856-860, quindi il calcolo puo avvenire su workspaceModel.patients quando la rete fallisce. Dichiarare esplicitamente che il dato viene dalla cache, riusando la formula gia scritta per la lista: reviewLine in HomeBasePatientCacheStore.swift:16-20 e il messaggio "Home-base non raggiungibile" di PairedPatientsWorkspaceModel.swift:4016.
- cmd-R su macOS: in native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/MacWorkspaceRootView.swift, refresh() a riga 58 chiama sempre loadPatients. Far dipendere l'azione da scene.section, inoltrando a AgendaWorkspaceModel.load, GlobalDiaryWorkspaceModel.load o PopulationAnalyticsWorkspaceModel.load. Serve che quei modelli siano raggiungibili dalla scene: oggi sono @StateObject interni alle viste, quindi vanno spostati nella scene o esposti con un registro di ricarica.
- Lessico ancora disallineato dentro questo dominio, da decidere una volta e applicare su entrambe le sponde: web "Appuntamenti oggi" (components/kree8/areas/turno-area.tsx:180) contro nativo "Visite oggi" (ClinicalWorkspaceViews.swift:585); web "Agenda di oggi" (turno-area.tsx:201) contro nativo "Prossime visite" (:591); web "Diagnosi più ricorrenti" (app/analytics/page.tsx:343) contro nativo "Diagnosi più frequenti" (:770); web "Timeline recente" (diario-area.tsx:131) contro nativo "Voci recenti" (:675).
- Documentazione da correggere quando si tocca questo dominio: docs/design/lume/08-matrice-viste.md dichiara la vista macOS "assente" per Analytics e indica PairedPatientDiarySection come controparte del Diario globale. Entrambe le affermazioni sono superate: le controparti reali sono PopulationAnalyticsWorkspaceView e GlobalDiaryWorkspaceView in native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/ClinicalWorkspaceViews.swift, e l'Agenda nativa non compare affatto nella matrice.

### Documenti e FSE

- Verifica FSE documento singolo sul web. Apri native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientDocumentsSection.swift:456-553 e usalo come specifica: selettore Terapia/Osservazione, elenco dei record gia' caricati, pulsante "Verifica", esito con errori in rosso e avvisi in arancio. Sul web crea app/api/fse/validate-document/route.ts che chiami requireSession (come app/api/fse/validate-patient/route.ts) e poi validateFseDocumentPayload da lib/fse-validate-document.ts. Non riusare la rotta v1 dal browser: e' protetta da requireLocalApiToken. Etichette da tenere identiche al nativo: "Verifica FSE documento singolo", "Verifica", "Errore:", "Avviso:".
- Controllo FSE paziente sul nativo. In PairedPatientsWorkspaceModel.swift la chiamata esiste gia' a riga 2780 dentro prepareFHIRExport: estraila in un metodo autonomo che riempia una nuova proprieta' pubblicata, senza toccare il flusso di export. Poi aggiungi il riquadro in PairedPatientDocumentsSection.swift subito prima di fseDocumentValidationSection (riga 456). Per restare coerente col web copia le etichette di components/siss-patient-context-panel.tsx: intestazione "Controllo FSE locale", comando "Aggiorna", righe "Terapie" e "Parametri" nel formato "N record, N blocchi, N attenzioni", e gli stati "FSE pronta", "FSE: attenzioni", "FSE: blocchi".
- Condivisione del documento sul web. In components/document-upload.tsx il gruppo azioni sta a righe 422-462, gia' con Visualizza ed Elimina: aggiungi la terza azione li'. Il blob e' file.data, lo stesso che document-viewer.tsx:18 passa a URL.createObjectURL. Usa navigator.canShare per decidere fra condivisione di sistema e semplice scaricamento, esattamente come app/patients/[id]/modules/page.tsx:57-61. Etichetta "Condividi", per stare con il ShareLink nativo di PairedPatientDocumentsSection.swift:243.
- Condivisione del Report PDF sul web. In lib/report-service.ts la funzione chiude con doc.save(filename) a riga 341: falle restituire anche un File costruito da doc.output('blob'). Poi in app/patients/[id]/modules/page.tsx aggiungi il pulsante subito dopo "Report PDF" (righe 630-642) riusando lo schema di handleShareFhir (riga 578), compresa la gestione di AbortError come scelta e non come errore. Etichetta "Condividi", come PairedPatientTherapiesSection.swift:162.
- Caricamento multiplo sul nativo. Due modifiche in PairedPatientDocumentsSection.swift: allowsMultipleSelection a true in riga 91, e handlePickedAttachmentFile (riga 133) che invece di urls.first cicli su tutti gli URL accumulando gli errori di lettura in attachmentPickerError. Il modello non va toccato: uploadAttachmentForSelectedPatient e' gia' per singolo file. Se metti un tetto, allinealo ai 10 file del web dichiarati in components/document-upload.tsx:340.
- Cosa non toccare. Non aggiungere al nativo riprova OCR, revisione manuale, eliminazione documento, rimozione insight o svuotamento archivio: sono esclusioni deliberate di ADR 0076, il boundary paired non ha DELETE (app/api/v1/network/patients/[id]/attachments/) e la UI nativa lo dichiara gia' a PairedPatientDocumentsSection.swift:124 e :305. Cambiarlo e' una decisione di boundary, non un lavoro di parita'.

### Controlli e osservazioni

- Cambio stato controllo sul web, il pezzo piu' economico. Apri components/patient-form.tsx alla riga 182: c'e' un input type=hidden su checkups.N.status. Sostituiscilo con un select a tre voci dentro CheckupsFieldArray (righe 124-198), accanto a Data prevista e Prossimo passaggio. Usa le stesse tre etichette del nativo, prese da native/MediFlowMac/Sources/MediFlowCore/ClinicalStatusTypes.swift:58-67: Da fare, Completato, Annullato. Non serve toccare app/patients/[id]/edit/page.tsx, che alla riga 100 invia gia' status nel PUT, ne' la rotta, che alla riga 762 di lib/api-v1-clinical-write-normalization.ts lo valida gia'.
- Rendi visibile lo stato dove il controllo si legge, non solo dove si modifica. In app/patients/[id]/modules/page.tsx la riga follow-up (945-957) mostra titolo, note e data ma non lo stato, e la query alla riga 88 nasconde completed e cancelled. Se aggiungi il cambio stato senza mostrare lo stato, l'utente marca Completato e vede l'elemento sparire senza spiegazione.
- Modifica osservazione sul web. In components/observation-manager.tsx il form in cima (righe 319-457) ha gia' tutti i campi che servono: riusalo in modalita' modifica invece di scrivere una seconda forma. Il modello da copiare e' quello nativo in PairedPatientClinicalSections.swift:129-152, dove lo stesso form serve sia creazione sia modifica cambiando solo titolo e pulsante. Per la scrittura chiama db.observations.update(id, { ...campi, version }) come fa gia' app/patients/[id]/edit/page.tsx:96 per i controlli; il 409 va gestito come nel deleteObservation esistente (riga 295), che intercetta gia' ApiConflictError. Etichetta il pulsante Salva modifiche per restare allineato al nativo.
- Intervalli di riferimento sul nativo, tre file in sequenza. Primo, native/MediFlowMac/Sources/MediFlowCore/HomeBaseModels.swift: aggiungi refLow, refHigh e refText come String? a HomeBaseObservationSummary (righe 467-487) e ai due payload (1343-1419); il server li manda gia' in lib/network-observation-read.ts:37-39 e li accetta gia' in scrittura. Secondo, PairedPatientsWorkspaceModel.swift alle righe 2311 e 2377: passali nei payload di creazione e modifica. Terzo, PairedPatientClinicalSections.swift: due TextField nel form observationForm (461-532) e, nella riga observationRow (279-372), il riferimento accanto al valore piu' la pastiglia fuori-range. Per le etichette copia il web da components/observation-manager.tsx:415 e 426: Rif. min (opzionale), Rif. max (opzionale), e in lettura rif seguito da Alto o Basso.
- Non reinventare la classificazione fuori-range sul nativo: la regola vive in lib/observation-range (classifyObservationRange e formatReferenceRange) e il web la usa come sorgente unica proprio per non avere due verita'. Traducila in Swift una volta sola, in MediFlowCore accanto a CheckupFiltering.swift, e chiamala dalla vista, cosi resta verificabile con un test come gia' fa CheckupFiltering.
- Le due correzioni di catalogo sul nativo sono a una riga l'una e vanno insieme. In PairedPatientsWorkspaceModel.swift, dentro selectNewObservationCodeTerminology (2479) e selectEditObservationCodeTerminology (2492), scrivi item.displayIt ?? item.display invece di item.display, e imposta l'unita' da item.defaultUnit quando il campo unita' e' vuoto, esattamente come fa il web in components/observation-manager.tsx:345-348. Allinea poi la lista risultati in PairedPatientClinicalSections.swift:562 alla stessa preferenza, altrimenti l'utente sceglie una voce italiana e ne salva una inglese.
- Decisione da prendere prima di toccare il codice, non un divario: il verbo dell'eliminazione. Il web dice Rimuovi pianificazione (patient-form.tsx:147) ed Elimina misura (observation-manager.tsx:657), il nativo dice Annulla con una frase esplicita che nessun hard delete parte dal client (PairedPatientsWorkspaceView.swift:249-275). Sotto fanno la stessa cosa, cioe' scrivono deletedAt. Il verbo del web promette una cancellazione che non avviene; se vuoi una lingua sola, il termine onesto e' quello nativo.
- Per provare il cambio stato senza toccare pazienti veri usa l'istanza sintetica su :3101, mai :3000. I controlli di prova con i tre stati esistono gia' come fixture nativa in PairedPatientsWorkspaceModel.swift:576-589, uno per stato, utili come riferimento per popolare dati equivalenti lato web.

### Ciclo di vita del paziente

- Cestino sul web. Apri components/kree8/areas/incarico-area.tsx e guarda le righe 160-172: ci sono due chip, "Attivi" e "Archivio pazienti", governati da setList. Aggiungi un terzo chip "Cestino" e, quando e attivo, chiama GET /api/system/restore-patient (app/api/system/restore-patient/route.ts:15), che restituisce gia id, nome, cognome, deletedAt, deletionReason e version. Per il ripristino chiama POST sulla stessa rotta con { patientId }. Usa l'etichetta "Ripristina", non "Riattiva": la distinzione fra le due e stata fissata dal commit 48eee4cbc e il nativo la rispetta gia in PairedPatientsWorklistView.swift:320. Attenzione a una cosa sola: quelle rotte richiedono isWebAdminSession, quindi il chip va nascosto, non disabilitato, per chi non e admin.
- Data di nascita modificabile sul nativo. Il posto e PairedPatientDetailSection.swift, il blocco del modulo di modifica che comincia alla riga 339 con Text("Modifica anagrafica"). Copia il DatePicker che gia esiste nel foglio di creazione, PairedPatientsWorklistView.swift:905-908, con lo stesso interruttore "ha data di nascita". Poi in PairedPatientsWorkspaceModel.swift aggiungi editPatientBirthDate accanto agli altri campi di startEditingPatient (riga 1334) e passalo in savePatient (riga 1449). Non serve toccare niente sotto: HomeBasePatientUpdatePayload ha gia birthDate come PatchValue<Date> alla riga 1012 di HomeBaseModels.swift, e il server sa gia distinguere omesso, nullo e valorizzato.
- Tipo di presa in carico sul nativo. Stessa sede della traccia precedente. Le due voci del web sono "Continuativa" (taken_in_charge) ed "Episodica" (extemporaneous), le trovi in components/patient-form.tsx:450-451: usa esattamente quelle parole. Il campo "Motivo cambio stato" sul web compare solo quando il profilo cambia e in quel caso e obbligatorio (patient-form.tsx:460-465): replica la stessa condizione, altrimenti il nativo scrive uno statusReason vuoto dove il web ne pretende uno. I due campi del payload esistono gia, HomeBaseModels.swift:1004-1005.
- Motivo di archiviazione sul nativo. Qui, a differenza delle due tracce sopra, il contratto Swift va esteso: aggiungi archiveReason e archiveNote a HomeBasePatientUpdatePayload (HomeBaseModels.swift:993-1029), poi metti un Picker in PairedPatientArchiveSheet.swift con le tre voci che il web usa gia, "Assegnato a MMG", "Decesso", "Altro" (components/patient-action-modal.tsx:130-132), e la nota libera obbligatoria solo per Altro. I valori da mandare sono le chiavi assigned_mmg, deceased, other, non le etichette. Infine passali da setSelectedPatientArchived (PairedPatientsWorkspaceModel.swift:1546). Il server azzera i due campi da solo quando isArchived torna false, lib/patient-write-normalization.ts:182-183, quindi non c'e da gestire la pulizia alla riattivazione.
- Ambulatorio attivo sul web. La rotta e pronta e inerte: POST /api/context con { ambulatoryId } scrive il cookie, e tutti i lettori sono gia collegati. Serve solo un menu accanto ai chip di ambito in components/kree8/areas/incarico-area.tsx, alimentato da db.ambulatories.toArray() come fa app/settings/ambulatories/page.tsx:39. Chiama l'etichetta "Ambulatorio attivo", che e quella del nativo (PairedPatientsWorkspaceView.swift:125), e per lo stato senza filtro usa "Tutti gli ambulatori", come alla riga 989 dello stesso file.
- Ciclo di vita a portata di mano sul web. La barra azioni della scheda, app/patients/[id]/modules/page.tsx:594-640, ha gia Modifica, Esporta FHIR e Condividi FHIR. Aggiungi li un menu con Archivia, Riattiva ed Elimina, riusando components/patient-action-modal.tsx cosi non nascono due copie della logica: le funzioni da chiamare sono quelle di app/patients/[id]/edit/page.tsx:176-225, che gia gestiscono version e deletionReason. Cosi il gesto imparato su iPhone si ritrova dove ci si aspetta, e /edit resta il posto del modulo lungo.
- Prima di toccare PairedPatientDetailSection.swift, sappi che contiene codice morto che confonde le ricerche. patientHeaderActions alla riga 177 non e chiamato da nessuno, quindi patientHeaderActionsGrid (riga 259) e patientHeaderActionButtons (riga 270) sono irraggiungibili, e ripetono gli identificatori edit-patient-button, archive-patient-button, unarchive-patient-button e soft-delete-patient-button gia usati dal menu vivo alle righe 199-249. Se cerchi una etichetta per stringa la trovi due volte e una delle due non e sullo schermo; se scrivi un test di interfaccia rischi di agganciare quella sbagliata.
- Se vuoi chiudere davvero il duplicato di codice fiscale, non fermarti al client. Oggi la sola difesa e una conferma in app/patients/new/page.tsx:119, e il commento accanto ammette che lo schema non ha indice unico. Il controllo nativo va in PairedPatientsWorkspaceModel.swift:1296 (l'elenco pazienti e gia in memoria), ma la guardia vera va in lib/network-patient-write.ts e in app/api/patients/route.ts, altrimenti resta una cortesia dell'interfaccia e non una regola del dato.

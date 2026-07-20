# ADR 0081: contratto dell'export FHIR R4 v0

Date: 2026-07-20  
Status: Accepted

Related: [ADR 0005](./0005-web-native-functional-parity.md), [ADR 0006](./0006-terminology-plugin-and-fse-profiles.md), [ADR 0065](./0065-intended-purpose-and-claims-guard.md), WUL-457, WUL-472

---

## Problema

MediFlow esporta dati locali in un `Bundle` FHIR R4. Il codice corrente non
dichiara in modo completo quali dati include, quali dati rappresenta in parte
e quali dati esclude. Il web e il client Apple non usano ancora lo stesso
artefatto di prova. Alcuni testi dell'interfaccia possono anche far pensare a
una verifica FSE che il prodotto non esegue.

Serve un contratto verificabile prima di estendere il mapping.

## Contesto

- Lo storage MediFlow non è FHIR-native.
- L'export è locale, manuale e di sola uscita.
- I test e i gate di repository usano solo fixture sintetiche.
- La conformità alla base R4 non prova la conformità a profili HL7 Italia o
  FSE. Non prova neppure che un sistema terzo possa acquisire il file.
- La prima slice di WUL-457 ha reso deterministici gli ID web e ha allineato i
  riferimenti interni ai `fullUrl` assoluti.
- Il golden v1 è una fotografia storica usata dal client Apple. Non rappresenta
  più un contratto condiviso con il web.
- Il runtime corrente non applica ancora tutte le decisioni di questo ADR.

## Opzioni

1. Estendere subito il mapping esistente e documentare le omissioni dopo.
2. Dichiarare prima una matrice di copertura, poi allineare web, client Apple e
   validazione esterna in slice separate.
3. Attendere un profilo FSE completo prima di mantenere un export FHIR.

## Trade-off

- Opzione 1: riduce il lavoro iniziale, ma conserva claim ambigui e rende
  difficile verificare la parità.
- Opzione 2: limita ogni slice e rende visibili le esclusioni. Richiede più gate
  prima della chiusura.
- Opzione 3: evita un formato parziale, ma rimuove un trasporto locale utile e
  confonde la base R4 con i profili nazionali.

## Decisione

Adottiamo l'opzione 2.

### Forma dell'artefatto

- L'export v0 produce un `Bundle` FHIR R4 di tipo `collection`.
- `Bundle.timestamp` usa l'istante `generatedAt` fornito dal chiamante.
- `Patient.meta.lastUpdated` resta assente finché MediFlow non espone un
  timestamp clinico adatto.
- Ogni risorsa usa lo stesso UUID v5 come `resource.id` e come parte di
  `entry.fullUrl = urn:uuid:<uuid-v5>`. I riferimenti interni usano lo stesso
  URN. Il formato corrente `urn:mediflow:...` non fa parte del contratto v2 e
  deve essere rimosso prima del golden condiviso.
- Il namespace MediFlow è `37a44188-d8fa-52fb-8c50-94ccf1d3483f`. È il risultato
  di UUID v5 con namespace URL `6ba7b811-9dad-11d1-80b4-00c04fd430c8` e nome
  `https://github.com/Wulfgardr/mediflow/fhir-r4-v0`.
- Il nome di una risorsa persistita è il JSON compatto
  `["resource", ResourceType, sourceKind, sourceId]`. `sourceKind` è uno tra
  `patient`, `diagnosis`, `encounter`, `scale-observation`,
  `medication-statement` e `structured-observation`.
- Il nome di una diagnosi senza ID è il JSON compatto
  `["resource","Condition","diagnosis-derived",recordedAt,system,code,description,occurrence]`.
  `occurrence` è una stringa decimale, a partire da `1`, assegnata dopo
  l'ordinamento canonico.
- Ogni stringa del nome usa Unicode NFC. Il JSON non contiene spazi, non usa
  escape facoltativi per `/` o caratteri non ASCII e usa solo gli escape
  richiesti per controllo, `"` e `\\`. I byte passati a UUID v5 sono UTF-8
  senza BOM. Le fixture condivise contengono i byte del nome e l'UUID atteso per
  ogni `sourceKind` e per una diagnosi derivata.
- A input fisso, compreso `generatedAt`, l'output è deterministico. L'ora di
  export è l'unica variazione prevista tra due export degli stessi dati.
- Gli ID derivati sono identificatori tecnici del Bundle. Possono ripetersi per
  lo stesso input, ma non sono identificatori clinici autorevoli.
- Le `entry` usano questo ordine: `Patient`, `Condition`, `Encounter`,
  `Observation` derivate dalle scale, `MedicationStatement`, `Observation`
  strutturate. Dentro una categoria, il mapper ordina con queste tuple:
  diagnosi per `(recordedAt, system, code, description, id)`, incontri e scale
  per `(recordedAt, id)`, terapie per `(startDate, id)` e osservazioni
  strutturate per `(observedAt, id)`. Il confronto usa le stringhe normalizzate
  dal DTO e l'ordine lessicografico dei punti di codice Unicode.
- Una diagnosi senza ID usa la tupla canonica e l'occorrenza progressiva tra i
  duplicati identici per derivare l'ID tecnico. Il mapper assegna l'occorrenza
  dopo l'ordinamento. La permutazione degli array di input non cambia il
  Bundle. Una fixture con input permutato verifica questa regola.

### Regole comuni

- Il DTO v2 espone `patient.deletedAt`. Un paziente eliminato in modo logico
  non può essere esportato. Un paziente archiviato può essere esportato con
  `Patient.active = false`.
- Il DTO v2 espone `deletedAt` per diario, terapie e osservazioni. Il mapper
  esclude i record eliminati. I loader possono anche filtrarli prima per
  ridurre il lavoro, ma il test del mapper resta obbligatorio.
- Un valore clinico non mappabile non riceve un codice sostitutivo. Il mapper
  omette l'elemento facoltativo oppure blocca la risorsa se il campo FHIR è
  obbligatorio.
- Il DTO v2 distingue le date civili dagli istanti. `birthDate` e le date di
  inizio o fine terapia usano `YYYY-MM-DD`. `generatedAt`, `recordedAt`, le date
  del diario e `observedAt` usano un istante RFC 3339 in UTC. Il mapper non usa
  l'ora corrente come fallback.
- `birthDate` conserva la data civile `YYYY-MM-DD` già normalizzata dal
  contratto di scrittura paziente.
- Il controllo locale elenca ogni record di una categoria inclusa che non può
  essere mappato. Un errore blocca l'export; un warning permette l'export solo
  quando la matrice dichiara una degradazione senza perdita del testo sorgente.
  Le categorie dichiarate `Escluso` e i record eliminati sono conteggiati nel
  riepilogo, ma non generano un errore.
- Ogni esito usa questa forma stabile:
  `{ code, severity, category, recordId, path }`. `severity` è `error` o
  `warning`; `category` è `patient`, `diagnosis`, `entry`, `therapy` oppure
  `observation`; `recordId` è l'ID locale e `path` è un JSON Pointer nel DTO v2.
  Per una diagnosi senza ID, `recordId` è l'UUID v5 del nome compatto
  `["error","diagnosis",recordedAt,system,code,description,occurrence]`.
  Un campo assente usa JSON `null`; l'occorrenza è assegnata dopo l'ordinamento
  dei byte canonici del nome senza occorrenza. L'esito non copia testo clinico.
  Il controllo ordina gli esiti per
  `(severity, category, recordId, path, code)`.

### Matrice di copertura v0

| Dato MediFlow | Risorsa | Stato v0 | Regola |
| --- | --- | --- | --- |
| Identità paziente | `Patient` | Parziale | Include ID, stato archivio, codice fiscale, nome, cognome, data di nascita, indirizzo e telefono quando presenti. Il codice fiscale usa `Patient.identifier.system = urn:oid:2.16.840.1.113883.2.9.4.3.2`. Questo namespace non implica conformità a un profilo HL7 Italia. Omette `gender`. |
| Altri campi paziente | Nessuna | Escluso | Esclude caregiver, esenzioni, ADI, ambulatorio, note, profilo di monitoraggio, motivi di stato, insight AI e dati estratti dai documenti. |
| Diagnosi | `Condition` | Parziale | Include descrizione e codice disponibili. Il DTO v2 rinomina `date` in `recordedAt`: il campo rappresenta l'istante locale di registrazione o applicazione della diagnosi e diventa `recordedDate`. I writer correnti assegnano l'istante di inserimento manuale, applicazione Smart Import o creazione della decisione locale; non usano `documentDate`. Il campo è obbligatorio; se manca o non è valido, il controllo locale blocca l'export. Non inventa `clinicalStatus` e non emette `onsetDateTime`. |
| Diario di incontro | `Encounter` | Parziale | Include `visit`, `exam` e `access` con setting `home` o `ambulatory`; usa rispettivamente `HH` e `AMB`. Include `phone` e `remote` come `VR`, senza derivare la classe dal luogo. Include `hospitalization` come `IMP` solo con setting `hospital`. Le altre coppie tipo-setting sono errori bloccanti. Usa `type.text` con il tipo sorgente, `period.start` con l'istante registrato e non emette `period.end`. Stato `finished` perché il diario registra eventi già avvenuti; una futura entry pianificata o bozza non può usare questa regola. Titolo e testo libero restano esclusi. |
| Note di diario | Nessuna | Escluso | Le entry `note` non diventano `Encounter` e il loro testo non entra nel v0. |
| Terapie | `MedicationStatement` | Parziale | Include farmaco in testo, stato, dose, periodo e motivazione quando presenti. Mappa `active → active`, `suspended → on-hold` e `completed → completed`. Ogni altro stato genera `INVALID_MEDICATION_STATUS` e blocca l'export. `motivation` è testo libero che può contenere un'indicazione o una nota: il mapper lo conserva in `note.text` e non lo promuove a `reasonCode`. Le codifiche AIC/ATC dipendono da WUL-472. Il v0 testuale non genera warning per AIC, ATC o principio attivo mancanti. |
| Scale | `Observation` | Parziale | Richiede titolo non vuoto in `code.text` e punteggio in `valueInteger`. Include data e, se non vuote, interpretazione e nota. Usa `status = final`: nel dominio corrente una scala persistita è un risultato completato e non esiste uno stato preliminare. Un futuro stato bozza o preliminare richiede una nuova regola prima dell'export. Non genera `Encounter`. Lo zero è valido. Il punteggio deve essere un intero finito nell'intervallo signed 32-bit da `-2147483648` a `2147483647`. Titolo vuoto e valore vuoto, non numerico, frazionario o fuori intervallo sono errori bloccanti: non generano una risorsa parziale. Interpretazione e nota vuote vengono omesse senza warning. |
| Osservazioni strutturate | `Observation` | Parziale | Il v0 include solo valori numerici in `valueQuantity`, con codice LOINC e unità UCUM presenti nel sottoinsieme terminologico locale. Usa `status = final`: nel dominio corrente un'osservazione persistita è un risultato completato e non esiste uno stato preliminare. Un futuro stato bozza o preliminare richiede una nuova regola prima dell'export. Il DTO v2 conserva il lessema decimale; i due serializer devono emettere lo stesso numero JSON senza perdere zeri finali significativi. Sono validi zero e valori negativi. Valori testuali, vuoti, non finiti, codici LOINC sconosciuti e unità UCUM sconosciute sono errori bloccanti. Il v0 non usa `valueString`. |
| Checkup | Nessuna | Escluso | Il flusso di produzione non legge record checkup. Durante la migrazione, il DTO v1 può mantenere solo `checkups: []`; il DTO v2 rimuove il campo. |
| Allegati, documenti ed esenzioni | Nessuna | Escluso | Restano fuori dal v0. |

Per le diagnosi, il mapper usa solo questi sistemi dichiarati:

- `ICD-9` → `http://hl7.org/fhir/sid/icd-9-cm`
- `ICD-10` → `http://hl7.org/fhir/sid/icd-10`
- `ICD-11` → `http://id.who.int/icd/release/11/mms`

Se il sistema non è presente nell'elenco, `Condition.code` conserva solo il
testo. Il mapper non sceglie ICD-10 o ICD-11 come fallback.

Una diagnosi con sistema sconosciuto conserva `Condition.code.text`, omette
`coding` e genera un warning. Le altre degradazioni non dichiarate sono errori.

Se manca il setting di una entry che richiede un luogo, se la coppia
tipo-setting è contraddittoria o se un valore Observation non supera il
controllo terminologico, l'export si arresta. Se lo stato di una terapia non
appartiene al dominio locale, l'export si arresta:
`MedicationStatement.status` è obbligatorio e non ammette un fallback
inventato.

### Versione e parità

- Il golden v1 resta una fotografia storica del client Apple. Non è la baseline
  di parità dopo la prima slice di WUL-457.
- La nuova baseline usa una fixture e un Bundle atteso v2 in
  `contracts/fhir/`. Web e client Apple leggono gli stessi file.
- Il DTO v2 aggiunge `patient.deletedAt`, `deletedAt` alle tre collezioni
  cliniche, `diagnosis.recordedAt` e un lessema decimale per le osservazioni.
  Rimuove `checkups`.
- Ogni regola della matrice ha almeno un caso sintetico. I casi avversi coprono
  valori vuoti, zero, numeri negativi, decimali con zeri finali, valori non
  numerici, date mancanti, sistemi sconosciuti, codici LOINC e UCUM sconosciuti,
  ogni coppia tipo-setting ammessa o vietata e record eliminati.
- Le fixture non valide hanno un esito atteso condiviso. I due client devono
  rifiutarle con la stessa classe di errore; non basta che il decoder di un solo
  client fallisca.
- Le classi minime condivise sono `DELETED_PATIENT`, `INVALID_DATE`,
  `INVALID_ENCOUNTER_PAIR`, `INVALID_MEDICATION_STATUS`,
  `INVALID_SCALE_TITLE`, `INVALID_SCALE_VALUE`,
  `UNSUPPORTED_OBSERVATION_VALUE` e `UNKNOWN_TERMINOLOGY`.
- Le fixture terapia coprono i tre mapping ammessi e almeno uno stato
  sconosciuto. Le fixture scala coprono titolo vuoto, estremi signed 32-bit e
  valori fuori intervallo.
- La parità dei decimali confronta il token JSON serializzato. Un confronto tra
  valori numerici già convertiti non dimostra la conservazione della precisione.
- Il gate v2 passa solo se i due client producono lo stesso risultato per lo
  stesso input fisso.
- Il golden v1 non viene rimosso prima del passaggio del gate v2. Il suo ritiro
  avviene in una modifica separata e revisionabile.
- Le route stabili `/api/v1/network/fse/*` non vengono rinominate o rimosse in
  WUL-457. Il nuovo controllo dell'export resta locale al client. Un nuovo
  trasferimento del DTO decifrato richiede una decisione separata.
- Una modifica alla matrice aggiorna questo ADR, le fixture, il Bundle atteso,
  `docs/COMPLIANCE.md` e tutti i testi utente collegati all'export.

### Validazione

- I test di mapping interni restano il primo gate deterministico.
- Un gate separato esegue il validatore Java ufficiale HL7 FHIR sul Bundle v2
  sintetico. Il lock
  [`contracts/fhir/validator-lock.v1.json`](../../contracts/fhir/validator-lock.v1.json)
  fissa il validatore `6.9.12`, Java 17, FHIR `4.0.1`, il package
  `hl7.fhir.r4.core#4.0.1`, i nove package transitori richiesti e tutti i
  relativi SHA-256.
- La validazione avviene senza rete dopo l'acquisizione degli artefatti fissati.
  La CI può scaricare solo gli artefatti del lock e deve verificare SHA-256,
  nome e versione prima di creare una cache isolata. Durante la validazione,
  `fhir-settings.json` imposta `prohibitNetworkAccess = true`,
  `ignoreDefaultPackageServers = true` e `servers = []`. Il comando usa anche
  `-tx n/a`, `-txCache n/a`, `-jurisdiction global`, `-locale en-US` e
  `-show-message-ids`. Nessun Bundle o dato paziente viene inviato durante il
  download.
- Il gate esegue una prova con rete negata a livello di processo. La sola
  opzione `-tx n/a` non dimostra che la risoluzione dei package sia offline.
- Il gate fallisce per ogni errore o fatal. Ogni warning nuovo fallisce finché
  non è stato revisionato e registrato in una allowlist con percorso e motivo.
- Il gate analizza l'`OperationOutcome`; il solo codice di uscita del processo
  non è prova sufficiente.
- Un validatore scritto nel repository può aggiungere controlli locali, ma non
  sostituisce il gate esterno.
- Il validatore esterno non entra nel runtime prodotto.

### Linguaggio utente e claim

- L'interfaccia usa `controllo locale dei dati`, non `controllo FSE`,
  `validazione FSE` o `conformità FSE`.
- Il controllo locale verifica campi obbligatori, coppie tipo-setting, stati
  delle terapie e il sottoinsieme LOINC/UCUM delle osservazioni. Mantiene il
  vincolo numerico del v0, ma sostituisce i nomi e i testi FSE del pre-check
  corrente e usa le stesse classi di errore del DTO v2. Non valida il Bundle
  FHIR e non applica un profilo FSE.
- Il testo elenca i dati inclusi e le esclusioni principali. Non dichiara che
  note, checkup, allegati o documenti entrano nel file.
- MediFlow dichiara `export-only v0`. Non dichiara conformità FSE, conformità a
  profili HL7 Italia o compatibilità con un destinatario reale.

## Conseguenze

Il contratto rende le omissioni osservabili e permette di confrontare web e
client Apple. La chiusura di WUL-457 richiede più prove, ma non dipende da un
profilo nazionale non ancora implementato.

Le codifiche farmaco restano separate in WUL-472. Un futuro profilo FSE, un
destinatario reale, una validazione terminologica con rete o un nuovo flusso di
importazione richiedono una decisione dedicata prima dell'implementazione.

## First Thin Slice

1. Correggere il controllo locale e i testi: errori osservabili, nessun claim
   FSE e nessun percorso che accetti `valueString` nel v0.
2. Creare il DTO v2 e le fixture valide e non valide condivise.
3. Allineare il mapper web: UUID v5, timestamp, diagnosi, filtri,
   tipo-setting, periodi e decimali.
4. Escludere i checkup dal caricamento e portare lo stesso contratto nel client
   Apple.
5. Eseguire il gate HL7 e promuovere il golden v2 solo dopo il gate di parità.

## Regole di arresto

Fermare la promozione se una slice:

- include PHI/PII in Git o usa una fixture non sintetica;
- invia un `Bundle` o dati paziente fuori dal dispositivo;
- aggiunge un claim FSE o un profilo non provato;
- emette un codice clinico, uno stato o una data che la fonte non contiene e
  che questo contratto non deriva in modo esplicito da un invariante del
  dominio;
- cambia il contratto di importazione o lo storage autorevole;
- rompe il DTO condiviso tra due slice della migrazione;
- rimuove il golden v1 prima della parità v2;
- lascia una voce della matrice senza stato o senza caso di test.

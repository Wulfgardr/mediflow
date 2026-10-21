# ADR 0157 — Conformità HL7 verificabile ai confini clinici

Data: 2026-10-21. Stato: Accepted (2026-10-21), dopo la [review indipendente sulla PR #594](https://github.com/Wulfgardr/mediflow/pull/594#pullrequestreview-5598031969), revisione `7eb3f7235`.
Riferimenti: [WUL-784](https://linear.app/wulfgardr/issue/WUL-784),
[WUL-785](https://linear.app/wulfgardr/issue/WUL-785),
[WUL-744](https://linear.app/wulfgardr/issue/WUL-744),
[WUL-618](https://linear.app/wulfgardr/issue/WUL-618),
[WUL-756](https://linear.app/wulfgardr/issue/WUL-756).

Questo ADR registra le decisioni del 21 ottobre 2026 e i requisiti da
realizzare. Non attesta conformità del prodotto, esecuzione del gate,
accettazione da un destinatario o ammissione all'uso clinico.

## Problema

HL7 comprende standard diversi: FHIR, CDA e v2. Un'affermazione di conformità
richiede standard, versione, profilo e prove nominati; non esiste una
certificazione HL7 unica del prodotto. Occorre distinguere gli scambi clinici
interoperabili dai formati applicativi e dai trasporti, e la validazione
tecnica dalla pubblicazione FSE e dall'ammissione regionale.

## Contesto

La ricognizione del 21 ottobre 2026, sezioni A1–A4 e B1–B5, descrive il sorgente
al commit storico **`665bc851d90ceb32626f872a95747d922098b28b`**. Tutte le
citazioni `file:riga` di questa sezione si riferiscono a quel commit, non a
uno stato futuro di `main`:

- L'export Web produce una `collection`, senza profilo IPS dichiarato
  ([`lib/fhir/bundle-mapper.ts:15`](https://github.com/Wulfgardr/mediflow/blob/665bc851d90ceb32626f872a95747d922098b28b/lib/fhir/bundle-mapper.ts#L15)).
  Swift ha un generatore distinto
  ([`native/MediFlowMac/Sources/MediFlowCore/FHIRBundleGenerator.swift:260`](https://github.com/Wulfgardr/mediflow/blob/665bc851d90ceb32626f872a95747d922098b28b/native/MediFlowMac/Sources/MediFlowCore/FHIRBundleGenerator.swift#L260));
  la ricognizione rileva differenze di fullUrl, ID, fallback diagnostico e gender.
- Il lock esiste, ma il controllo della cache dichiara `execution: none`,
  `resourceValidation: NOT_RUN` e `profileConformance: NOT_RUN`
  ([`scripts/verify-fhir-validator-cache.mjs:66`](https://github.com/Wulfgardr/mediflow/blob/665bc851d90ceb32626f872a95747d922098b28b/scripts/verify-fhir-validator-cache.mjs#L66)).
  La configurazione CI esaminata non esegue il validatore ufficiale sui Bundle
  prodotti. Questa osservazione non ricostruisce la storia dei log CI remoti.
- Il precheck chiamato FSE controlla payload applicativi, non CDA o profili
  ufficiali ([`lib/fse-validation.ts:12`](https://github.com/Wulfgardr/mediflow/blob/665bc851d90ceb32626f872a95747d922098b28b/lib/fse-validation.ts#L12)).
  COMPLIANCE conserva il limite esplicito
  ([`docs/COMPLIANCE.md:127`](https://github.com/Wulfgardr/mediflow/blob/665bc851d90ceb32626f872a95747d922098b28b/docs/COMPLIANCE.md#L127)).
- Italia e Lombardia attraversano anche storage, cifratura, backup e contratti
  stabili: l'allowlist territoriale è condivisa
  ([`lib/db.ts:187`](https://github.com/Wulfgardr/mediflow/blob/665bc851d90ceb32626f872a95747d922098b28b/lib/db.ts#L187))
  e il ripristino include collezioni territoriali
  ([`lib/backup-restore-executor.ts:129`](https://github.com/Wulfgardr/mediflow/blob/665bc851d90ceb32626f872a95747d922098b28b/lib/backup-restore-executor.ts#L129)).
  Attivare un pacchetto e qualificare uno scambio sono responsabilità distinte.

Le decisioni nei commenti «Ricognizione completata… e decisioni» di WUL-784 e
WUL-785 del 21/10/2026 precisano il confine e il corpus CI. Leonardo ha scelto
il Profilo Sanitario Sintetico come primo documento italiano. Il commento
plugin di WUL-756 del 21/10/2026 comprende Codex e Claude e conserva una sola
superficie MCP e una sola autorità applicativa. WUL-744 mantiene la ricerca
sui profili e sulla fattibilità; WUL-618 coordina l'esecuzione 0.9.5.

### Decisioni precedenti conservate

- [ADR 0006](./0006-terminology-plugin-and-fse-profiles.md): layer locale dei
  sistemi terminologici e profili documentali, senza duplicazione nei form.
- [ADR 0065](./0065-intended-purpose-and-claims-guard.md): affermazioni pubbliche
  proporzionate alle prove, senza promessa di interoperabilità o integrazione regionale.
- [ADR 0081](./0081-fhir-r4-export-v0-contract.md): resta valido per l'export v0,
  la fedeltà del mapping, le esclusioni e le route stabili. Questo ADR estende
  il principio agli altri scambi, senza dichiarare realizzati i gate previsti.
- [ADR 0114](./0114-intelligent-host-aip-mcp-isolation.md) e
  [ADR 0117](./0117-headless-portable-agent-first-and-capability-first-fabric.md):
  MCP resta un adapter isolato dei servizi applicativi e del confine Headless;
  l'autorità, i gate di scrittura e le conferme restano nell'host e nella UI fidata.
- [ADR 0151](./0151-profile-contract-package-topology.md): contratti dei messaggi
  separati dagli owner degli effetti; passare un parser non concede autorità.
- [ADR 0155](./0155-account-profile-read-and-conditional-update.md): la lettura
  e la PUT condizionale dell'account restano contratti applicativi, con controllo
  di archivio, sessione e audit nel commit; non diventano scambi HL7.

## Opzioni

1. Applicare HL7 a qualsiasi file, messaggio e trasporto del prodotto.
2. Dichiarare ogni confine con il proprio contratto e richiedere la prova HL7
   agli scambi clinici interoperabili, per profili nominati e corpus coperto.
3. Conservare soli controlli locali e un'affermazione generica di supporto HL7.

## Trade-off

- L'opzione 1 confonde contenitore e contenuto e non descrive backup, CSV o RPC.
- L'opzione 2 richiede inventario, lock e prove per ciascun producer, ma consente
  affermazioni delimitate e verificabili anche con qualifiche esterne incomplete.
- L'opzione 3 non dimostra la conformità alle guide adottate.

## Decisione

Opzione 2, secondo le decisioni già fissate il 21 ottobre 2026.

### Confini e manifesto

HL7 si applica agli scambi clinici interoperabili: export FHIR, riepilogo IPS,
documenti FSE e futuri import. Backup, CSV, RPC interne, trasporto MCP/AIP e
PDF ordinario restano non HL7, con contratti propri verificabili. Un PDF che
incorpora CDA richiede la verifica del documento CDA e del suo confezionamento;
un contenitore valido non prova la correttezza del contenuto.

Un manifesto versionato deve censire ogni confine: direzione, producer e
consumer, canale, tipo di artefatto, contratto e versione, standard e profili
quando applicabili, provenienza, revisione del mapper e prova associata.
Deve esporre lo stato `validato`, `non HL7` o `non verificato`, con ambito ed
esito della verifica. Un profilo privo di prova resta non verificato; sospende
quell'affermazione, non la qualifica degli altri profili. Nessun badge HL7 si
applica a un contenitore non HL7.

### Prova di conformità

La prova richiesta è un corpus esclusivamente sintetico, emesso dai mapper
reali Web e Swift e serializzato attraverso i percorsi dichiarati. Un golden
scritto a mano o il controllo dei byte della cache non lo sostituiscono.
Il rapporto deve identificare revisione, producer, tipi di artefatto, vettori,
profili, versioni, hash e copertura. Un artefatto fuori dal corpus non eredita
l'affermazione di conformità del corpus.

La CI deve eseguire il validatore ufficiale fissato in
[`contracts/fhir/validator-lock.v1.json`](../../contracts/fhir/validator-lock.v1.json),
esteso ai pacchetti adottati e alla loro chiusura transitiva. La base esistente
fissa validatore 6.9.12, Java 17 e FHIR R4 4.0.1. Il prelievo verifica nome,
versione e SHA-256 di JAR e pacchetti; la successiva validazione usa cache
isolata e rete negata anche a livello di processo. Nessun dato paziente deve
accompagnare il prelievo. Il validatore Java non entra nel runtime prodotto.

Il gate analizza l'OperationOutcome: zero `error` e `fatal`; ogni warning nuovo
blocca salvo eccezione puntuale revisionata, con identificativo, percorso e
motivo. Il solo exit code non basta. I controlli locali possono aggiungere
vincoli, senza sostituire il validatore ufficiale.

La terminologia non risolta offline non diventa valida per il solo fatto che
il validatore riporta zero errori. Il rapporto CI deve elencare i binding
verificati e quelli non risolti, con pacchetti, licenze e limiti applicabili.
Non può dichiarare validità terminologica completa se controlli necessari
sono disabilitati o non risolvibili. Si conserva il layer di ADR 0006, senza
inventare equivalenze tra sistemi o codici.

Per i futuri import, originale e provenienza restano conservati; profilo
ignoto o contenuto invalido richiedono rifiuto o quarantena esplicita. La
validazione non autorizza sovrascritture: identità, proposta e revisione
restano nei servizi applicativi di WUL-618, con un solo database e writer.

### Profili e livelli territoriali

- **Internazionale:** FHIR R4 4.0.1; il riepilogo IPS è un artefatto separato
  `document` con Composition e profili di `hl7.fhir.uv.ips#2.0.1` (S1–S2).
  Include sezioni obbligatorie e distingue assenza nota da dato non disponibile.
  La `collection` storica resta export R4 base di ADR 0081 e non è IPS.
- **Italia:** primo documento il **Profilo Sanitario Sintetico, CDA-PSS 1.5**,
  scelto da Leonardo (S7). Richiede lock separato per XSD, Schematron, template
  e relativi OID, dizionari, motore e versioni/hash; la verifica deve coprire
  XML, estrazione dal PDF e corrispondenza alla rappresentazione leggibile.
  Il solo lock FHIR non qualifica CDA. `hl7.fhir.it.core#0.2.0` entra nel lock
  soltanto dopo la risoluzione della discordanza pubblicato/draft di S3–S4.
- **Lombardia:** i profili e i requisiti del destinatario restano specifici del
  servizio, entro il pacchetto territoriale WUL-785. Lombardia richiede Italia;
  l'attivazione per installazione è dichiarata dall'host, non dal client.
  Le installazioni esistenti conservano Italia + Lombardia; le nuove partono
  dal nucleo internazionale. Disattivare un pacchetto non elimina storico,
  chiavi, reader o contenuti del backup e non attribuisce qualifiche HL7.
- **HL7 v2:** si introduce soltanto per un'integrazione reale che lo richieda.
  Non è un obiettivo predefinito.

### Validazione, pubblicazione e plugin

Validare non significa pubblicare o ottenere accreditamento. S9 distingue
validazione FHIR e pubblicazione CDA2 in PDF PAdES; S10 segnala la dismissione
del repository di accreditamento e non conferma il sostituto operativo.
Nessuna promessa FSE o regionale è ammessa finché procedura vigente,
destinatario e requisiti di ammissione non sono verificati. La prova sintetica
non dimostra accettazione da terzi, equivalenza clinica o approvazione FSE.
README, COMPLIANCE e interfaccia devono nominare esattamente i profili
verificati, con copertura e limiti; il precheck locale va chiamato controllo
locale dei dati.

Il plugin di WUL-756 è separato come distribuzione ed esperienza, ma usa la
stessa superficie MCP e i servizi applicativi di ADR 0114/0117. Un contenuto
clinico interoperabile consegnato a Codex, Claude o altro host intelligente
segue la stessa dichiarazione e prova del profilo. Il trasporto MCP/AIP e
le proiezioni applicative non diventano HL7. Il plugin non acquisisce un
writer, credenziali, conferme o gate propri. Gli strumenti territoriali SISS
e protesica sono disponibili solo con il pacchetto Lombardia attivo.

## Conseguenze

Ogni affermazione sarà verificabile rispetto a una revisione e a un corpus
espliciti. Servono lock e prove distinti per R4, IPS e CDA-PSS; la ricerca
WUL-744 alimenta il lavoro esecutivo WUL-618 senza bloccare la base R4 per
l'assenza di un profilo nazionale qualificato. Nessuna modifica runtime,
migrazione dei dati o attivazione istituzionale è consegnata da questo ADR.

## First Thin Slice

La sequenza fissata è:

1. Correggere subito le promesse «validazione FSE» nell'interfaccia, come
   incremento distinto dal presente documento.
2. Review indipendente in PR completata (accettazione del 2026-10-21).
3. Eseguire il gate R4 base reale sui Bundle sintetici emessi da Web e Swift.
   Devono fallire le falsificazioni: gender illegale, riferimento rotto, byte
   del JAR alterato prima dell'esecuzione, warning nuovo non revisionato e
   `collection` presentata al validatore come IPS.
4. Allineare Web e Apple sul contratto condiviso e provare la parità del mapping.
5. Produrre e qualificare il riepilogo IPS separato.
6. Produrre e qualificare CDA-PSS 1.5 con il lock documentale dedicato.

## Verifica attesa

La PR del gate deve conservare output del validatore, copertura dei mapper,
report terminologico e risultati delle falsificazioni. Devono fallire anche
IPS senza Composition/sezioni obbligatorie, pacchetto con hash alterato e
tentativo di attribuire la prova a un artefatto non coperto. Le prove di
import devono distinguere rifiuto, quarantena e proposta senza commit.
Questi sono criteri futuri, non esecuzioni dichiarate da questo ADR.

## Fonti ufficiali datate

Il registro seguente riprende S1–S12 della ricognizione: consultazione
**21/10/2026**, su siti pubblici, senza accessi clinici. Date e stati sono
quelli rilevati allora. Prima di acquisire i lock, gli URL mobili devono essere fissati tramite commit o versione e hash degli artefatti.
Non si deduce da questo registro l'operatività di
un endpoint o la qualifica di un'installazione.

| Fonte | Versione, data e limite rilevato |
| --- | --- |
| S1 — [IPS](https://hl7.org/fhir/uv/ips/2.0.1/), [IG JSON](https://hl7.org/fhir/uv/ips/2.0.1/ImplementationGuide-hl7.fhir.uv.ips.json) | 2.0.1, STU2 active, R4 4.0.1; errata 19/06/2026. La CI build è distinta. |
| S2 — [Bundle IPS](https://hl7.org/fhir/uv/ips/2.0.1/StructureDefinition-Bundle-uv-ips.json), [Composition](https://hl7.org/fhir/uv/ips/2.0.1/StructureDefinition-Composition-uv-ips.json), [dati mancanti](https://hl7.org/fhir/uv/ips/2.0.1/en/Empty-Sections-and-Missing-Data.html) | Profili pubblicati 2.0.1; document, Composition, Patient; sezioni problemi, allergie e farmaci obbligatorie. |
| S3 — [Catalogo HL7 Italia](https://www.hl7.it/fhir/) | It-Core 0.2.0 elencato STU1 pubblicato, 20/05/2026, R4 4.0.1. |
| S4 — [It-Core IG JSON](https://www.hl7.it/fhir/core/0.2.0/ImplementationGuide-hl7.fhir.it.core.json) | 0.2.0, status draft, 30/07/2026; pagina Local Development build. Discordanza con S3 da risolvere. |
| S5 — [IG Italia](https://www.hl7.it/fhir/) | STU1 R4: LAB 0.2.0 22/09/2026, Taccuino 0.2.0 16/09/2026, Televisita 0.2.0 17/09/2025, Teleconsulto 0.2.0 15/10/2025, Teleassistenza 0.2.0 10/12/2025, Telemonitoraggio 0.2.0 12/01/2026. Non provano accettazione Gateway o Lombardia. |
| S6 — [CI build Italia](https://www.hl7.it/fhir/) | Terminology 0.1.2 24/06/2024, Dossier Farmaceutico 0.1.1 04/06/2024, CDA-to-FHIR Maps 0.1.0 11/04/2024: draft, non standard nazionali definitivi. |
| S7 — [CDA-PSS](https://www.hl7.it/realm-italiano/profilo-sanitario-sintetico-pss/), [CDA-RSA](https://www.hl7.it/realm-italiano/referto-di-specialistica-ambulatoriale-rsa/) | PSS 1.5/2025 normativo, ART-DECOR/Schematron; versioni precedenti obsolete. RSA 1.1 ART-DECOR/2026 normativo; PDF 1.1/2022 obsoleto. La scelta iniziale resta PSS. |
| S8 — [Realm CDA](https://www.hl7.it/realm-italiano/) | DocGen 1.0/2023, prescrizione farmaceutica 2.4/2026, specialistica 2.3/2023, esenzione 1.0/2018, televisita 1.0/2025 normativi: documenti diversi, non intercambiabili. |
| S9 — [Gateway ministeriale](https://github.com/ministero-salute/it-fse-support/blob/main/doc/integrazione-gateway/README.md) | 2.25 del 21/09/2026, §§2.1, 3–5: validazione CDA2/FHIR distinta dalla pubblicazione CDA2/PDF PAdES. |
| S10 — [Accreditamento](https://github.com/ministero-salute/it-fse-accreditamento), [processo pubblicato](https://github.com/ministero-salute/it-fse-support/blob/main/doc/accreditamento/README.md) | Avviso di dismissione 14/07/2026. Sostituto operativo non confermato; il processo leggibile, senza versione, non prova validità corrente. |
| S11 — [Supporto ministeriale](https://github.com/ministero-salute/it-fse-support), [Schematron](https://github.com/ministero-salute/it-fse-catalogs/tree/main/schematron) | Riferimenti XSD, cataloghi ed esempi reperiti al 21/10/2026; ruleset, licenze e hash non acquisiti integralmente. Portale standard documentali 403, Developers Italia /fse 404: matrice vigente non confermata integralmente. |
| S12 — [CDC ICD-10-CM](https://www.cdc.gov/nchs/icd/icd-10-cm/files.html) | FY2027, efficacia 01/10/2026–30/09/2027. Sistema distinto da ICD-11 e dalla stringa generica ICD-10; nessuna equivalenza automatica per deployment USA. |

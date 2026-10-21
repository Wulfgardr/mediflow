# ADR 0158 — Pacchetti territoriali

Data: 2026-10-21. Stato: Proposed.
Riferimenti: WUL-785, WUL-784, WUL-744, WUL-756, WUL-618;
ADR 0006, 0065, 0081, 0114, 0117, 0151, 0155.

Questo ADR registra le decisioni del 21 ottobre 2026. Definisce requisiti per
l'implementazione futura: non attesta un nucleo internazionale già disponibile,
una disattivazione già sicura o una conformità HL7 già provata.

## Problema

Italia e Lombardia attraversano navigazione, route, schema, cifratura, audit,
backup, cataloghi e client. Nascondere le voci SISS e protesica lascerebbe attive
altre vie di accesso e potrebbe rendere illeggibile lo storico se fossero
rimossi anche i componenti che lo interpretano.

La ricognizione del 21 ottobre 2026 fotografa il commit
[`665bc851d90ceb32626f872a95747d922098b28b`](https://github.com/Wulfgardr/mediflow/tree/665bc851d90ceb32626f872a95747d922098b28b).
Tutte le citazioni `file:riga` seguenti si riferiscono a quel commit:

- rail e pannelli territoriali fissi: [lib/patient-module-rail-mapping.ts:30](https://github.com/Wulfgardr/mediflow/blob/665bc851d90ceb32626f872a95747d922098b28b/lib/patient-module-rail-mapping.ts#L30),
  [app/patients/[id]/modules/page.tsx:828](https://github.com/Wulfgardr/mediflow/blob/665bc851d90ceb32626f872a95747d922098b28b/app/patients/%5Bid%5D/modules/page.tsx#L828);
- strutture persistenti SISS/protesica: [lib/schema.ts:241](https://github.com/Wulfgardr/mediflow/blob/665bc851d90ceb32626f872a95747d922098b28b/lib/schema.ts#L241)
  e [lib/schema.ts:329](https://github.com/Wulfgardr/mediflow/blob/665bc851d90ceb32626f872a95747d922098b28b/lib/schema.ts#L329);
- mapping di cifratura condivisi: [lib/db.ts:187–196](https://github.com/Wulfgardr/mediflow/blob/665bc851d90ceb32626f872a95747d922098b28b/lib/db.ts#L187-L196);
- ripristino delle collezioni: [lib/backup-restore-executor.ts:129](https://github.com/Wulfgardr/mediflow/blob/665bc851d90ceb32626f872a95747d922098b28b/lib/backup-restore-executor.ts#L129);
- sezione protesica Apple: [native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientPrescriptionSections.swift:10](https://github.com/Wulfgardr/mediflow/blob/665bc851d90ceb32626f872a95747d922098b28b/native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientPrescriptionSections.swift#L10).

È un inventario statico; non prova il funzionamento della separazione proposta.

## Contesto

L'[ADR 0006](./0006-terminology-plugin-and-fse-profiles.md) separa codifiche e
profili documentali dai form, ma non definisce il ciclo di vita territoriale.
L'[ADR 0065](./0065-intended-purpose-and-claims-guard.md) limita le affermazioni
pubbliche alle prove disponibili. Un pacchetto attivo non dimostra ammissione
SISS, accettazione FSE o conformità ai profili che dichiara.

L'[ADR 0081](./0081-fhir-r4-export-v0-contract.md) distingue export R4,
profili nazionali e accettazione da terzi; protegge inoltre le route stabili
`/api/v1/network/fse/*`. La separazione territoriale non le rinomina né le
rimuove senza la gestione contrattuale prevista per `/api/v1`.

Gli [ADR 0114](./0114-intelligent-host-aip-mcp-isolation.md) e
[0117](./0117-headless-portable-agent-first-and-capability-first-fabric.md)
conservano MCP come client degli Application Services attraverso AIP e il
confine Headless. L'[ADR 0151](./0151-profile-contract-package-topology.md)
separa contratti condivisi e autorità dell'host: validare un messaggio non
concede un'operazione. L'[ADR 0155](./0155-account-profile-read-and-conditional-update.md)
mostra la verifica corrente di sessione e archivio al commit; il territorio
non sostituisce quei controlli né diventa una proprietà del profilo account.

## Opzioni

1. Mantenere un assetto Italia/Lombardia unico e nascondere soltanto i link.
2. Separare nucleo, pacchetto nazionale e pacchetto regionale, con capacità
   autorevole per installazione e conservazione dello storico nel nucleo.
3. Separare prodotti e archivi per territorio.

## Trade-off

- Opzione 1: semplice per la navigazione, ma non governa writer, chiamate,
  client e conservazione.
- Opzione 2: richiede un contratto comune e prove su tutte le superfici;
  permette di cambiare assetto senza perdere o reinterpretare lo storico.
- Opzione 3: duplica contratti e migrazioni e complica la continuità dei dati.

## Decisione

Opzione 2, secondo le decisioni già fissate in WUL-785 il 21 ottobre 2026.

### Livelli e contributi

| Livello | Responsabilità |
| --- | --- |
| Nucleo internazionale | Assetto predefinito delle nuove installazioni; identità locale, dati clinici, servizi applicativi, ruoli, sessioni, cifratura, audit e backup. |
| Italia | Codice fiscale, esenzioni, AIFA e profili HL7 Italia. |
| Lombardia | SISS, protesica e tabelle documentali regionali; richiede il pacchetto Italia. |

Ogni pacchetto dichiara i propri contributi: navigazione, route, schema dati,
audit, cataloghi, profili di conformità, testi e strumenti MCP. La presenza
fisica di uno schema o di dati conservati non ne abilita le funzioni operative.
Il nucleo conserva il contratto delle codifiche e i componenti necessari a
leggere ogni dato storico; i pacchetti contribuiscono sistemi e workflow
territoriali senza riscrivere lo storage in FHIR.

### Attivazione e autorità

L'attivazione vale per installazione, mai per paziente. Una capacità dichiarata
e versionata dall'host è la sola autorità sullo stato territoriale. Il client
che si dichiara «Lombardia», un paese ignoto o una configurazione malformata
non abilitano capacità. Lombardia senza Italia non è un assetto valido.

Web, GPUI e Apple consumano la stessa regola. Le capacità memorizzate dal
client, scadute o precedenti a una disattivazione non riabilitano writer,
chiamate esterne o azioni dopo una riconnessione. L'host verifica lo stato
corrente nel servizio e al confine del writer; un controllo nella sola route
o nella UI non basta. Restano necessari sessione, ruolo, ambito, attualità,
CAS, audit e ogni altro requisito dell'operazione.

Gli strumenti SISS/protesica sono esposti dai plugin solo con Lombardia
attiva, entro le operazioni effettivamente ammesse dall'host. Come fissato
nel commento WUL-756 del 21 ottobre, Codex e Claude usano un solo server MCP
con manifest sottili distinti. Installazione, skill e testi del plugin sono
separabili dal runtime; l'autorità resta quella di MCP/AIP/Headless, senza
writer, credenziali o gate propri. Le conferme restano nell'interfaccia fidata.

### Chi cambia la capacità

Attivazione e disattivazione sono transizioni di un'operazione host dedicata,
di cui è proprietario funzionale il **gestore dell'assetto territoriale dell'host**.
Il nome identifica una responsabilità dell'host, non un nuovo ruolo utente né
una nuova UI. L'operazione ammette soltanto due canali:

- interfaccia fidata del nodo home-base, con sessione attiva e conferma esplicita;
- comando di manutenzione del supervisore locale.

Tutti gli altri canali sono negati: scritture generiche delle impostazioni,
client paired, autodichiarazioni, cache, plugin, MCP e Headless. La chiave
dell'assetto deve essere registrata come non scrivibile dai canali generici in
`lib/security/settings-write-policy.ts`. La sola persistenza nell'host non
basta: [la policy alle righe 116–128](https://github.com/Wulfgardr/mediflow/blob/665bc851d90ceb32626f872a95747d922098b28b/lib/security/settings-write-policy.ts#L116-L128)
ammette le chiavi non registrate dalle sessioni Web nella revisione citata.
Ogni transizione registra nell'audit l'assetto precedente e quello nuovo e
non effettua chiamate esterne.

Per ogni canale negato serve una prova di falsificazione distinta: un tentativo
di riattivazione deve lasciare la capacità disattiva, il writer operativo
territoriale negato e il conteggio delle chiamate esterne a zero.

### Migrazione conservativa

Per decisione di Leonardo, le installazioni esistenti mantengono Italia e
Lombardia attive come oggi; soltanto le nuove partono dal nucleo internazionale.
La migrazione iniziale usa un percorso host distinto, eseguito una sola volta,
che registra esplicitamente l'assetto dell'installazione. Non deduce
attivazione o consenso dalla presenza di un codice fiscale o di altri dati
paziente. Non elimina né converte i record già registrati.

### Disattivazione e conservazione

La disattivazione spegne i writer operativi territoriali e le chiamate esterne.
Il restore rimane una singola operazione del nucleo, con l'autorità e le
protezioni esistenti del ripristino: ripristina anche le collezioni territoriali
senza riattivare il modulo né effettuare chiamate esterne. Non concede
un'eccezione generica ai writer del modulo. La disattivazione non provoca `DROP`,
`cascade` o `purge`. Reader e decoder storici, chiavi e mapping di cifratura
restano nel nucleo compatibile, compresi i descriptor SISS/protesica di
`lib/db.ts:187–196` citati sopra. Lo storico resta raggiungibile attraverso
una consultazione in sola lettura anche quando scompare la navigazione operativa.

Si conservano identità e contenuto dei record, versioni e nomi degli eventi
audit, originali clinici e dei cataloghi, hash, snapshot delle voci usate e collegamenti.
Il dato mantiene semantica e versione del momento della registrazione: non è
rivalutato silenziosamente con il catalogo corrente. Il backup resta completo
indipendentemente dai pacchetti attivi, incluse collezioni territoriali, audit
e materiale necessario alla lettura e al ripristino.

La prova obbligatoria usa soltanto dati sintetici e questa sequenza:

**attivo → scrittura → disattivo → riavvio → lettura e audit → backup →
restore con modulo disattivo → lettura storica, decifratura e audit ancora
a modulo disattivo → riattivo**.

Prima della riattivazione, la prova deve confrontare con l'atteso precedente
il contenuto leggibile, i byte/hash degli originali, snapshot, versioni,
collegamenti e audit, verificando anche la conservazione dell'identità e del
ciphertext dove applicabile. Deve verificare che lo stato sia rimasto disattivo
e che una richiesta con capacità memorizzata prima della disattivazione resti
negata. Rendere indisponibile un decoder soltanto dopo il restore deve far
fallire la prova, anche se torna disponibile alla riattivazione.

In stato disattivo nessuna chiamata esterna né mutazione attraverso i writer
operativi territoriali è consentita. I casi includono
catalogo non installato, versione vecchia, backup legacy con assenza dell'audit
dichiarata e client con capacità memorizzate prima della disattivazione.

## Conseguenze

Il nucleo deve potersi avviare senza funzioni Lombardia operative; un pacchetto
attivo deve conservare il comportamento corrente. La conservazione rimane una
responsabilità del nucleo anche dopo la disattivazione.

Attivare Italia o Lombardia non concede conformità HL7 o accesso istituzionale.
WUL-784 fissa il principio di conformità verificabile; WUL-744 alimenta profili
e cataloghi, WUL-618 conserva l'esecuzione FHIR. Il contenuto clinico
interoperabile selezionato per un plugin segue gli stessi requisiti di profilo
e prova del relativo scambio; il trasporto MCP non è di per sé HL7.

Restano fuori dalla prima unità: rimozione del CF obbligatorio, lingua e
localizzazione, estrazione dei cataloghi italiani ancora nel nucleo e supporto
ICD-10-CM per gli USA. Questi residui impediscono di presentare la prima unità
come internazionalizzazione completa. ICD-10-CM è un sistema distinto da
ICD-10 e ICD-11, senza sostituzioni automatiche (fonte S12 sotto).

## First Thin Slice

La prima unità segue il §B5 della ricognizione del 21 ottobre 2026:

1. Contratto minimo di capacità per installazione, autorevole e versionato
   dall'host, con operazione dedicata e proprietario nominato, i soli due canali
   ammessi e prove di falsificazione per ogni canale negato prescritti sopra;
   migrazione conservativa iniziale su percorso host distinto e monouso.
2. Rail Web senza link, pannelli e query territoriali nel nucleo; con Italia e
   Lombardia attive, ordine, etichette e comportamento correnti.
3. Azioni laterali, deep link `#siss`/`#protesica`, PRREG, comandi e route
   SISS/protesica, inclusi import dei cataloghi, non aggirano lo stato
   disattivo. Rimane distinta la consultazione dello storico.
4. Apple senza sezione protesica, azione PRREG e fetch territoriali nel
   caricamento globale del nucleo; con pacchetto attivo, comportamento corrente.
5. GPUI verifica l'assenza attuale dei pannelli regionali e consuma le capacità
   comuni; non aggiunge pannelli solo per nasconderli. Dichiara i residui Italia.
6. Schema e storico conservati, con la sequenza completa di disattivazione,
   backup e ripristino del nucleo prescritta sopra; lettura storica, decifratura,
   confronto con l'atteso e audit dopo il restore e prima della riattivazione,
   ancora a modulo disattivo, inclusa la falsificazione del decoder.
7. CI con assetti nucleo e Italia+Lombardia, archivi sintetici, contratti e
   policy, rendering, chiamate e smoke UI Web/GPUI/Apple. Il nucleo si avvia e
   passa i test senza Lombardia; l'assetto attivo mantiene il comportamento
   corrente. Forzare un `href`, un `fetch` o una route a ignorare la capacità
   deve far fallire una prova dedicata.

Non occorre separare subito tutte le tabelle; occorre dimostrare che lettura
e ripristino non dipendono dall'operatività del pacchetto. Queste sono prove
di accettazione future, non verifiche eseguite da questo ADR.

## Fonti e data delle evidenze

Le decisioni sono nei commenti «Ricognizione completata … e decisioni» del
**21 ottobre 2026** di [WUL-785](https://linear.app/wulfgardr/issue/WUL-785)
e [WUL-784](https://linear.app/wulfgardr/issue/WUL-784), e nel commento plugin
del **21 ottobre 2026** di [WUL-756](https://linear.app/wulfgardr/issue/WUL-756).
Contesto: [WUL-744](https://linear.app/wulfgardr/issue/WUL-744) e
[WUL-618](https://linear.app/wulfgardr/issue/WUL-618), riscritte il 9 ottobre 2026.
Le citazioni del sorgente sopra riportano la revisione storica esatta.

Le fonti ufficiali S1–S12 della ricognizione sono state consultate il
**21 ottobre 2026**. Le date seguenti sono quelle registrate nella ricognizione,
non una nuova verifica dei servizi esterni.

| Fonti | Versione e data | Limite pertinente |
| --- | --- | --- |
| S1–S2: [IPS e profili](https://hl7.org/fhir/uv/ips/2.0.1/) | 2.0.1, errata 19 giugno 2026, pubblicato STU2 su R4 4.0.1. | Riepilogo documentale separato dall'export collection. |
| S3–S4: [catalogo HL7 Italia](https://www.hl7.it/fhir/), [It-Core](https://www.hl7.it/fhir/core/0.2.0/) | 0.2.0: catalogo 20 maggio 2026, STU1; IG draft 30 luglio 2026. | Discordanza da risolvere prima di inserire It-Core nel lock dei profili adottati. |
| S5–S6: [guide italiane](https://www.hl7.it/fhir/) | LAB 0.2.0 del 22 settembre 2026; Taccuino 0.2.0 del 16 settembre 2026; Terminology 0.1.2 del 24 giugno 2024 sotto CI/draft. | Guide per casi distinti; bozze e tabelle illustrative non sono profili nazionali definitivi. |
| S7–S8: [CDA-PSS](https://www.hl7.it/realm-italiano/profilo-sanitario-sintetico-pss/), [realm CDA](https://www.hl7.it/realm-italiano/) | PSS 1.5/2025; RSA 1.1, edizione ART-DECOR 2026; documenti normativi distinti. | Leonardo ha scelto CDA-PSS 1.5 come primo documento italiano. Attivare Italia non ne prova la conformità. |
| S9: [Gateway FSE](https://github.com/ministero-salute/it-fse-support/blob/main/doc/integrazione-gateway/README.md) | 2.25, 21 settembre 2026. | Validazione FHIR distinta dalla pubblicazione CDA2/PDF PAdES e dall'accettazione di un destinatario. |
| S10–S11: [accreditamento](https://github.com/ministero-salute/it-fse-accreditamento), [ruleset](https://github.com/ministero-salute/it-fse-catalogs/tree/main/schematron) | Avviso di dismissione 14 luglio 2026; riferimenti XSD/Schematron consultati il 21 ottobre 2026. | Procedura sostitutiva non confermata; ruleset, licenze e hash da fissare prima dell'adozione. |
| S12: [CDC ICD-10-CM](https://www.cdc.gov/nchs/icd/icd-10-cm/), [file ufficiali](https://www.cdc.gov/nchs/icd/icd-10-cm/files.html) | FY2027, efficacia 1 ottobre 2026–30 settembre 2027. | Per gli USA sistema, versione e provenienza distinti; ICD-11 non sostituisce automaticamente ICD-10-CM. |

Gli URL non versionati sono riferimenti editoriali mobili: l'implementazione
fisserà i byte e gli hash adottati. Nessuna di queste fonti dimostra ammissione
regionale o accettazione dei documenti di MediFlow da parte di un sistema reale.

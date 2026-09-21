---
summary: "MF085-004: native export projection preserves archive status and recorded care setting without migrating FHIR v1."
read_when:
  - "Reviewing or verifying the independent native FHIR lifecycle correction."
---

# FHIR: correzione lifecycle nativa MF085-004

<!-- @Codex -->

Run: `mf085-fix-c-fhir-20260904`. Base: `517304cdd07e5e4845dce300ae7754e4add28c73`.
Stato registrato per questa run: **candidato da verificare e integrare
localmente**, non rilascio attestato.

## Decisione e ambito

L’export deve conservare lo stato di archivio del paziente e il luogo di cura
registrato, senza cambiare il significato del generatore v1. Il chiamante
`PairedPatientsWorkspaceModel.prepareFHIRExport` usa
`FHIRBundleDTOAdapter.input` e poi `encodedBundleData`; nella correzione qui
descritta, l’adattatore trasferisce `HomeBasePatientDetail.isArchived` e
`HomeBaseEntrySummary.setting` nei campi già esistenti di `FHIRPatientInput` e
`FHIRClinicalEntryInput`.

Il generatore v1 continua quindi a tradurre `isArchived == true` in
`Patient.active = false` e `setting == home` in `Encounter.class.code = HH`.
Un paziente attivo resta attivo e `ambulatory` resta `AMB`.

La patch MF085-004 fornita viene riusata verificando le firme dei costruttori
sulla base congelata. L’intervento resta nella proiezione: non cambia
generatori, loader, route pubbliche, autenticazione, cifratura, autorità di
scrittura o persistenza e non introduce uscite di dati. Le voci contrassegnate
come eliminate continuano a essere escluse sia dall’adattatore sia dal mapper:
archiviare un paziente e cancellarlo restano operazioni diverse.

## Limiti espliciti

Un valore opzionale assente resta assente anche nella proiezione: correggere
il trasferimento dei campi non significa introdurre la validazione v2. Per la
stessa ragione, trasferire `hospital` non attesta la mappatura `IMP`, che resta
nel debito v2. Non vengono introdotti il controllo v2 sul paziente eliminato
né modifiche ai ripieghi storici per diagnosi, date o osservazioni.

MF085-005 resta un debito noto secondo
[ADR 0081](./adr/0081-fhir-r4-export-v0-contract.md), che è il riferimento
canonico. Il risultato atteso storico, il golden v1, rimane immutato. La
correzione non dichiara parità Web/Swift, validazione HL7, conformità FSE o
interoperabilità con destinatari reali.

## Verifica

I test `FHIRBundleDTOAdapterLifecycleTests` coprono paziente archiviato e
attivo, domicilio e ambulatorio, valori opzionali assenti, trasferimento del
setting hospital, voci eliminate, lista mista, controllo diretto del mapper e
JSON prodotto dal serializer realmente usato dal chiamante.

Il comando previsto per la run richiede un ambiente già predisposto, senza
acquisire dipendenze durante l’esecuzione:

```sh
swift test --package-path native/MediFlowMac --skip-update --filter 'FHIRBundle(DTOAdapterLifecycle|Generator)Tests'
```

La suite Foundation isolata fornita nell’artefatto compila i file reali, ma
resta una verifica supplementare: non sostituisce SwiftPM, Xcode/Apple, UI o
controlli di release. Per l’integrazione occorre applicare `01-lifecycle.patch`
alla base esatta e rieseguire le verifiche richieste da `CONTRIBUTING.md`.
La patch non dipende dallo stage 02.

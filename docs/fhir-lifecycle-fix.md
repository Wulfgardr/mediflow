---
summary: "MF085-004: native export projection preserves archive status and recorded care setting without migrating FHIR v1."
read_when:
  - "Reviewing or verifying the independent native FHIR lifecycle correction."
---

# FHIR: correzione lifecycle nativa MF085-004

<!-- @Codex -->

Run: `mf085-fix-c-fhir-20260904`. Base: `517304cdd07e5e4845dce300ae7754e4add28c73`.
Stato: **candidato da verificare e integrare localmente**, non rilascio attestato.

## Decisione e ambito

Il caller `PairedPatientsWorkspaceModel.prepareFHIRExport` usa
`FHIRBundleDTOAdapter.input` e poi `encodedBundleData`. L'adattatore trasferisce
ora `HomeBasePatientDetail.isArchived` e `HomeBaseEntrySummary.setting` nei
campi già esistenti di `FHIRPatientInput` e `FHIRClinicalEntryInput`.
Il generatore v1 continua a tradurre `isArchived == true` in `Patient.active = false`
e `setting == home` in `Encounter.class.code = HH`.
Un paziente attivo resta attivo; `ambulatory` resta `AMB`.

La correzione riusa la patch MF085-004 fornita, verificandone le firme dei
costruttori sulla base congelata. Non cambia generatori, loader, route pubbliche,
autenticazione, cifratura, autorità di scrittura o storage. Non introduce egress.
Le entry tombstone continuano a essere escluse sia dall'adattatore sia dal
mapper. Archivio e cancellazione non sono sinonimi.

## Limiti espliciti

I valori opzionali assenti rimangono assenti nella proiezione; il comportamento
v1 preesistente non viene convertito surrettiziamente in validazione v2.
Il trasferimento di `hospital` non attesta il mapping `IMP`, ancora parte del
debito v2. Non viene introdotto il guard v2 del paziente eliminato e non si
interviene sui fallback storici di diagnosi, date o osservazioni.
MF085-005 resta debito noto secondo
[ADR 0081](./adr/0081-fhir-r4-export-v0-contract.md), che rimane la fonte canonica.
Il golden v1 storico resta immutato. Non si dichiara parità Web/Swift,
validazione HL7, conformità FSE o interoperabilità con destinatari reali.

## Verifica

I test `FHIRBundleDTOAdapterLifecycleTests` verificano archivio, attivo,
domicilio, ambulatorio, assenze opzionali, trasferimento del setting hospital,
entry eliminate, lista mista, guard diretto del mapper e JSON prodotto dal
serializer effettivamente usato dal caller.

Su ambiente già predisposto, senza acquisire dipendenze durante questa run:

```sh
swift test --package-path native/MediFlowMac --skip-update --filter 'FHIRBundle(DTOAdapterLifecycle|Generator)Tests'
```

La suite Foundation isolata fornita nell'artefatto è supplementare: compila i
file reali ma non sostituisce SwiftPM, Xcode/Apple, UI o gate di release.
Per l'integrazione applicare `01-lifecycle.patch` alla base esatta e rieseguire
le verifiche richieste da `CONTRIBUTING.md`. La patch non dipende dallo stage 02.

---
summary: "Vista umana derivata della capability-mapping basis 0.8.5 candidata locale."
read_when:
  - "Verificare copertura, residui e claim ceiling del mapping WUL-522."
  - "Leggere la matrice machine-readable senza interpretare mapping non provati."
---

# MediFlow 0.8.5 — Capability mapping v1

Stato: **candidate locale, non integrata**. Questa pagina deriva dalla matrice
machine-readable [`mapping-basis.v1.json`](./mapping-basis.v1.json) e dalla
[`coverage receipt`](./coverage-receipt.v1.json); inventari, relazioni e
conflitti restano nei rispettivi file JSON referenziati dalla matrice.

## Provenienza congelata

Il manifest sorgente ha SHA-256
`17e231ff12773fc2926fc65e879b39c32bf1929f1d42ce824e2293047591cce1`.
Comprende nove head indipendenti: baseline, C0, AIP/Mini, Web, keyboard,
iOS/iPadOS runtime, documenti iOS/iPadOS, macOS runtime e macOS receipt.
`applyPolicy` è `none` in ogni artefatto di mapping.

## Copertura registrata

| Popolazione | Record | Disposizione |
| --- | ---: | --- |
| Anchor Web/Mini | 66 | 66 `mapped` source-local |
| AIP | 109 | 109 `mapped` source-local |
| Fabric | 16 | 16 `mapped` source-local |
| Superfici prodotto | 179 | 179 `unmapped` con authority e stage `unresolved` |
| Relazioni provate | 82 | 66 Web↔Mini `supports`; 16 AIP↔Fabric `exact_identity` |
| Conflitti residui | 16 | Fabric↔anchor, tutti `conflicted` e assegnati al product owner |

`ledgerComplete=true`: le popolazioni congelate sono presenti una sola volta,
hanno una disposizione terminale e una prova source-bound.
`semanticBindingComplete=false`: le 179 superfici non hanno una relazione
semantica diretta provata e i 16 conflitti Fabric↔anchor richiedono una
decisione di prodotto.

## Conflitti e prova necessaria

Il register completo è
[`fabric-canonical-unmapped.v1.json`](./conflicts/fabric-canonical-unmapped.v1.json).
Ogni record conserva fatto osservato, ambiguità, alternative, conseguenze,
owner di prodotto e prova richiesta. Per ognuno serve una crosswalk sorgente
accettata e versionata oppure un record canonico che nomini esplicitamente il
relativo `FabricCapabilityId`.

Per le superfici prodotto serve una relazione diretta, versionata e provata
verso una capability canonica. Nome, ordine e prossimità non costituiscono
prova; authority e stage non sono dedotti né uniti.

## Claim ceiling e guard

> mapping candidate locale verificato su exact head indipendenti; non integrato, non release-ready, non released

Il validator falsifica record mancanti, extra o duplicati, digest dei source
set driftati, vocabolari sconosciuti, receipt conflittuale collassata, union di
authority o stage, `applyPolicy` diverso da `none` e completion incompatibili
con elementi `unmapped` o `conflicted`. Non è una review indipendente, una
promotion né un'autorizzazione ad applicare cambiamenti.

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
`283b818c4d83854a333cb36b43683049ce657ee76bf4458f3c817032034a9a07`.
Comprende nove head indipendenti: baseline, C0, AIP/Mini, Web, keyboard,
iOS/iPadOS runtime, documenti iOS/iPadOS, macOS runtime e macOS receipt.
`applyPolicy` è `none` in ogni artefatto di mapping.

## Copertura registrata

| Popolazione | Record | Disposizione |
| --- | ---: | --- |
| Anchor Web/Mini | 66 | 66 `mapped` source-local |
| AIP | 109 | 109 `mapped` source-local |
| Fabric | 16 | 15 `mapped`; 1 `out_of_catalog` senza consumer non-test |
| Superfici prodotto | 177 | 6 `mapped` Mini; 171 `out_of_catalog` source-bound |
| Relazioni provate | 127 | 66 Web↔Mini `supports`; 16 AIP↔Fabric `exact_identity`; 23 edge funzionali Fabric↔catalogo; 16 exposure verso Web-65; 6 comandi Mini↔anchor |
| Conflitti residui | 0 | I 16 conflitti Fabric↔anchor sono risolti dalla decisione prodotto versionata |

`ledgerComplete=true`: le popolazioni congelate sono presenti una sola volta,
hanno una disposizione terminale e una prova source-bound.
`semanticBindingComplete=true`: tutti i record hanno una disposizione positiva
e provata. Le 166 superfici Web e le 5 superfici Apple restano
`out_of_catalog`; la disposizione non concede authority o stage.

## Conflitti e prova necessaria

La decisione prodotto è ricevuta in
[`fabric-product-crosswalk-receipt.v1.json`](./fabric-product-crosswalk-receipt.v1.json).
Le relazioni derivate sono in
[`fabric-canonical-bindings.v1.json`](./relations/fabric-canonical-bindings.v1.json):
Web-65 è un'esposizione del roster, non un'identità. `document_identity_resolution`
resta `out_of_catalog` fino a un consumer non-test provato.

La receipt delle disposizioni è
[`surface-terminal-dispositions.v1.json`](./surface-terminal-dispositions.v1.json).
I sei comandi Mini sono legati al rispettivo anchor tramite la gerarchia
esplicita del manifest; ogni altra superficie è fuori dal catalogo chiuso.
I mockup congelati restano evidence-only nel
[`mockup-boundary.v1.json`](./mockup-boundary.v1.json), non superfici prodotto.
Nome, ordine e prossimità non costituiscono prova; authority e stage non sono
dedotti né uniti.

## Claim ceiling e guard

> ledger semantico locale su exact head; C1 non prova runtime composition o integration; non integrato, non release-ready, non released

Il validator falsifica record mancanti, extra o duplicati, digest dei source
set driftati, vocabolari sconosciuti, receipt conflittuale collassata, union di
authority o stage, `applyPolicy` diverso da `none` e completion incompatibili
con elementi `unmapped` o `conflicted`. Non è una review indipendente, una
promotion né un'autorizzazione ad applicare cambiamenti.

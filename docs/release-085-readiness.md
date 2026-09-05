# MediFlow 0.8.5: sorgenti, verifiche e distribuzione

Fotografia del 5 settembre 2026. Questa pagina descrive la candidatura locale,
non una release GitHub già pubblicata. Il riferimento runtime della revisione
è il commit `4f2aa312c`, albero `bcd7b827909a9766e4586d32c4b527cb5d1d95a7`.
Le modifiche editoriali successive non sono nuove prove del runtime.

## Esito della revisione

Integrati i fix su editor e CAS, lifecycle checkup/Fabric, scale Web/native,
provenienza POMA, DTO FHIR, ambiente ATHENA e conteggio pazienti nelle analisi.
La revisione indipendente ha ricevuto il pacchetto completo sanitizzato;
la sua copertura distingue lettura mirata, controlli sintattici e inventario.
Non è attestata una revisione semantica manuale di ogni file.

| Prova locale sul candidato runtime | Esito |
| --- | --- |
| Lint, typecheck, build standalone | PASS |
| Never-regress, claims, guardie/import headless e crosswalk Fabric | PASS |
| ORM, lifecycle e provenienza | 41 test PASS |
| Editor, scale, analytics e contesto preview | 193 test PASS |
| Headless portable | 246 test PASS |
| Durable link store con DB sintetico bootstrappato | 4 test PASS |
| FHIR Web | 8 test PASS |
| Browser editor e scale | 4 test PASS |
| MCP e Mini | PASS |
| Target Swift MediFlowCore effettivo | Build PASS |

I gruppi si sovrappongono: non sommarli come casi unici. I test ORM usano
Drizzle/better-sqlite3 reali e fixture in memoria; Next, sessione e audit hanno
doubles dichiarati. Il browser esegue form e navigazione reali con risposte
API sintetiche: non attesta l'intera integrazione HTTP del lifecycle.

## Cosa resta aperto

| Gate | Stato | Condizione per chiuderlo |
| --- | --- | --- |
| AppleShared, XCTest, SwiftUI | HOLD ambiente | Xcode completo disponibile; suite pertinenti sul candidato. |
| Dispositivi e configurazioni native | Non attestato da questa revisione | Prove locali sui target previsti. |
| ATHENA/MLX reale | Opzionale, non attestato | Runner/modello preprovisionati e prova su hardware compatibile. |
| Distribuzione Apple | Canale da distinguere | Firma e verifiche previste per il canale scelto. |
| POMA-28 | Correzione software, ADR0118 Proposed | Riesame umano di fonte, traduzione e adozione; nessun claim clinimetrico italiano. |
| FHIRv2 | Debito noto | Gate di parità e interoperabilità secondo ADR0081; migrazione non attivata. |

## Account Apple gratuito

Il codice sorgente può essere pubblicato su GitHub senza un'iscrizione a
pagamento Apple. Xcode e sviluppo personale sono disponibili con un Apple
Account gratuito; le prove sui propri dispositivi usano i limiti del Personal
Team. Questi limiti non sono un fallimento del codice.

Developer ID e notarizzazione Mac richiedono l'Apple Developer Program.
Un archivio sorgente non va presentato come un'app notarizzata. Non si aggirano
Gatekeeper o controlli del sistema per trasformare una build locale in una
promessa di distribuzione supportata.

Fonte verificata: [Apple, Choosing a Membership](https://developer.apple.com/support/compare-memberships/).
Per i comandi dei target: [NATIVE.md](./NATIVE.md). La disponibilità del disco
con Xcode è un prerequisito ambientale distinto dall'account.

## Promozione

1. Conservare il commit e il tree che identificano le prove.
2. Eseguire i gate ancora aperti nel loro ambiente; registrare PASS, FAIL o NOT RUN.
3. Riesaminare scope, changelog e claim del canale da pubblicare.
4. Inviare il branch solo con autorizzazione. Push, PR, merge e release sono passaggi distinti.

La preparazione di un aggiornamento dei sorgenti può concludersi prima della
distribuzione binaria Apple. La documentazione deve rendere questa distinzione
visibile, senza trasformare un HOLD in PASS.

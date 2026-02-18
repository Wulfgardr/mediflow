# Documentazione MediFlow — Indice Canonico

Questo file e' il punto di ingresso unico per capire dove leggere e dove aggiornare la documentazione.

Ultimo aggiornamento: 2026-02-18

## Ordine di lettura consigliato

1. `README.md`
2. `AGENTS.md`
3. `ARCHITECTURE.md`
4. `SECURITY.md`
5. `CONTRIBUTING.md`
6. `docs/adr/` (partendo dai piu recenti)
7. `PLANS.md`
8. `docs/walkthrough.md`

## Convenzione stato documenti

- `CANONICAL`: fonte di verita' da aggiornare quando cambia un tema.
- `SECONDARY`: approfondimento o sintesi; se diverge dal canonico, non prevale.
- `LEGACY`: materiale storico/visuale utile per consultazione, non per decisioni.

## Fonte autorevole per tema

| Tema | File canonico | Stato | Note |
| --- | --- | --- | --- |
| Regole agent e vincoli | `AGENTS.md` | `CANONICAL` | Fonte primaria per processi e limiti operativi. |
| Onboarding progetto | `README.md` | `CANONICAL` | Punto di ingresso generale. |
| Visione architetturale stabile | `ARCHITECTURE.md` | `CANONICAL` | Confini e principi che cambiano raramente. |
| Sicurezza e redazione dati | `SECURITY.md` | `CANONICAL` | Policy di sicurezza, threat model, logging rules. |
| Workflow di contribuzione | `CONTRIBUTING.md` | `CANONICAL` | Definition of Done e routine verifica. |
| Decisioni architetturali | `docs/adr/*.md` | `CANONICAL` | Ogni scelta non banale deve vivere qui. |
| Piano engineering a breve termine | `PLANS.md` | `CANONICAL` | 2-6 settimane, operativo. |
| Roadmap prodotto | `docs/ROADMAP.md` | `CANONICAL` | Direzione prodotto/versioni, separata da `PLANS.md`. |
| Roadmap terminologie/FSE | `docs/FSE2-terminology-roadmap.md` | `CANONICAL` | Evoluzione codifiche cliniche e compliance documentale (coerente con ADR 0006). |
| Walkthrough end-to-end | `docs/walkthrough.md` | `CANONICAL` | Mappa operativa web + native + servizi locali. |
| Deep dive tecnico architettura | `docs/ARCHITETTURA.md` | `SECONDARY` | Approfondimento tecnico esteso. |
| Sintesi operativa architettura | `docs/system_architecture.md` | `SECONDARY` | Versione compatta/rapida. |
| Setup client macOS e TLS locale | `docs/NATIVE.md`, `docs/native-setup.md`, `docs/native-launch.md`, `docs/local-api-tls.md` | `CANONICAL` | Materiale operativo nativo. |
| Compliance/GDPR/FHIR | `docs/COMPLIANCE.md` | `CANONICAL` | Quadro compliance e interoperabilita'. |
| Manuale utente medico | `docs/MANUALE.md` | `CANONICAL` | Uso prodotto lato clinico. |

## File sovrapposti o secondari

- `docs/product_roadmap.md`: alias storico della roadmap prodotto, da considerare **deprecato**. La fonte attiva e' `docs/ROADMAP.md`.
- `docs/index.html`: pagina visuale legacy utile per consultazione rapida, ma non fonte di verita' per decisioni architetturali.
- `docs/private/openhospital-alignment/*`: workspace operativo privato locale. Le decisioni persistenti vanno riallineate su `PLANS.md` e/o ADR pubblici.

## Regole rapide di mantenimento

1. Una decisione duratura deve finire in ADR.
2. Un cambio di priorita' a breve finisce in `PLANS.md`.
3. Un cambio di direzione prodotto finisce in `docs/ROADMAP.md`.
4. Se due file dicono cose diverse, prevale la fonte canonica indicata sopra.

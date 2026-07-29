---
summary: "Historical and transitional baseline for the Vetro Clinico design system: naming, scope, reading order, editorial rules."
read_when:
  - "Understanding the historical Vetro Clinico baseline before a visual, interaction, or platform UI change."
  - "Reconciling a transitional Vetro surface with the separately maintained destination design lane."
---

# Vetro Clinico: baseline storica e transitoria

Questo folder conserva la baseline storica e transitoria del design MediFlow. Non è la destinazione attiva per nuove decisioni di design. La candidata locale v0.8 usa Lume e i relativi token DTCG come riferimento attivo. Questo folder resta utile per interpretare superfici non ancora migrate.

## Glossario dei nomi (da qui in avanti)

| Nome | Cosa indica | Stato |
| --- | --- | --- |
| **Vetro Clinico** | La baseline storica e transitoria del linguaggio di design MediFlow, comune a tutte le piattaforme. | Storico / transitorio |
| **Liquid Glass** | Materiale di sistema Apple, usato solo dove disponibile e adatto al chrome. Non rende Vetro Clinico la direzione attiva. | Riferimento esterno |
| **Kree8** | Codename storico della grammatica visiva del cockpit web (WUL-271, attribuzione esterna). È la prima implementazione web di Vetro Clinico, non un sistema concorrente. | Storico |
| **Graphite** | Shell web precedente (ADR 0047), superata alla root da ADR 0060. | Storico |

Nei documenti nuovi si usa "Lume" per la direzione attiva e "Vetro Clinico" per il contesto storico o transitorio. "Kree8" resta valido solo nei riferimenti storici e nei nomi file esistenti.

## Ordine di lettura

1. [01-fondamenta.md](./01-fondamenta.md): principi, stato attuale onesto, decisioni vincolanti.
2. [02-token.md](./02-token.md): architettura dei token, palette, tipografia, geometria, motion.
3. [03-materiali.md](./03-materiali.md): il sistema dei materiali (vetro strutturale, carta clinica, vetro transitorio).
4. [04-interazione.md](./04-interazione.md): feedback, motion, tastiera, form, stati.
5. [05-responsivita.md](./05-responsivita.md): breakpoint, densità, touch e pointer.
6. [06-accessibilita.md](./06-accessibilita.md): contratto WCAG 2.2 AA e gap per piattaforma.
7. [07-piattaforme/](./07-piattaforme/): web, Apple, Windows, Linux, ciascuna contro le proprie linee guida ufficiali.
8. [08-esplorazioni.md](./08-esplorazioni.md): quattro proposte di evoluzione, con verdetti.
9. [09-roadmap.md](./09-roadmap.md): piano di implementazione, convergente con la roadmap UI/UX del 2026-07-02.
10. [mockups/esplorazioni.html](./mockups/esplorazioni.html): dimostratore statico delle esplorazioni (aprire nel browser, nessuna dipendenza).

## Regole redazionali di questo folder

- Trattino lungo bandito, in questi documenti e in ogni stringa UI che ne deriva.
- Niente meta-testo e niente copy celebrativo negli esempi di interfaccia: gli stati vuoti dicono cosa manca e come procedere.
- Tono sobrio: le affermazioni si limitano a ciò che il codice fa davvero.
- I claim su cifratura, SISS/FSE e funzioni cliniche seguono `docs/adr/0065-intended-purpose-and-claims-guard.md`: questi documenti non li modificano.

## Precedenza

In caso di conflitto: le linee guida ufficiali di piattaforma vincono sul gusto locale per comportamento e API; le decisioni di prodotto registrate negli ADR vincono su questo folder; questa baseline storica non sostituisce la lane di design di destinazione. Le deviazioni intenzionali dalle linee guida di piattaforma vanno dichiarate nel documento di piattaforma pertinente.

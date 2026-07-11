<!-- @Codex WUL-481 -->
# ADR 0077: Vetro Clinico come linguaggio di design canonico multipiattaforma

Date: 2026-07-11
Status: Proposed

Related: [ARCHITECTURE.md](../../ARCHITECTURE.md),
[ADR 0047](./0047-graphite-workbench-single-official-web-shell.md),
[ADR 0060](./0060-kree8-cockpit-live-root-entry.md),
[ADR 0065](./0065-intended-purpose-and-claims-guard.md),
[ADR 0071](./0071-tri-os-reversed-flow-shared-core.md),
[Vetro Clinico](../design/vetro-clinico/README.md)

## Problema

MediFlow possiede già una grammatica visiva riconoscibile sul web e un kit
SwiftUI chiamato `VetroClinico`, ma token, materiali e regole di interazione
sono distribuiti tra CSS, componenti Apple, documenti Kree8 e decisioni
storiche. Senza un canone unico, ogni piattaforma rischia di inventare un tema
separato o di imitare materiali non idiomatici.

## Opzioni

1. Conservare linee visive indipendenti per web, Apple, Windows e Linux.
2. Copiare Liquid Glass su ogni piattaforma.
3. Condividere grammatica e token semantici, lasciando a ogni piattaforma la
   resa materiale e l'interazione idiomatica.

## Trade-off

- L'opzione 1 riduce il coordinamento iniziale, ma crea drift di significato e
  moltiplica componenti, copy e verifiche.
- L'opzione 2 produce uniformità superficiale, ma contraddice le linee guida
  delle piattaforme e rende Windows/Linux imitazioni di Apple.
- L'opzione 3 richiede disciplina sui token e documentazione per piattaforma,
  ma conserva una sola identità clinica senza appiattire input, navigazione e
  materiali.

## Decisione

Adottare l'opzione 3.

`Vetro Clinico` è il nome canonico della grammatica di design MediFlow.

- I dati clinici si leggono e si scrivono su superfici opache e stabili.
- Il colore comunica significato, sempre insieme a testo o glifo.
- Token semantici, tono, gerarchia e stati sono condivisi.
- Liquid Glass resta una resa Apple sulle versioni che lo supportano; il web
  usa materiali propri, Windows usa pattern Fluent e Linux resta coerente con
  i pattern del desktop scelto.
- Navigazione, densità, input e comandi si adattano alla piattaforma; parità di
  funzione non significa identità di interazione.
- Accessibilità, Reduce Motion, Reduce Transparency e contrasto fanno parte
  del contratto, non sono rifiniture finali.
- `Kree8` e `Graphite` restano nomi storici, non sistemi concorrenti.

Il folder [docs/design/vetro-clinico](../design/vetro-clinico/README.md) è la
specifica operativa subordinata agli ADR e alle linee guida ufficiali di
piattaforma. Non autorizza da solo modifiche runtime o refactor estesi.

## Conseguenze

- Ogni nuova UI dichiara quali regole Vetro Clinico applica.
- Le migrazioni di componenti restano issue e PR piccole con verifica visiva e
  di accessibilità.
- La shell Apple può condividere modelli e componenti semantici, ma macOS,
  iPadOS e iOS mantengono strutture e input appropriati.
- Le guide Windows/Linux sono direzionali finché non esistono shell native
  eseguibili; non costituiscono un claim di parity applicativa.

## First Thin Slice

1. Versionare il dossier Vetro Clinico e correggerne i fatti contro il codice.
2. Allineare indici, stato sistema, roadmap e documentazione nativa.
3. Aprire issue separate per consolidamento token web, accessibilità Apple e
   refactor del workspace nativo; nessuno di questi refactor entra in WUL-481.

## Verifica

- `npm run check:claims`
- `npm run check:never-regress`
- verifica che ogni Markdown aggiunto sia presente in `docs/markdown-index.md`
- `git diff --check`
- build e test Apple pertinenti quando una slice modifica il runtime nativo

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/design/lume/icona/mediflow-icon-grafite.svg">
  <source media="(prefers-color-scheme: light)" srcset="./docs/design/lume/icona/mediflow-icon-giorno.svg">
  <img src="./docs/design/lume/icona/mediflow-icon-giorno.svg" alt="Icona MediFlow: il Filo del diario con il nodo del presente" width="120" height="120">
</picture>

# MediFlow

<a href="https://claude.com/claude-code"><img src="https://img.shields.io/badge/costruito%20con-Claude%20Code-D97757?style=flat&amp;logo=claudecode&amp;logoColor=white" alt="Costruito con Claude Code"></a>
<a href="https://openai.com/codex"><img src="https://img.shields.io/badge/costruito%20con-Codex-1f2937?style=flat" alt="Costruito con Codex"></a>

_by Ordito & Concilio_

**Cartella clinica territoriale local-first.**

Per ritrovare informazioni, seguire terapie e tenere il filo del lavoro clinico,
senza consegnare i dati a un cloud per poter lavorare.

[![Versione](https://img.shields.io/badge/versione-0.8.0%20candidata-1f6feb)](./CHANGELOG.md)
[![Licenza](https://img.shields.io/badge/licenza-MIT-2ea043)](./LICENSE)
[![Local-first](https://img.shields.io/badge/dati-local--first-8957e5)](#confini-dichiarati)
[![Core Swift](https://img.shields.io/badge/core%20Swift-macOS%20%7C%20Linux%20%7C%20Windows-6e7681)](#candidata-locale-080)

[In breve](#mediflow-in-breve) · [Schermate](#come-si-presenta) · [Architettura](#come-è-fatto) · [Stato](#candidata-locale-080) · [Avvio](#avvio-rapido) · [Sviluppo](#sviluppo-assistito)

</div>

## MediFlow, in breve

MediFlow nasce dal lavoro reale con i pazienti. Serve a raccogliere dati
clinici, terapie, note e documenti in una scheda che resti leggibile anche
quando il percorso si allunga e le fonti si moltiplicano.

Il principio è semplice: il dato resta vicino a chi lo produce e lo usa. Il Mac
ospita la base autorevole; il cloud non è un requisito per lavorare. Le funzioni
deterministiche restano locali. Il percorso AI locale usa Ollama quando è
configurato. Se la funzione è abilitata, l'AI può aggiornare una sintesi locale.
Non aggiunge diagnosi, terapie o altri dati clinici strutturati senza una
conferma esplicita.

Il contratto proposto dello scaffold separa sei passaggi: pipeline locale,
proposta strutturata, chiarimento, anteprima, autorizzazione contestuale ed
eventuale scrittura auditata. I primi passaggi non richiedono un servizio
esterno. L'ultimo resta una funzione applicativa specifica, non un accesso
diretto del modello al database.

Nel contesto territoriale italiano questo significa soprattutto togliere
attrito: aprire la scheda, capire dove si è, ritrovare una fonte, distinguere una
terapia da una prestazione prescritta e preparare il passaggio successivo senza
confondere supporto operativo e integrazione istituzionale.

MediFlow non sostituisce SISS, FSE o gli altri canali ufficiali. Sta accanto al
lavoro clinico quotidiano, con confini dichiarati e verificabili.

Lo sviluppo avviene nella repository pubblica
[`Wulfgardr/mediflow`](https://github.com/Wulfgardr/mediflow). Database, dati
sanitari, credenziali e altri artefatti locali restano fuori da Git secondo
[`SECURITY.md`](./SECURITY.md) e
[`docs/repository-topology.md`](./docs/repository-topology.md).

## Come si presenta

### App macOS

<img src="./screenshots/macos-workspace.png" alt="Panoramica nativa di MediFlow per macOS con navigazione Lume e guardrail local-first" width="820" loading="lazy" decoding="async"/>

### Web locale

<img src="./screenshots/01-worklist.png" alt="Cockpit Lume di MediFlow: lista di lavoro con pazienti dimostrativi sintetici" width="820" loading="lazy" decoding="async"/>

_Catture reali dell'app macOS e della build web di produzione che adottano
Lume, la lingua visiva di MediFlow. Le viste cliniche usano esclusivamente
fixture dimostrative sintetiche. Nessun dato paziente reale._

<details>
<summary><b>Altre schermate web</b>: scheda paziente, quadro clinico, revisione documentale e sicurezza</summary>
<p><img src="./screenshots/02-scheda.png" alt="Scheda paziente con moduli clinici" width="820" loading="lazy" decoding="async"/></p>
<p><img src="./screenshots/03-quadro.png" alt="Quadro paziente nel cockpit" width="820" loading="lazy" decoding="async"/></p>
<p><img src="./screenshots/04-review.png" alt="Revisione documenti e codifiche con evidenze sintetiche da confermare" width="820" loading="lazy" decoding="async"/></p>
<p><img src="./screenshots/05-security.png" alt="Schermata di blocco locale con richiesta del PIN operatore" width="820" loading="lazy" decoding="async"/></p>
</details>

## Come è fatto

Il Mac è il nodo autorevole (`home-base`): ospita database e web app. Gli altri
dispositivi non parlano direttamente con SQLite, ma con l'API locale, dopo un
pairing esplicito.

```mermaid
flowchart LR
    subgraph mac["Mac (home-base)"]
        web["Web app locale<br/>(Next.js)"]
        api["API locale<br/>/api/v1"]
        db[("SQLite locale<br/>campi clinici cifrati")]
        ai["Ollama<br/>AI e OCR locali, opzionali"]
        web --> api --> db
        web -.-> ai
        native["App nativa macOS<br/>sull'host"]
        native -- "TLS locale" --> api
    end
    subgraph paired["Dispositivi paired"]
        mobile["iPhone / iPad / Mac<br/>(read-first, cache cifrata)"]
    end
    mobile -- "pairing esplicito, TLS locale" --> api
```

Il diagramma mostra il percorso locale. Trasporto, pairing e limiti del data
plane sono documentati in
[`docs/topologia-dati-flussi.md`](./docs/topologia-dati-flussi.md).

## Candidata locale 0.8.0

Questa checkout prepara localmente la versione `0.8.0`. Non dichiara una
pubblicazione, un tag o una release completata. Lo stato resta `HOLD_PROMOTION`
finché i gate assistivi e i verificatori finali non producono un verdetto
terminale sullo stesso candidato.

La candidata consolida contratti AI review-first, hardening del pacchetto
autonomo e miglioramenti alle superfici web e Apple. Le prove disponibili usano
solo fixture sintetiche. Chrome sulla build di produzione è stato verificato al
200% e al 400%; il bundle macOS già costruito è stato verificato con VoiceOver,
tastiera e resize. Queste prove non dimostrano parity UI completa: restano da
chiudere VoiceOver reale su iPhone e iPad, lo screen reader web e la nuova build
Xcode sul tree corrente.

### Aggiornamenti integrati

La tranche integrata rafforza i contratti dei contenitori JSON (`envelope`) AI.
Un output AI deve rispettare il contratto dell'attività richiesta prima di
diventare materiale di revisione. Un contenitore ambiguo, incompleto, multiplo o
con chiavi riservate duplicate non può attivare il recupero legacy né essere
usato.

Le diagnosi estratte da documento restano materiale di revisione: la sintesi
non le aggiunge automaticamente alla scheda. Codex Operator personale non è
incluso: i relativi limiti di sicurezza richiedono decisioni e correzioni
separate.

Il dettaglio è nel [CHANGELOG](./CHANGELOG.md). La fotografia completa vive in
[`docs/STATE_OF_THE_SYSTEM.md`](./docs/STATE_OF_THE_SYSTEM.md); la matrice
parity canonica vive in [`docs/parity-matrix.md`](./docs/parity-matrix.md).

### Modelli e servizi opzionali

Le funzioni deterministiche restano disponibili senza un modello. Il percorso
AI locale usa Ollama ed è disponibile quando Ollama è configurato.
L'architettura separa il servizio applicativo dal connettore del modello. Oggi
è operativo soltanto il connettore Ollama.

Una futura modifica può aggiungere plug-in opzionali per modelli locali, LAN o
cloud. Le regole dell'organizzazione e la scelta esplicita dell'utente devono
consentire ogni attivazione.

Un fornitore esterno può offrire più capacità o ridurre alcuni tempi di
elaborazione. Non è un requisito e non implica una promessa clinica.

Prima di ogni invio servono minimizzazione, controlli verificati, registrazione
locale e abilitazione esplicita. La redazione o pseudonimizzazione deve essere
dimostrata per il flusso specifico. MediFlow non dichiara anonimizzazione
garantita.

Il controllo dell'invio esterno resta oggi chiuso. Nessun plug-in esterno accede
direttamente al database. Il flusso separa proposta, chiarimento e scrittura
autorizzata; la scrittura diretta tramite modello non è consegnata.

L'[ADR 0086](./docs/adr/0086-intelligent-scaffold-and-graded-automation-boundary.md)
propone il contratto comune per Document Ops, riconciliazione anagrafica, sunto
clinico, Atena e provider. Distingue le funzioni presenti dalla roadmap. La
futura inbox conversazionale e l'automazione graduata non sono funzioni live
della 0.8.

## Confini dichiarati

MediFlow non racconta più di quanto possa dimostrare.

- **Il default è locale.** Nessun cloud obbligatorio, nessuna telemetria o
  uscita dati attiva per impostazione iniziale.
- **I fornitori esterni non sono operativi.** L'estensione a plug-in richiede
  attivazione esplicita, registrazione locale e controlli sull'invio esterno.
- **iPhone e iPad non sono app complete.** Il perimetro operativo è
  `home-base + client paired`; cache offline e alcune superfici derivate dai
  documenti restano parziali o disponibili solo sull'host.
- **Windows e Linux non hanno ancora parity applicativa.** La candidata verifica il
  core Swift condiviso e il runtime di base, non applicazioni complete su ogni
  piattaforma.
- **SISS e FSE restano un handoff assistito.** MediFlow apre il contesto giusto,
  ma non dichiara sincronizzazione FSE, writeback regionale o invio
  prescrittivo diretto.
- **L'AI resta review-first.** Può aiutare a leggere e organizzare, non
  sostituisce revisione, giudizio clinico o responsabilità professionale.
- **La inbox intelligente non è consegnata.** Le route conversazionali di base
  non costituiscono un flusso di chiarimento o conversione in record clinici.

Delle 43 capability per cui la parity è un obiettivo, 30 sono complete e 13
parziali; altre 21 restano intenzionalmente host-only. La matrice fa fede sui
conteggi e sul significato di ciascuno stato.

## Avvio rapido

```bash
git clone https://github.com/Wulfgardr/mediflow
cd mediflow
nvm use
npm ci
```

MediFlow richiede Node.js 24.x. Installazione, build e launcher verificano anche
che il binding nativo `better-sqlite3` appartenga alla stessa ABI di Node.

Poi usa il launcher della tua piattaforma:

| OS | Comando |
| :-- | :-- |
| macOS | `./Start_MediFlow.command` |
| Windows | `powershell -ExecutionPolicy Bypass -File .\Start-MediFlow.ps1` |
| Linux | `./scripts/start-mediflow.sh` |

Apri `http://localhost:3000`. Ollama, Docker e ICD-11 sono opzionali; senza,
MediFlow resta usabile con funzionalità ridotte.

## Documentazione

| Documento | Cosa contiene |
| :-- | :-- |
| [FAQ](./docs/FAQ.md) | Risposte rapide alle domande più comuni |
| [Stato del sistema](./docs/STATE_OF_THE_SYSTEM.md) | La fotografia completa e aggiornata |
| [Roadmap](./docs/ROADMAP.md) | Dove sta andando il progetto |
| [Compliance](./docs/COMPLIANCE.md) | Privacy, GDPR e confini regolatori |
| [Crediti](./CREDITS.md) | Fonti, modelli, librerie e ispirazioni con licenze |
| [Mappa documentale](./docs/README.md) | La guida alla documentazione canonica |

## Fonti e attribuzioni

La prima lingua visiva del cockpit è derivata da
[Kree8](https://www.kree8.studio/), tradotta in un'implementazione clinica
originale. Il ragionamento terapeutico review-only usa
[ATHENA](https://github.com/mims-harvard/ATHENA) di mims-harvard, con licenza
MIT. Il lavoro sulla visita registrabile prende a riferimento l'ecosistema
Fluid.

Modelli, runtime, librerie e ispirazioni, con URL, ruolo e licenza, sono in
**[CREDITS.md](./CREDITS.md)**.

L'icona MediFlow porta in primo piano il **Filo del diario**, la stessa geometria
che connette le voci cliniche lungo il tempo. Concetto, registri giorno/grafite
e asset sono documentati nella [specifica dell'icona](./docs/design/lume/09-icona.md).

## Sviluppo assistito

Scrivo MediFlow da medico, con un aiuto sostanziale e dichiarato di strumenti di
sviluppo assistito da AI.

[Codex](https://openai.com/codex) e
[Claude Code](https://claude.com/claude-code) hanno contribuito a progettazione,
implementazione, review e verifica. Le proposte dei modelli restano materiale da
controllare: test reali e guard automatici decidono se una modifica regge.

<!-- usage-dashboard:start -->

| Snapshot | Token di sessione | Ripartizione | Cache letta |
| :-- | --: | :-- | --: |
| **17 luglio 2026** | **22.185.794.772** | Codex 15.546.136.608 · Claude Code 6.639.658.164 | 20.917.134.403 (94,3%) |

<img src="./screenshots/token-models.svg" alt="Snapshot 17 luglio 2026: 22,19 mld token di sessione, 15,55 mld in Codex e 6,64 mld in Claude Code; 20,92 mld da cache letta." width="720" loading="lazy"/>

**Effort Codex:** xhigh 7.350.462.593 · non registrato / Ultra 4.395.761.468 · high 2.000.320.556 · medium 1.774.948.743 · low 24.643.248 · non registrato 0. Le sessioni senza effort registrato restano separate; possono includere fan-out `Ultra`, che non è un livello di ragionamento. Nei transcript Claude Code l'effort non è esposto in modo uniforme.

Il conteggio usa i contatori di tutti i log locali dei due ambienti e non è filtrato per repository. Per Codex somma i delta dei totali cumulativi e conserva modello, effort e cache letta; per Claude Code deduplica le richieste e somma input diretto, cache creata, cache letta e output. Sono pubblicati soltanto aggregati: nessun prompt, contenuto di sessione o percorso locale entra nel README o nell'SVG.

Ogni colore corrisponde a un modello o a una famiglia vicina. Le due barre usano la stessa scala: mostrano il peso dei due ambienti e la composizione interna. Il dato misura contesto elaborato, non righe di codice, costo o qualità. [CodexBar](https://github.com/steipete/CodexBar) resta il pannello locale complementare per limiti e uso corrente.

La responsabilità del progetto resta mia.

<!-- usage-dashboard:end -->

Lo snapshot pubblicato in precedenza (17,56 miliardi al 15 luglio 2026) usava una
pipeline di conteggio diversa e non è direttamente confrontabile con questo.

## Licenza

MIT License.

---

Progettato in Italia.

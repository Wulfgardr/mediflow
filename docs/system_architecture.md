---
summary: "Compact operational architecture overview for MediFlow 0.8.5, its home-base, AI/document lanes, SISS/FSE boundaries, and local guardrails."
read_when:
  - "Needing a fast technical architecture overview without reading the full walkthrough."
  - "Checking current 0.8.5 boundaries before implementation or review."
---

# Architettura di MediFlow (sintesi operativa)

> [!NOTE]
> **Stato documento: SECONDARY (sintesi rapida).**
> Per la visione stabile prevale [ARCHITECTURE.md](../ARCHITECTURE.md).
> Per il percorso operativo prevale [docs/walkthrough.md](./walkthrough.md).

Questa sintesi collega postazione, dati e servizi, distinguendo il contenuto
sorgente `0.8.5` dalle correzioni di stato successive. La release sorgente 0.8.6
è pubblicata per il runtime locale/headless sul Mac, con browser localhost;
non distribuisce un installer nativo firmato o notarizzato e non qualifica
app complete su altri sistemi.

Le ricevute exact-SHA, di firma, tag e pubblicazione mantengono il proprio
valore e non si sostituiscono con una panoramica. Per il quadro trasversale
consulta [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md), per il flusso
completo [docs/walkthrough.md](./walkthrough.md), per orientarti
[docs/README.md](./README.md) e [docs/markdown-index.md](./markdown-index.md).

---

## 🧭 Snapshot corrente

Il lavoro ordinario comincia sul nodo `home-base`, che conserva lo storage
autorevole. Client paired, cache ed esportazioni o backup espliciti completano
il perimetro: nessun servizio cloud è necessario per default. La cifratura
riguarda i campi clinici configurati e gli artifact documentali sensibili,
non l’intero file SQLite.

Attivare `network-home-base` permette di usare `/api/v1/network/*` dopo pairing
e autenticazione dell’operatore. Sono previste letture dei pazienti e scritture
versionate di profilo/status, diario, terapie, checkup e osservazioni; hard
delete remoto, replica, cataloghi remoti e sincronizzazione restano separati
e governati dai rispettivi contratti.

La root `/` apre il cockpit Kree8 su `main` (ADR 0060). Non esiste un selettore
di shell: AI, Smart Import e contesto paziente SISS/FSE appartengono alla UI
ufficiale, non a preview profiles. La web app è la superficie primaria;
la shell macOS storica conserva il proprio valore di snapshot e il seguito
nativo usa lo stesso contratto `home-base + /api/v1` previsto per iPadOS/iOS.

I documenti mantengono più del solo testo estratto. `documentInsights` è lo
strato di compatibilità; gli allegati possono conservare artifact
`parse/evidence` cifrati, letti in priorità da `AI Patient Insight`. Le
prescrizioni di prestazione — esami, visite, imaging, riabilitazione e
screening — hanno un dominio distinto dalle terapie farmacologiche, con item
figli e confronto con il repertorio sempre da rivedere. Il corpus locale
SISS/FSE, con sincronizzazione documentale e controlli di aggiornamento,
prepara il lavoro futuro senza attestare una catena regionale certificata.

---

## 🧱 Componenti chiave

La tabella indica responsabilità e limiti. «Integrato» descrive un raccordo
nel codice, non una qualifica clinica o la distribuzione di ogni superficie.

| Componente | Stato e perimetro documentati | Note |
| --- | --- | --- |
| Web app Next.js | Superficie primaria | Root Kree8 live, UI clinica locale, `/api/*`, `/api/v1/*`, overview `home-base`, coordinamento AI locale |
| SQLite + Drizzle | Storage autorevole | `medical.db`, schema in `lib/schema.ts` |
| Ollama | Runtime generativo locale configurabile | Serve Patient Insight, Smart Import e Document Synthesis quando host e modello locali superano la readiness; non è un runtime OCR della 0.8.5 |
| ATHENA/MLX | Runtime locale configurabile | Serve Treatment Reasoning solo con modello e runner `mlx_lm.generate` pre-provisionati; assenza o configurazione incompleta falliscono in modo chiuso |
| AnyDoc + Apple Vision | Estrazione documentale locale | AnyDoc resta il primo passaggio; Apple Vision continua soltanto le pagine PDF `needsOcr` sul Mac, con provenienza, currentness e fail-closed |
| Selector Fabric | Integrato | Discovery compatibile, smoke sintetico e binding atomico per cinque capability; nessuna qualifica runtime implicita |
| OpenAI / Anthropic | Adapter ufficiali `default OFF` | Probe review-only con transport fake; nessuna credenziale o rete live nel tree |
| MCP | Superficie figlia locale integrata | Supervisor locale, Web e MCP figli distinti, RPC AIP ereditato; nessun installer, onboarding o claim per host MCP esterni |
| Mini | Base CLI 0.8.5; raccordo Supervisor successivo WUL-696 | Il raccordo aggiunge sessione NDJSON e comandi CLI; parent AIP e attivazione Web restano obbligatori, con prova sintetica distinta dal completamento clinico end-to-end |
| Write checkup F10 | Integrato end-to-end | Preview MCP e commit Web trusted con ruolo, step-up, gesto, CAS, idempotenza, audit e receipt; proof e commit non passano all'agente |
| Semantic planner | Integrato, sola lettura | Collegato al Supervisor; massimo due operazioni allowlisted, nessun SQL libero o write |
| Recording visita | Percorso Mac con revisione, non qualifica nativa 0.8.6 | API Apple on-device su macOS 26+; consenso esplicito, audio bounded in RAM e nessun writer clinico automatico |
| ICD-11 WHO | Application Service server-only opzionale | Output MediFlow data-only, egress e credenziali espliciti |
| OpenMed redaction | Sidecar shadow opzionale | Lane `redaction.v1` benchmark/shadow, non client-facing |
| TLS proxy `:3443` | Trasporto locale fidato | Base di `/api/v1` per native e `home-base` |


---

## 🔒 Dati e cifratura

La cifratura avviene nel client prima della persistenza. Il mapping comprende
campi paziente (`address`, `phone`, `notes`, `aiSummary`, `documentInsights`),
contenuti del diario clinico, note dei controlli, motivazioni terapeutiche,
allegati e snapshot documentali (`summarySnapshot`,
`parseEvidenceArtifactSnapshot`). Il formato a riposo è:

```text
ENC:<iv_b64>:<cipher_b64>
```


Il server non possiede la chiave in chiaro; la master key resta nella sessione
attiva del browser o del client. Identificativi e alcuni metadati rimangono
fuori dal mapping, perciò il PIN non equivale a zero-knowledge dell’intero
database.

Il soft-delete paziente di ADR 0066 scrive un tombstone reversibile
(`deletedAt` / `deletionReason`) con controllo di versione, senza rendere orfani
i figli clinici. `[LOCKED DATA]` è soltanto un segnaposto della UI: non deve
mai sostituire il contenuto cifrato persistito.

---

## 🔌 API e boundary

| Surface | Auth | Scopo |
| --- | --- | --- |
| `/api/auth/*` | credenziali + session cookie | Setup, login e logout. |
| `/api/*` | session cookie | CRUD web, proxy locali e stato della shell. |
| `/api/v1/*` | bearer token locale | Contratto condiviso dai client nativi. |
| `/api/v1/network/*` | paired client credential + sessione operatore | `home-base` con lettura prioritaria e scritture limitate/versionate di paziente, diario, terapie, checkup e osservazioni. |

Il ciclo di vita WUL-308 di diario, terapie, checkup e osservazioni usa controlli
di versione e restituisce `409` sulle scritture in conflitto. Tutte le
`DELETE` sono soft delete; le liste escludono i record rimossi salvo
`includeDeleted` esplicito; l’audit distingue eliminazione e aggiornamento.
Gli allegati hanno un limite predefinito di 25 MiB (`413` oltre soglia) e
involucri cifrati lato client.

Il default resta `local-only`. `network-home-base` si attiva esplicitamente
nelle impostazioni su LAN fidata; da spenta nega lettura e scrittura ai token
paired con `403 NETWORK_MODE_DISABLED`, senza eliminare i pairing. Il bootstrap
di associazione non espone PHI. Scritture remote, limitate e versionate, sono
ammesse soltanto sui moduli documentati: sincronizzazione record-level,
multi-master e cancellazione fisica remota restano escluse.

> [!IMPORTANT]
> L’introduzione WUL-308 era BREAKING per il client nativo macOS e costituiva
> un blocco della relativa release (WUL-333). Questa condizione storica non
> attesta l’adeguamento di un client successivo e non va presentata come un
> blocco ancora aperto alla pubblicazione sorgente 0.8.6, già avvenuta.

---

## 🤖 AI e document intelligence

Prima di chiedere una sintesi occorre sapere che cosa si sia letto. Il
percorso documentale carica e valida il file localmente, usa AnyDoc sui formati
con testo estraibile e registra provenienza, hash e validità della fonte.
Per i PDF supportati classifica soltanto le pagine `needsOcr`, ne limita
materializzazione e rendering, applica Apple Vision sul Mac e ricompone il
risultato mantenendolo legato all’originale. DeepSeek-OCR 2/CUDA resta escluso
e non bloccante nel perimetro 0.8.5.

Il runtime generativo locale, quando configurato, prepara estrazioni o sintesi
da rivedere. La persistenza documentale conserva `summarySnapshot`, artifact
`parse/evidence` cifrati e tracciabili e `documentInsights` come proiezione di
compatibilità; si aggiornano quindi i consumer da riesaminare:
`AI Patient Insight`, Smart Import e creazione da documento. Questo percorso non rende
automatiche le scritture cliniche delle proposte AI.

`Smart Import` filtra fonti senza novità cliniche quando diagnosi e terapie
sono già presenti. La prudenza sull’identità esclude date di nascita tratte
da date arbitrarie e considera le omocodie del codice fiscale. Gli errori AI
restano visibili e non attivano alternative implicite.

La Fabric permette di usare questi strumenti per funzione, oppure di lasciarli
spenti. Il modello non si sceglie liberamente per nome: ADR0129 conserva
catalogo e autorità dell’host, con preferenze e override circoscritti. Gli
adapter HTTPS ufficiali OpenAI/Anthropic e la loro prova amministrativa
richiedono ciclo di vita, riferimento al segreto e politiche di uscita e
conservazione; restano `default OFF`. I test di quel percorso usano trasporti
simulati. L’integrazione ChatGPT è un canale distinto e non porta una nuova
prova live consumer sul candidato finale. Comparator e OpenMed `redaction.v1`
rimangono nei propri benchmark, senza promozioni implicite.

Il Supervisor Node locale avvia Web standalone e MCP `stdio` come figli su
IPC ereditato. MCP può cercare terminologia, leggere Open Loops nel paziente
autorizzato, proporre follow-up e interrogare il planner in sola lettura, ma
non accede a SQLite. Mini condivideva già catalogo e base CLI nella 0.8.5;
il successivo raccordo WUL-696 aggiunge la sessione Supervisor, mantenendo
parent AIP e attivazione Web obbligatori. Contesto, ciclo di vita, revoca e
audit restano all’host. Non ne derivano installer o compatibilità con host
MCP esterni.

Per F10, MCP prepara la preview e la UI Web fidata rilegge la risorsa, richiede
ruolo medico attivo, step-up e gesto specifico prima del commit. CAS,
idempotenza, audit e ricevuta sono atomici; prova autorizzativa e commit non
attraversano MCP. Il planner compone al massimo due operazioni ammesse,
senza SQL libero o scritture.

Su macOS 26 o successivo, la registrazione visita usa API Apple sul dispositivo,
consenso esplicito, audio limitato alla RAM e revisione del testo. Non esegue
scritture cliniche automatiche; microfono reale e validazione clinica restano
fuori dalle prove dichiarate.

> [!NOTE]
> Il safety gate WUL-358 mantiene il kill-switch per `patient-insight`,
> `smart-import` e `document-synthesis` e la governance dei modelli nelle
> decisioni documentali. Le proposte devono essere riviste: nessuna scrittura
> clinica autonoma.

---

## ⚠️ Guardrail operativi

`AppRevisionGuard` e `/api/system/revision` impediscono che una tab usi in modo
silenzioso una revisione superata dopo un cambio di branch o worktree.
`Start_MediFlow.command` può ricostruire `.next` quando cambia l’impronta dei
sorgenti locali. Il cockpit Kree8 resta la root su `main`; nuove sperimentazioni
non diventano selettori persistiti nelle impostazioni.

Il selettore Fabric riguarda i binding delle funzioni, non la shell. Discovery
e smoke sintetico non dimostrano disponibilità qualificata. `OpenMed`, comparator
cloud e benchmark NER rimangono separati dal runtime clinico. SISS/FSE resta
`portal-handoff` / webapp-assisted: nessuna integrazione regionale nativa
certificata, generazione NRE o writeback FSE/SISS.

---

## 📚 Riferimenti rapidi

- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [SECURITY.md](../SECURITY.md)
- [docs/walkthrough.md](./walkthrough.md)
- [docs/topologia-dati-flussi.md](./topologia-dati-flussi.md)
- [docs/adr/0034-local-only-default-and-network-home-base-opt-in.md](./adr/0034-local-only-default-and-network-home-base-opt-in.md)
- [docs/adr/0038-network-readonly-data-plane-auth-boundary.md](./adr/0038-network-readonly-data-plane-auth-boundary.md)
- [docs/adr/0042-document-driven-new-patient-review-and-prudent-therapy-persistence.md](./adr/0042-document-driven-new-patient-review-and-prudent-therapy-persistence.md)
- [docs/adr/0059-macos-apple-vision-ocr-fallback.md](./adr/0059-macos-apple-vision-ocr-fallback.md)
- [docs/adr/0047-graphite-workbench-single-official-web-shell.md](./adr/0047-graphite-workbench-single-official-web-shell.md)
- [docs/adr/0060-kree8-cockpit-live-root-entry.md](./adr/0060-kree8-cockpit-live-root-entry.md)
- [docs/adr/0050-functional-preview-profiles-retired-on-mainline.md](./adr/0050-functional-preview-profiles-retired-on-mainline.md)
- [docs/adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md](./adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md)


---

*Fotografia tecnica originaria: 2026-09-03 - contenuto sorgente v0.8.5.
Raccordo editoriale al quadro 0.8.6 del 2026-09-20, senza nuove attestazioni
runtime o native.*

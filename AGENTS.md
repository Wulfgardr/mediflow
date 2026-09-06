# AGENTS.md: MediFlow

## Missione

MediFlow e una cartella clinica territoriale local-first. Gli agent devono
preservare privacy, sicurezza, semplicita e verificabilita, con diff piccoli e
revisionabili.

## Orientamento proporzionato

Leggere `AGENTS.md`, verificare branch e stato del worktree, poi consultare
le parti di `README.md` e `docs/STATE_OF_THE_SYSTEM.md` pertinenti al compito.
Verificare data e checkout delle fotografie documentali: non attestano da sole
lo stato della release corrente.

- Per trovare la fonte canonica: `docs/README.md` e `docs/markdown-index.md`.
- Per repository, branch e consegna: `docs/repository-topology.md`.
- Prima di modificare codice: `CONTRIBUTING.md` e i contratti del componente.
- Per dati, sicurezza o architettura: `SECURITY.md`, `ARCHITECTURE.md` e gli
  ADR del confine interessato, non tutti gli ADR recenti.
- Per una vista end-to-end: `docs/walkthrough.md`.

Non caricare documenti estranei al compito e non dedurre intenti architetturali
dal solo codice quando esiste una fonte canonica pertinente.

## Repository canonica

- `https://github.com/Wulfgardr/mediflow` e l'unica repository operativa e
  canonica del progetto.
- La precedente repository privata `Wulfgardr/mediflow_private` e archiviata e
  non e una fonte di sviluppo, pianificazione o rilascio.
- Non esiste piu un flusso private-to-OSS, una doppia mainline o un passaggio di
  export prima della pubblicazione.
- Branch, commit, pull request, issue, tag e release appartengono alla
  repository pubblica.
- Database, PHI/PII, credenziali, output runtime, corpus autenticati e altri
  artefatti riservati restano fuori da Git; non vanno spostati nella vecchia
  repository privata.

La fonte canonica per questa decisione e
[`docs/repository-topology.md`](./docs/repository-topology.md).

## Sicurezza e privacy

- Non committare PHI/PII, database reali, screenshot o log con dati clinici.
- Usare solo fixture sintetiche.
- Nessun cloud, telemetria o egress dati e attivo per default.
- Prima di cambiare confini di sicurezza, contratti dei dati/API o decisioni
  architetturali durevoli, scrivere o aggiornare l'ADR pertinente secondo
  `CONTRIBUTING.md`. Correzioni che rispettano il contratto esistente non
  richiedono un nuovo ADR per il solo fatto di toccarne l'implementazione.

## Disciplina operativa

- Un workstream di implementazione usa un issue, un branch
  `codex/<issue>-<slug>` e un worktree dedicato. Non creare issue o PR senza
  autorizzazione; un collegamento mancante va dichiarato, non inventato.
- La checkout primaria resta una superficie di coordinamento, non di sviluppo
  runtime. Ispezioni e correzioni solo documentali, esplicitamente richieste e
  isolate dalle modifiche altrui, non richiedono nuovi worktree.
- Preferire un solo cambiamento logico per commit e nessun refactor laterale.
- Suddividere quando obiettivi indipendenti, ownership concorrente o impatto
  rendono difficile verificare e ripristinare il cambiamento. Il numero di
  righe, da solo, non e uno stop; fermarsi per un conflitto o una decisione di
  contratto non risolta.
- Prima del commit verificare branch corrente, scope del diff e stato del
  worktree.

## Coordinamento e lane parallele

Per MediFlow, la scelta tra lavoro singolo e sub-agent dipende dal compito;
questa regola sostituisce il default globale "Work solo by default". Un avvio
in solitaria puo servire a stabilire baseline e contratti. Rivalutare la
parallelizzazione quando emergono risultati indipendenti: usarla quando il
beneficio supera il costo di coordinamento, senza un numero prefissato di agenti.

### Modello ed effort per funzione

La modalita Ultra del coordinatore principale resta scelta dall'utente.
Solo il coordinatore in Ultra apre sub-agent, salvo richiesta esplicita
dell'utente. Ultra abilita la delega, non la impone.
Ai sub-agent assegnare esplicitamente un effort supportato e proporzionato:
Ultra e ammesso per incarichi sostanziali quando il coordinatore ne motiva
il vantaggio atteso sui tempi del lavoro in corso rispetto al costo di
coordinamento e verifica. Non ereditarlo per omissione o usarlo per default.
Controllare le impostazioni effettive all'avvio e alla ripresa, quando esposte;
se non osservabili, dichiararlo. Questo non autorizza spawn annidati.

- **Astra**: dirige il programma, individua e ripartisce i compiti, stabilisce
  contratti e criteri di accettazione, ricontrolla il lavoro e integra i risultati.
- **Sol**: esecutore autonomo e creativo per indagini e implementazioni
  sostanziali; sceglie l'approccio entro i criteri di Astra e gli risponde
  del risultato, che resta soggetto alla verifica di Astra.
- **Terra**: esegue compiti precisi e delimitati, anche su piu file, con
  discrezione implementativa entro il contratto assegnato.
- **Luna**: agente foglia per compiti stretti e codificati, implementazioni
  circoscritte, test mirati, letture e controlli visivi; non coordina altre lane.
- Prima di assegnare il lavoro, individuare attivamente piu compiti adatti
  a Terra e Luna e preferire il modello meno oneroso capace di completarli.
  Ripartire diversamente il lavoro quando permette questa delega senza perdere
  coerenza. L'obiettivo e usarli di piu, non ampliarne l'autonomia o creare
  frammentazioni artificiali. Non concentrare su Astra lavoro delegabile.
- Astra puo organizzare gerarchie funzionali: Sol puo guidare tecnicamente
  un gruppo di lane Terra/Luna gia aperte e assegnate da Astra. I sub-agent
  possono comunicare direttamente, se gli strumenti lo consentono, per
  chiarimenti, dipendenze e consegne entro i rispettivi incarichi. Astra resta
  responsabile di assegnazioni, cambi di scope e accettazione finale; la
  gerarchia non autorizza spawn annidati o modifiche fuori ownership.
- Scegliere effort e strumenti per complessita, rischio e incertezza. Max
  non e un default, in particolare per Sol e Terra: richiede una necessita
  concreta. Aumentare l'effort o cambiare modello quando le prove lo richiedono;
  non imporre quote di modelli.
- Registrare modello, effort e motivo nella consegna della lane; distinguere
  impostazioni richieste da quelle osservate. Dichiarare indisponibilita senza
  sostituzioni silenziose.
- Valutare il mix sul risultato verificato: consumo osservabile, tempo,
  supervisione, rifacimenti e qualita finale. Non dedurre risparmio effettivo
  dal solo prezzo per token; adeguare la distribuzione alle prove raccolte.

### Responsabilita e ciclo delle lane

- Il coordinatore mantiene un solo obiettivo di programma e decide quali lane
  aprire, con una breve motivazione nel checkpoint esistente. Mantiene in
  sequenza il lavoro accoppiato o con ownership in conflitto.
- Prima di aprire una lane, definire scopo e fuori scope, contratto e dipendenze,
  owner, file o contesto assegnati, autorita, output atteso, Definition of Done,
  verifiche e condizione di arresto. Usare worktree separati per writer
  concorrenti e rispettare modello, effort e modalita scelti dall'utente.
- Ogni lane segue un ciclo esplicito: apertura, esecuzione, consegna candidata,
  verifica del coordinatore, chiusura. Il coordinatore controlla output e prove;
  il resoconto del sub-agent, da solo, non attesta integrazione o completamento.
- Alla chiusura registrare esito, artefatti, verifiche, limiti e destinazione del
  risultato; poi chiudere il sub-agent. In caso di blocco o annullamento,
  conservare il lavoro e indicare motivo e prossimo passo, senza dichiarare Done.
  Nessuna lane resta aperta senza un incarico attivo e un responsabile.
- La delega resta entro l'autorita del task e non autorizza altre deleghe,
  azioni esterne o modifiche fuori scope. Le scelte prodotto riservate
  all'utente restano al coordinatore per la decisione pertinente.

## Igiene documentale

- Se un file Markdown viene aggiunto, rimosso o rinominato, aggiornare
  `docs/markdown-index.md`.
- Se cambia la fonte autorevole di un tema, aggiornare `docs/README.md`.
- Allineare prima la fonte canonica, poi le sintesi secondarie.
- Stato reale, direzione e fuori-scope devono restare distinguibili.

## Verifica minima

Per modifiche solo documentali:

```bash
git diff --check
rg --files -g '*.md' | sort
```

Per modifiche runtime, seguire i comandi e la Definition of Done in
`CONTRIBUTING.md`. Dichiarare sempre cosa e stato verificato e cosa non lo e.

## Attribuzione Codex

Il codice specificamente prodotto da Codex usa `/* @Codex */` per i blocchi o
`// @Codex` inline. La regola non richiede marcatori nei soli documenti.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

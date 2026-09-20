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

## Organizzazione del lavoro: pilota 0.8.6

Il riferimento ordinario e **Astra Medium, senza Fast**, come coordinatore.
Astra mantiene la visione del progetto, il goal di consegna, le priorita, i
contratti, l'integrazione e l'accettazione finale. Delega l'esecuzione ordinaria;
interviene direttamente su diagnosi difficili, conflitti tra contributi e scelte
che richiedono comprensione trasversale. Questa e una strategia da misurare sul
risultato accettato, non una garanzia di qualita equivalente o minor consumo.
Rispettare modello, effort e modalita scelti esplicitamente dall'utente.

- **Luna Medium Fast** e la prima scelta per incarichi chiari, circoscritti e
  verificabili: estrazioni, confronti, controlli ripetibili e piccoli interventi
  con contratto e accettazione espliciti. Usare `mediflow-luna`; il ruolo personale
  `luna` puo avere impostazioni diverse. Preferire piu incarichi indipendenti
  utili, senza spezzare artificialmente un problema accoppiato per affidarlo a Luna.
- **Terra Medium** esegue interventi circoscritti che richiedono giudizio sul
  codice, sugli errori e sui contratti oltre quanto gia risolto nel brief.
  Usare `mediflow-terra` quando disponibile.
- **Sol, al massimo Medium**, copre incarichi delimitati con ambiguita o
  dipendenze maggiori, quando il coordinatore prevede che Luna o Terra
  richiederebbero troppe correzioni. Non e un passaggio obbligatorio dopo Terra.
  Un bisogno di ragionamento superiore torna ad Astra; non aumentare
  automaticamente Sol a High, Extra High, Max o Ultra.
- Luna, Terra e Sol sono esecutori finali: non coordinano altri agenti e non
  delegano ulteriormente. Scegliere direttamente il profilo adeguato senza
  attraversare ogni livello. Su fallimenti ripetuti, correggere brief o approccio
  e riassegnare solo dopo aver identificato il limite; non consumare tentativi
  per conservare a tutti i costi il modello meno costoso.
- Prima della delega verificare modello, effort e modalita effettivi del ruolo
  nella checkout usata. Non sostituire un profilo indisponibile di nascosto:
  segnalare il limite e proseguire il lavoro compatibile nel coordinatore.
  I profili locali vivono in `.codex/`, esclusa da Git; non presumere che seguano
  ogni worktree. Le equivalenze tra effort, modelli e consumo vanno misurate.
- **Astra Ultra** resta una modalita separata, scelta intenzionalmente
  dall'utente. Non trasformare automaticamente una difficolta in Ultra o in
  uno swarm di Astra. Per un nucleo difficile e indipendente, il coordinatore puo
  scegliere un sub-agent Astra Light/Low se disponibile e utile rispetto a Sol
  Medium, motivandolo nel checkpoint; non assumere equivalenze di costo o qualita.

## Coordinamento e lane parallele

Per MediFlow la delega e il percorso ordinario per l'esecuzione separabile;
questa regola sostituisce il default globale "Work solo by default". Dopo una
ricognizione sufficiente a fissare baseline e contratti, assegnare ai collaboratori
il lavoro indipendente e tenere nel coordinatore il nucleo complesso. Lavorare da
soli resta appropriato quando il compito e breve, strettamente accoppiato o il
costo di preparazione e integrazione supererebbe quello dell'esecuzione diretta.
Non applicare un tetto documentale fisso di tre collaboratori: rispettare la
concorrenza realmente disponibile e il budget concordato. Aumentare le lane solo
quando aggiungono risultati indipendenti; nessuna quota di agenti da riempire.

- Il coordinatore mantiene un solo obiettivo di programma e decide quali lane
  aprire, con una breve motivazione nel checkpoint esistente. Mantiene in
  sequenza il lavoro accoppiato o con ownership in conflitto.
- Prima di aprire una lane, definire scopo e fuori scope, contratto e dipendenze,
  owner, file o contesto assegnati, autorita, output atteso, Definition of Done,
  verifiche e condizione di arresto. Usare worktree separati per writer
  concorrenti e rispettare modello, effort e modalita scelti dall'utente.
- Fornire il contesto minimo completo: problema, file e dipendenze pertinenti,
  contratti e prove attese. Chiedere risultati compatti con diff, evidenze e
  limiti; non trasferire l'intera storia del programma per ogni incarico.
  Durante le esecuzioni delegate proseguire su lavoro indipendente, evitando
  sia l'attesa passiva sia la duplicazione dell'incarico.
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

## Consegna e consumi del pilota

- Un fix o un intervento sulle prestazioni conserva comportamento e interfaccia
  esistenti, salvo un cambiamento richiesto. Per modifiche alla UI, confrontare
  il percorso prima/dopo sulla superficie corretta con dati sintetici; verificare
  il risultato richiesto oltre ai controlli tecnici. Un test verde non autorizza
  una riprogettazione e non dimostra da solo che il problema dell'utente sia risolto.
- Valutare i commenti di review rispetto al problema e ai contratti: integrare
  i difetti pertinenti, senza allargare il lavoro a miglioramenti laterali.
  Se le iterazioni ripetono gli stessi errori senza nuove evidenze, rivedere
  ipotesi, contesto e approccio prima di spendere altri tentativi o aumentare effort.
- Astra esegue un riesame finale mirato del risultato integrato: controlla
  contratti, conflitti e percorso dell'utente, correggendo i difetti pertinenti.
  Non riscrive sistematicamente il lavoro delegato e non ripete prove ancora
  valide senza una ragione concreta. Il riesame non abbassa l'accettazione delle
  singole lane e non garantisce a posteriori una percentuale di qualita.
- Nel checkpoint gia usato registrare per ciascun risultato significativo
  modello/effort/modalita, collaboratori, esito verificato, tempo e correzioni
  necessarie. Aggiungere consumi solo se disponibili e attribuibili; i limiti
  dell'account sono condivisi e non misurano da soli il costo di questo task.
  Confrontare consumo e tempo per risultato accettato, includendo il lavoro rifatto.

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

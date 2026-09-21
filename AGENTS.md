# AGENTS.md: MediFlow

## Missione

MediFlow è una cartella clinica territoriale che conserva localmente i dati.
Gli agenti devono preservarne privacy, sicurezza, semplicità e verificabilità:
per questo lavorano con diff piccoli, nei quali sia possibile riconoscere e
riesaminare ogni cambiamento.

## Orientamento proporzionato

Leggere `AGENTS.md` e verificare branch e stato del worktree prima di
consultare le parti di `README.md` e `docs/STATE_OF_THE_SYSTEM.md` pertinenti
al compito. Quando un documento descrive una fotografia del sistema, controllarne
data e checkout: una prova riferita a quella revisione non attesta, da sola,
lo stato della release corrente.

- Per trovare la fonte canonica: `docs/README.md` e `docs/markdown-index.md`.
- Per repository, branch e consegna: `docs/repository-topology.md`.
- Prima di modificare codice: `CONTRIBUTING.md` e i contratti del componente.
- Per dati, sicurezza o architettura: `SECURITY.md`, `ARCHITECTURE.md` e gli
  ADR del confine interessato, non tutti gli ADR recenti.
- Per una vista end-to-end: `docs/walkthrough.md`.

Il contesto deve essere sufficiente al compito, non esteso a documenti che
non lo riguardano. Non caricare quindi materiale estraneo e, quando esiste un
documento di riferimento pertinente, non dedurre dal solo codice le intenzioni
architetturali.

## Repository canonica

- `https://github.com/Wulfgardr/mediflow` è l'unica repository operativa e
  canonica del progetto.
- La precedente repository privata `Wulfgardr/mediflow_private` è archiviata:
  non è una fonte di sviluppo, pianificazione o rilascio.
- Non esiste più un flusso private-to-OSS, una doppia mainline o un passaggio di
  export prima della pubblicazione.
- Branch, commit, pull request, issue, tag e release appartengono alla
  repository pubblica.
- Database, PHI/PII, credenziali, output runtime, corpus autenticati e altri
  artefatti riservati restano fuori da Git; non vanno spostati nella vecchia
  repository privata.

La decisione e il suo perimetro sono documentati in
[`docs/repository-topology.md`](./docs/repository-topology.md).

## Sicurezza e privacy

- Non committare PHI/PII, database reali, screenshot o log con dati clinici.
- Usare solo fixture sintetiche.
- Nessun cloud, telemetria o invio di dati all'esterno è attivo per default.
- Prima di cambiare confini di sicurezza, contratti dei dati/API o decisioni
  architetturali durevoli, scrivere o aggiornare l'ADR pertinente secondo
  `CONTRIBUTING.md`. Una correzione che rispetti il contratto esistente non
  richiede invece un nuovo ADR per il solo fatto di modificarne l'implementazione.

## Disciplina operativa

- Ogni filone di implementazione usa una issue, un branch
  `codex/<issue>-<slug>` e un worktree dedicato. Non creare issue o PR senza
  autorizzazione; dichiarare un collegamento mancante, senza inventarlo.
- La checkout primaria serve al coordinamento, non allo sviluppo runtime.
  Ispezioni e correzioni solo documentali non richiedono nuovi worktree quando
  siano esplicitamente richieste e isolate dalle modifiche altrui.
- Preferire un solo cambiamento logico per commit, senza refactor laterali.
- Suddividere il lavoro quando obiettivi indipendenti, responsabilità concorrenti
  sugli stessi file o impatto rendano difficile verificare e ripristinare il
  cambiamento. Il numero di righe, da solo, non impone uno stop; fermarsi invece
  davanti a un conflitto o a una decisione di contratto non risolta.
- Prima del commit verificare branch corrente, perimetro del diff e stato del
  worktree.

## Organizzazione del lavoro: pilota 0.8.6

Il coordinamento ordinario è affidato ad **Astra Medium, senza Fast**,
perché visione del progetto, obiettivo di consegna, priorità, contratti,
integrazione e accettazione finale rimangano nello stesso ruolo. Astra delega
l'esecuzione ordinaria e interviene direttamente sulle diagnosi difficili,
sui conflitti tra contributi e sulle scelte che richiedano una comprensione
trasversale. La strategia va misurata sul risultato accettato: non garantisce
qualità equivalente né minor consumo. Rispettare modello, effort e modalità
scelti esplicitamente dall'utente.

- **Luna Medium Fast** è la prima scelta per incarichi chiari, circoscritti e
  verificabili: estrazioni, confronti, controlli ripetibili e piccoli interventi
  con contratto e accettazione espliciti. Usare `mediflow-luna`, poiché il ruolo
  personale `luna` può avere impostazioni diverse. Preferire più incarichi
  indipendenti utili, senza dividere artificialmente un problema accoppiato
  per affidarlo a Luna.
- **Terra Medium** esegue interventi circoscritti nei quali occorra giudicare
  codice, errori e contratti oltre quanto già risolto nel brief. Usare
  `mediflow-terra` quando disponibile.
- **Sol, al massimo Medium**, copre incarichi delimitati con maggiori ambiguità
  o dipendenze, quando il coordinatore preveda che Luna o Terra richiederebbero
  troppe correzioni. Non è un passaggio obbligatorio dopo Terra. Se occorre
  ragionamento superiore, il compito torna ad Astra: non aumentare automaticamente
  Sol a High, Extra High, Max o Ultra.
- Luna, Terra e Sol sono esecutori finali: non coordinano altri agenti e non
  delegano ulteriormente. Scegliere direttamente il profilo adeguato, senza
  attraversare ogni livello. Dopo fallimenti ripetuti, correggere brief o
  approccio e riassegnare solo una volta identificato il limite; non consumare
  tentativi pur di conservare il modello meno costoso.
- Prima della delega verificare modello, effort e modalità effettivi del ruolo
  nella checkout usata. Un profilo indisponibile non va sostituito di nascosto:
  segnalare il limite e proseguire nel coordinatore con il lavoro compatibile.
  I profili locali risiedono in `.codex/`, esclusa da Git, quindi non presumere
  che seguano ogni worktree. Misurare le equivalenze tra effort, modelli e consumo.
- **Astra Ultra** resta una modalità separata, scelta intenzionalmente
  dall'utente. Una difficoltà non autorizza il passaggio automatico a Ultra
  o a uno swarm di Astra. Per un nucleo difficile e indipendente, il coordinatore
  può scegliere un sub-agent Astra Light/Low, se disponibile e utile rispetto
  a Sol Medium, motivandolo nel checkpoint; non assumere equivalenze di costo
  o qualità.

## Coordinamento e lane parallele

In MediFlow la delega è il percorso ordinario per l'esecuzione separabile e
sostituisce il default globale "Work solo by default". Una volta ricostruiti
baseline e contratti, assegnare ai collaboratori il lavoro indipendente e
mantenere nel coordinatore il nucleo complesso. L'esecuzione diretta resta
appropriata per un compito breve, strettamente accoppiato o per il quale
preparazione e integrazione costerebbero più del lavoro stesso. Non applicare
un tetto documentale fisso di tre collaboratori: rispettare concorrenza
effettivamente disponibile e budget concordato, aumentando le lane solo se
producono risultati indipendenti. Non c'è una quota di agenti da riempire.

- Il coordinatore mantiene un solo obiettivo di programma e decide quali lane
  aprire, motivandolo brevemente nel checkpoint esistente. Il lavoro accoppiato
  o con responsabilità in conflitto resta in sequenza.
- Prima di aprire una lane, definire scopo e fuori scope, contratto e dipendenze,
  owner, file o contesto assegnati, autorità, output atteso, Definition of Done,
  verifiche e condizione di arresto. Usare worktree separati per writer
  concorrenti e rispettare modello, effort e modalità scelti dall'utente.
- Fornire il contesto minimo completo: problema, file e dipendenze pertinenti,
  contratti e prove attese. Chiedere risultati compatti con diff, evidenze e
  limiti, senza trasferire l'intera storia del programma a ogni incarico.
  Durante le esecuzioni delegate proseguire sul lavoro indipendente, senza
  attendere passivamente né duplicare l'incarico.
- Ogni lane segue un ciclo esplicito: apertura, esecuzione, consegna candidata,
  verifica del coordinatore e chiusura. Il coordinatore controlla output e prove,
  perché il solo resoconto del sub-agent non attesta integrazione o completamento.
- Alla chiusura registrare esito, artefatti, verifiche, limiti e destinazione del
  risultato, poi chiudere il sub-agent. Un blocco o un annullamento richiede di
  conservare il lavoro e indicare motivo e prossimo passo, senza dichiarare Done.
  Nessuna lane resta aperta senza incarico attivo e responsabile.
- La delega resta entro l'autorità del task: non autorizza altre deleghe,
  azioni esterne o modifiche fuori scope. Le scelte di prodotto riservate
  all'utente restano al coordinatore per la decisione pertinente.

## Consegna e consumi del pilota

- Un fix o un intervento sulle prestazioni conserva comportamento e interfaccia
  esistenti, salvo un cambiamento richiesto. Per la UI, confrontare il percorso
  prima e dopo sulla superficie corretta, con dati sintetici, e verificare il
  risultato richiesto oltre ai controlli tecnici. Un test verde non autorizza
  una riprogettazione né dimostra da solo che il problema dell'utente sia risolto.
- Valutare i commenti di review rispetto al problema e ai contratti: correggere
  i difetti pertinenti, senza estendere il lavoro a miglioramenti laterali.
  Se tornano gli stessi errori senza nuove evidenze, rivedere ipotesi, contesto
  e approccio prima di spendere altri tentativi o aumentare effort.
- Astra riesamina in modo mirato il risultato integrato, controllando contratti,
  conflitti e percorso dell'utente e correggendo i difetti pertinenti. Non
  riscrive sistematicamente il lavoro delegato e non ripete prove ancora valide
  senza una ragione concreta. Il riesame non abbassa i criteri di accettazione
  delle singole lane e non garantisce a posteriori una percentuale di qualità.
- Nel checkpoint già usato registrare, per ogni risultato significativo,
  modello/effort/modalità, collaboratori, esito verificato, tempo e correzioni
  necessarie. Aggiungere consumi solo se disponibili e attribuibili: i limiti
  condivisi dell'account non misurano da soli il costo del task. Confrontare
  consumo e tempo per risultato accettato, includendo il lavoro rifatto.

## Igiene documentale

- Se un file Markdown viene aggiunto, rimosso o rinominato, aggiornare
  `docs/markdown-index.md`.
- Se cambia il documento autorevole di un tema, aggiornare `docs/README.md`.
- Allineare prima il documento di riferimento, poi le sintesi secondarie.
- Mantenere distinguibili stato reale, direzione e fuori-scope.

Per la voce editoriale, fare riferimento a
[come raccontare MediFlow](./docs/getmediflow-editorial-proposal.md).

## Verifica minima

Per modifiche solo documentali:

```bash
git diff --check
rg --files -g '*.md' | sort
```

Per le modifiche runtime seguire i comandi e la Definition of Done in
`CONTRIBUTING.md`, dichiarando sempre che cosa è stato verificato e che cosa
non lo è.

## Attribuzione Codex

Il codice specificamente prodotto da Codex usa `/* @Codex */` per i blocchi
oppure `// @Codex` inline; i soli documenti non richiedono questi marcatori.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

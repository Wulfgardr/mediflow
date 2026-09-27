# AGENTS.md: MediFlow

## Missione

MediFlow è una cartella clinica territoriale che conserva localmente i dati.
Gli agenti devono preservarne privacy, sicurezza, semplicità e verificabilità:
per questo lavorano con diff piccoli, nei quali sia possibile riconoscere e
riesaminare ogni cambiamento.

## Linguaggio delle interfacce

Tutti i testi delle interfacce MediFlow devono essere comprensibili a un medico
senza conoscenze di codice, infrastruttura, intelligenza artificiale o convenzioni
dei comandi. Usare parole semplici, precise e coerenti per spiegare significato,
azione e conseguenze, anche nelle impostazioni, negli errori e nelle etichette
accessibili. Non esporre gergo implementativo nel percorso ordinario e non
nascondere informazioni necessarie su dati, consenso o limiti.
Il contratto canonico e il criterio di accettazione per tutte le piattaforme sono
in [DESIGN.md, Plain language for physicians](./DESIGN.md#plain-language-for-physicians).
Applicarli a ogni modifica dell'interfaccia; i test tecnici da soli non dimostrano
la comprensibilita dei testi.

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
  `codex/<issue>-<slug>` e un worktree dedicato. Riusare la issue pertinente;
  dichiarare un collegamento mancante, senza inventarlo. La PR fa parte della
  consegna tecnica autorizzata; non creare nuove issue per ogni file o agente.
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

## Contratto e unità di consegna

Per filoni con più fasi o contributi, applicare `issue-delivery-manager`:
la issue Linear governa risultato e criteri, il parent governa sequenza e
dipendenze, il checkpoint locale conserva esecuzione e ricevute. I contratti
del prodotto restano nei documenti canonici del repository. Individuare il
programma corrente da `docs/README.md`, senza riaprire roadmap storiche.

Mantenere nel checkpoint esistente l'orizzonte operativo della richiesta:
risultato di prodotto, stato finale atteso e lavoro necessario ancora aperto.
Una coorte organizza la consegna di un comportamento completo, eventualmente
attraverso più issue accoppiate; non sostituisce l'orizzonte né costituisce uno
stop automatico. Mappare criteri coperti e residui, integrare i contributi e
proseguire finché l'obiettivo affidato è raggiunto. Una richiesta esplicitamente
limitata a una sola coorte resta limitata, ma ne comprende la consegna operativa.
Suddividere per risultati indipendenti, non per file, test o numero di agenti.

Per le richieste operative di sviluppo, Leonardo autorizza stabilmente commit,
push, PR, CI, merge, pubblicazione pertinente e installazione/aggiornamento
nell'ambiente già identificato, seguiti dalla verifica del percorso operativo.
I precedenti limiti di sola candidata locale nelle fotografie di pianificazione
non revocano questa autorizzazione. Una richiesta di sola analisi o pianificazione
resta tale. Conservare i controlli richiesti, backup e recuperabilità; la consegna
tecnica non sostituisce una decisione clinica o l'autorizzazione a usare dati reali.

Un'app aperta, installata o in attesa di collegamento non dimostra un percorso
funzionante. Diagnosticare e risolvere avvio, configurazione e collegamento
necessari al risultato. Se un intervento personale, come lo sblocco del
Portachiavi, impedisce di proseguire, mantenere owner e punto di ripresa; dopo
la conferma utente riprendere l'intera consegna. Nel coordinamento già
autorizzato tra chat, trasmettere lo sblocco all'owner tecnico e verificare
che sia stato preso in carico. Aggiornare Linear da solo non chiude il lavoro.

Usare un solo checkpoint esistente e il controllo locale della skill all'avvio,
quando cambia il contratto e prima dell'accettazione. Il controllo rileva
incoerenze nei metadati; Astra verifica significato, prove e autorizzazioni.
Se la skill non è disponibile, applicare questi criteri e dichiarare il
controllo non eseguito. Il monitor Git in `CONTRIBUTING.md` conserva un ruolo
distinto e non attesta la Definition of Done.

## Organizzazione del lavoro

Il coordinamento ordinario è affidato ad **Astra Medium, senza Fast**,
perché visione del progetto, obiettivo di consegna, priorità, contratti,
integrazione e accettazione finale rimangano nello stesso ruolo. Il coordinatore
sceglie collaboratori Luna, Sol o Astra secondo il compito e mantiene il lavoro
strettamente accoppiato al contesto complessivo, i conflitti tra contributi e
le decisioni trasversali. La strategia va misurata sul risultato accettato: non garantisce
qualità equivalente né minor consumo. Rispettare modello, effort e modalità
scelti esplicitamente dall'utente.

- **Luna Medium Fast** raccoglie evidenze entro un perimetro esplicito ed esegue
  estrazioni, confronti, controlli gia definiti e trasformazioni meccaniche.
  Non interpreta evidenze ambigue, non definisce cosa costituisce PASS e non decide su
  sicurezza, architettura e gate di rilascio. Se emerge una domanda interpretativa,
  restituisce fonti e limiti lasciando la conclusione ad Astra.
  Usare `mediflow-luna`; il ruolo personale
  `luna` puo avere impostazioni diverse. Preferire piu incarichi indipendenti
  utili, senza spezzare artificialmente un problema accoppiato per affidarlo a Luna.
- **Sol, al massimo Medium**, implementa incarichi delimitati con specifica,
  ownership, invarianti e criteri espliciti; gestisce le dipendenze che rendono
  inadeguata una trasformazione meccanica affidata a Luna. Usare `mediflow-sol`.
  Non ridefinisce semantica, autorità o protezioni per far passare i test.
  Le ambiguità di contratto e il ragionamento superiore tornano al coordinatore,
  che può assegnare un'analisi separabile ad Astra specialista:
  non aumentare automaticamente Sol a High, Extra High, Max o Ultra.
- **Astra specialista** affronta sottoproblemi complessi e separabili quando
  interpretazione, diagnosi causale, interazioni tra sottosistemi o revisione
  delle prove richiedano questo livello. Usare `mediflow-astra`, specificando
  nell'incarico e nella chiamata l'effort: Low/Medium per analisi delimitate,
  High/Max per nuclei particolarmente difficili, con motivazione nel checkpoint.
  Il profilo fissa il modello, ma lascia l'effort alla chiamata per non
  sovrascriverlo. Non ereditare implicitamente Ultra dal coordinatore; verificare
  l'impostazione effettiva. Scegliere direttamente il livello adatto, senza
  tentativi preliminari obbligatori con Luna o Sol e senza quote tra modelli.
  Lo specialista restituisce conclusioni, prove e limiti; l'integrazione e
  l'accettazione finale restano al coordinatore.
- Luna, Sol e Astra specialista sono esecutori finali: non coordinano altri agenti e non
  delegano ulteriormente. Scegliere direttamente il profilo adeguato, senza
  attraversare ogni livello. Dopo fallimenti ripetuti, correggere brief o
  approccio e riassegnare solo una volta identificato il limite; non consumare
  tentativi pur di conservare il modello meno costoso.
- Prima della delega verificare modello, effort e modalità effettivi del ruolo
  nella checkout usata. Un profilo indisponibile non va sostituito di nascosto:
  segnalare il limite e proseguire nel coordinatore con il lavoro compatibile.
  I profili del progetto in `.codex/` sono esclusi da Git e non seguono
  automaticamente ogni worktree. Il profilo `mediflow-astra` è installato a
  livello utente in `~/.codex/agents/`; verificarne comunque la disponibilità
  nella sessione. Il default locale Sol Medium resta un ripiego tecnico, non
  un vincolo sulla scelta esplicita. Misurare effort, modelli e consumo senza
  presumere equivalenze.
- **Astra Ultra** resta una modalità separata, scelta intenzionalmente
  dall'utente, per problemi con parti indipendenti che beneficiano
  dell'esplorazione parallela. Una catena causale strettamente seriale richiede
  analisi concentrata, non più agenti. Una difficoltà non autorizza il passaggio
  automatico del coordinatore a Ultra. In Ultra la squadra può essere mista:
  modello ed effort dei collaboratori seguono il singolo incarico, non quelli
  del coordinatore. Non aprire ulteriori livelli di delega.

## Criteri di assegnazione e responsabilita

Delegare a un modello meno capace solo se Astra puo verificare il risultato con
un lavoro sostanzialmente inferiore a quello necessario per produrlo direttamente.
Se accettare una conclusione richiede di ricostruire quasi tutto il ragionamento
del collaboratore, evitare quel passaggio a un modello meno capace: scegliere
Astra specialista se l'analisi è separabile e produce prove valutabili, oppure
tenerla nel coordinatore se è accoppiata al programma. Un test superato dimostra il suo esito, non la sufficienza
del test rispetto a un requisito di sicurezza o di rilascio.

Prima di un incarico non banale, valutare insieme:

- prova di correttezza disponibile: risultato atteso, schema, hash, test pertinente
  o ispezione circoscritta della fonte;
- interpretazione richiesta e dipendenze tra sottosistemi e contratti;
- conseguenze di una conclusione erroneamente positiva e contenimento dell'errore;
- costo di preparazione, verifica, integrazione ed eventuale rifacimento.

Affidare l'esecuzione a Luna o Sol solo con perimetro e output espliciti,
verifica economica, errore contenibile e nessuna necessita di ridefinire il
significato del compito. Scegliere direttamente il livello adatto; non provare
prima Luna per principio. Astra specialista può analizzare diagnosi ambigue e
confini complessi entro l'incarico; il coordinatore mantiene le decisioni
trasversali, il significato dei confini di sicurezza e l'accettazione delle
prove per PASS/HOLD/FAIL, ferme le decisioni e autorizzazioni riservate all'utente.

Nel brief/checkpoint esistente indicare in poche righe incarico, esecutore,
responsabile della decisione, motivo della scelta, prova attesa e condizione di
ritorno al coordinatore. Non creare un documento o una nuova procedura per ogni delega.
Se il coordinatore deve correggere ripetutamente l'interpretazione per una classe di compiti,
registrarlo nel checkpoint e assegnare quella classe a un livello adeguato o
trattenerla direttamente; distinguere questa ricostruzione dalla normale verifica.
Ridurre il parallelismo quando il lavoro residuo diventa seriale.

## Coordinamento e lane parallele

In MediFlow la delega è il percorso ordinario per l'esecuzione separabile che
soddisfa i criteri di assegnazione sopra e
sostituisce il default globale "Work solo by default". Una volta ricostruiti
baseline e contratti, assegnare ai collaboratori il lavoro indipendente e
mantenere nel coordinatore il nucleo strettamente accoppiato al programma. L'esecuzione diretta resta
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

## Consegna e consumi

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

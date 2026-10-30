# Registro della tranche intelligente 0.9.1

Il registro `registro-0.9.1.json` congela la copertura del contratto sulla
revisione sorgente indicata. È un inventario verificabile, non una allowlist
runtime e non un'ammissione clinica. Il test `release-register.test.ts`, incluso
nella selezione unitaria ordinaria, confronta tutti i descriptor con il codice,
il digest del contratto e le combinazioni attese. Una modifica del catalogo o
del contratto richiede una riconciliazione esplicita del registro.

Il conteggio storico cinque/undici è ancora esatto per i descriptor Fabric:
quattro funzioni generative con entrypoint, un descriptor OCR indisponibile e
undici deterministici. AnyDoc e Apple Vision sono estrazione/OCR separati,
non altre celle generative. Ricerca e navigazione sono requisiti aggiuntivi
espliciti: non vengono inventati due descriptor per far tornare un conteggio.
La loro presenza nel catalogo headless non prova un servizio operativo.
Ogni capacità è collegata a C-7/C-8, ma nessuna prova di consumo è dedotta
dal solo collegamento. Le superfici senza prova restano `not_verified`.

Le 13 celle contrattuali sono distinte dalle tre Treatment Reasoning remote
condizionate. `null` per modello o prova significa dato non fissato, non scelta
libera o permesso di esecuzione. Gli alias non valgono come identità immutabili.
Le venue delle celle descrivono il percorso contrattuale, mentre `venues` nei
descriptor fotografa il catalogo Fabric attuale: i due elenchi non attestano
la stessa cosa e nessuno dei due abilita un provider.

Il target resta Mac16,5 M4 Max/36 GB. Un carico singolo è il profilo del futuro
banco, non una sostenibilità già dimostrata. Budget di memoria e tempi restano
nulli fino a baseline e decisione; non si riciclano i limiti dei 16 GiB.

## Misura successiva del 30 ottobre 2026

La [misura reale](2026-10-30-local-runs/misura.md) aggiorna il controllo
preliminare: identità assegnate e spazio disponibile. I-2 resta bloccata
da `provider_version_unsupported` per Ollama `HEAD-36a6e99`. ATHENA Q4
ha completato i 9 casi diretti e via Fabric, con 10 soglie fallite su 18.
Nessuna proposta normalizzata sui casi positivi. I dinieghi uguali non
provano equivalenza; ADR 0166 resta Proposed e la revisione umana è aperta.

## Controllo preliminare del 30 ottobre 2026

Il [dossier del controllo preliminare](2026-10-30-local-runs/README.md) registra
l'approvazione esplicita di corpus e soglie ATHENA fornita da Leonardo nel nuovo
incarico. Le inferenze restano bloccate: spazio libero interno sotto 25 GiB e
identità non assegnate nel registro. Zero tentativi consumati, nessuna nuova
misura di qualità, tempo, memoria o arresto fisico. Il registro conserva null
per modelli e prove runtime; le ragioni di blocco locali sono aggiornate.
I limiti autorizzati sono ricevuti nel campo separato `localRunPrecheck`, senza
trasformarli in budget di prodotto qualificati. ADR 0166 resta Proposed.

La verifica seguente è storica e precede questa nuova autorizzazione.

## Verifica del 30 ottobre 2026

Base aggiornata: `498658cbf596b96811eecb843a3a60e3ea8ea458`.
Solo fixture sintetiche, Node 24.18.0. Nessun provider remoto, acquisto,
reset o utilizzo di quote. Nessuna modifica al runtime di consenso, egress,
scritture cliniche o ai claim di cifratura. Il nuovo E2E scrive soltanto
nell'archivio sintetico posseduto dal test.

| Riga | Stato | Risultato e limite |
| --- | --- | --- |
| I-0 | parziale | Copertura delle 16 capacità e 13+3 celle congelata e verificata. Identità dei modelli, prove per capacità/superficie e budget restano aperti. |
| I-1 | parziale | E2E Web sviluppo e standalone production: creazione/rilettura scheda e vista reale con quattro funzioni spente; nessuna richiesta generativa o esterna dal browser. Non prova egress del server, installazione, GPUI/headless né tutte le condizioni assente/guasto/quota. |
| I-2 | ferma | Nessuna nuova inferenza o retry: il margine del tentativo bounded storico non è ricostruibile con certezza. Servono autorizzazione residua esplicita, combinazione fissata, budget e prove offline sulle tre viste con misure e revoca fisica. I test di abort sintetico non provano la fine del runner. |
| I-3 | parziale | Preflight senza override nega con `MLX_UNAVAILABLE`; configurando il runner diretto già installato passa la presenza di artefatto/eseguibile, senza inferenza, download o ripiego. Nessuna nuova proposta reale, misura o revoca fisica. |
| I-3b | ferma | ADR 0166 resta Proposed. Nessuna equivalenza misurata o accettata; nessuna venue remota abilitata. |
| I-4 | ferma | ChatGPT fuori dal perimetro locale di questo incarico; nessuna nuova generazione né quota utilizzata. |
| I-5 | ferma | Decisione esplicita di Leonardo del 26 ottobre: nessuna prova API. |
| I-6 | ferma | Stessa decisione, provider distinto; nessuna prova API. |
| I-7 | parziale | Banco esistente funzionante in self-test: confronto simulato e otto mutazioni rilevate. Nessuna qualifica, parità o equivalenza reale; corpus e soglie del nuovo banco ancora da approvare da Leonardo. |

L'E2E isolato rifiuta la porta 3000, richiede la copia legacy disabilitata e
non effettua retry. La lettura della scheda o di una sintesi salvata non è
conteggiata come generazione. Le tre celle locali Ollama restano non provate;
la locale ATHENA resta non qualificata. Le nove celle remote delle prime tre
funzioni non avanzano con questo contributo. Il registro esplicita separatamente
le prove mancanti delle 13 celle e di ciascuna superficie.

I log completi e il JSON del self-test restano nel dossier esterno
`~/Antigravity/mf-hillclimb-20261028/intelligence-<sha-base>/`.
`evidenze.csv` conserva i digest dei risultati sintetici, anche falliti. Nessuna galleria
è aggiunta alla repository. Il self-test dichiara `qualification: false`;
le soglie in `../athena/soglie-proposte.md` non sono state approvate.

Verifiche locali: 16 test di registro/banco/annullamento e 33 test di
spegnimento/production ATHENA superati; un E2E Web superato; lint, typecheck,
never-regress, claims e selezione test completa superati. Il primo tentativo
`npm run build` nella checkout non sparse si è fermato al controllo metadata
(`unadmitted alias`, durante il banco E2E). Nessuna protezione è stata
allentata; la build di produzione richiede la sorgente sparse prescritta in
`docs/native-launch.md`, che esclude soltanto la fixture SQLite tracciata.

La build nella sorgente sparse separata della prima revisione del contributo
`f0de86dcfc667bdce390c71469372eeb4c40e2c1` è passata, compresa la preparazione
del runtime standalone. Il test Web ripristina sempre le impostazioni sintetiche
lette prima della prova, anche in caso di errore. Nessuna verifica GPUI è dedotta.

Durante la verifica del ripristino, una prima versione del test ha fallito
la POST eseguita dal contesto API privo della generazione archivio. La verifica corretta passa. Il test
usa ora il normale fetch della pagina anche per il ripristino, come per
le modifiche iniziali. Nessuna protezione del prodotto è stata modificata.

La stessa prova E2E corretta passa anche sul bundle standalone di produzione
`f0de86dcfc667bdce390c71469372eeb4c40e2c1`, porta 3298 e archivio sintetico
nuovo. Le revisioni successive cambiano solo test, registro ed evidenze: il
runtime del prodotto è identico. Il server di prova è stato arrestato.

# Stato terapia dalla vista chat

Refs WUL-788. Base `6a6a91ce1`, contenente #726.
C-5a/b: incremento implementato per PIN nativo; qualifica complessiva aperta.
C-6 non iniziata, perché subordinata alla chiusura di C-5.

La chat richiede attivazione, sospensione o completamento. Il medico sceglie
la terapia e controlla stato precedente, nuovo stato e versione nella GPUI,
poi conferma con PIN. Il server conserva la preview immutabile soltanto in
RAM, la lega a sessione autentica, archivio, ambulatorio e selezione, e la
consuma prima delle attese. Il limite di cinque minuti parte dall'apertura;
quello di trenta secondi dalla preview. La revoca durante il PIN impedisce
il commit. La vista non rinnova né reinvia.

La nuova route paired `/api/auth/native/therapy-status` offre apertura,
preview, esecuzione PIN, revoca e ricevuta. Non modifica `/api/v1` e non ha
impatto sul contratto OpenAPI stabile. Il corpo transazionale del comando
Web è condiviso: stesso writer, CAS, audit e ledger durevole. Nessuna nuova
tabella o migrazione. Il modello non riceve un tool di commit. Il bridge
restituisce soltanto UUID casuale del comando e uno degli esiti fissi in
`_meta`, senza ID paziente/terapia, nomi, versioni, PIN, proof o mapping.
`shell.rs` non è modificato.

Le prove sintetiche includono:

- PIN e route paired reali, payload chiuso, sessione copiata, paziente diverso,
  cambio selezione/ABA, revoca, capability ritirata, CAS e consumo singolo;
- orologio iniettabile: scadenza a 30 secondi, anche durante la verifica, e
  vista a cinque minuti con preview ancora fresca;
- tre ordini di contesa Web e due sessioni native, rappresentanti Claude e
  Codex: una versione vincente, un audit, due ricevute di conflitto;
- processi uccisi dopo conferma PIN, update, audit, ricevuta e commit:
  prima del commit nessun effetto parziale; dopo commit un effetto e una
  ricevuta. Il riavvio del servizio perde il consenso, non la ricevuta;
- mutazioni separate di CAS, trenta secondi, cinque minuti e consumo singolo:
  errori di asserzione attesi, baseline e copie ripristinate verdi. Il
  verificatore lavora su copie temporanee e conserva i log completi;
- frame Playwright isolato a 390 e 1440 px, porta 3000 sempre negata,
  riferimento opaco e recupero esplicito senza retry;
- test Rust con Card valida e controlli positivi preesistenti, Clippy e
  verifica formale legacy con raccordo esplicito del servizio comune.

Queste prove non sono un E2E sui desktop reali. Restano da completare il
raccordo Touch ID per la scrittura e la sua prova hardware con Leonardo,
la qualifica verticale GPUI/Claude/Codex sul candidato e la review
indipendente del diff finale. Il PIN non viene sostituito da un flag di
successo biometrico. Il pulsante Touch ID della scrittura è disabilitato e
la finestra lo dichiara. Nessuna ammissione clinica o chiusura di C-5/C-6.

Prima build locale: il controllo metadata ha respinto artefatti Rust con
hard link nel worktree. La build Web richiede una sorgente pulita sparse,
come in CI, senza aggirare il controllo. I primi tentativi del verificatore
di mutazione hanno mostrato errori di risoluzione dei moduli nelle copie
esterne; corretto il verificatore prima di considerare valide le mutazioni.
Il primo harness crash nativo con await al livello principale è stato
respinto dal loader: corretto con un ingresso async esplicito. Le prime
fixture della gara a tre presentavano campi extra nel binding native e sono
state respinte: ora usano il binding esatto e le tre gare passano.

Sviluppo assistito: GPT-6.1 Sol, effort xhigh, nessun subagente.
Consumi non attribuiti; nessun merge o installazione nell'archivio reale.

La build Web pulita di `5e2cad1239361e344e85b5b60ab37fc7c77510e0`
è passata con Node 24.18.0, inclusi postbuild e verifica del bundle standalone.
La suite mirata finale conta 52 test Node e 18 frame Playwright passati;
il raccordo terapia Rust passa con un host HTTP doppio. La prima CI ha
respinto il nuovo import `dbServer` non censito e ha esposto una lettura
prematura dei messaggi nel test di recupero. L'inventario registra ora solo
il nuovo import nominato, senza nuova connessione o writer. Il test attende
l'arrivo del comando, senza retry dell'operazione.

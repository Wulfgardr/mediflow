# FAQ MediFlow

> [!NOTE]
> **Stato documento: SECONDARY (FAQ pubblica e orientamento rapido).**
> Per il quadro completo parti da [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md).
> Per i confini canonici prevalgono [ARCHITECTURE.md](../ARCHITECTURE.md), [SECURITY.md](../SECURITY.md), [docs/ROADMAP.md](./ROADMAP.md) e [docs/walkthrough.md](./walkthrough.md).

## 🔒 MediFlow è cloud?

No: il punto di partenza è il lavoro locale, senza cloud, telemetria o invii
attivi per default. È il significato di `local-first`: si può usare il gestionale
anche con tutte le funzioni AI spente. Quando si aggiungono strumenti intelligenti locali, la loro
configurazione resta distinta da quella dei servizi esterni.

I percorsi di confronto o valutazione parallela, le *lane* di benchmark e
shadow evaluation, richiedono una scelta esplicita e restano separati dal
runtime clinico ordinario. La vocazione aperta e gratuita di MediFlow non
rende gratuiti hardware o servizi di terzi.

## Che cosa è disponibile nella 0.8.6?

Dal 20 settembre 2026 è pubblicata la release sorgente, distribuita negli
archivi GitHub ZIP e TAR.GZ. Il suo perimetro è il runtime locale e headless
sul Mac, con interfaccia browser su localhost. Non comprende installer nativi
firmati o notarizzati e non attesta app complete Windows, Linux, iOS o iPadOS.

Le prove sintetiche e la pubblicazione non autorizzano l’uso con dati clinici
reali. La valutazione del deployment resta al referente competente in WUL-688;
il programma coordinato da WUL-669 non è chiuso nel suo insieme.

## 🧭 Che cosa porta `v0.8.5`?

La `0.8.5` è la fase precedente: le sue prove mantengono la propria revisione,
non diventano verifiche della 0.8.6. Ha consolidato un sistema locale ibrido
in cui l’autorità clinica e la revisione restano fuori dai modelli.

La Fabric vi collega Patient Insight, Smart Import, Document Synthesis e
Treatment Reasoning come proposte da rivedere. AnyDoc estrae localmente gli
allegati; Apple Vision interviene solo sulle pagine PDF `needsOcr` supportate,
mentre DeepSeek-OCR 2/CUDA rimane escluso e non bloccante.

Il Supervisor portabile avvia MCP `stdio` con operazioni e durata dei permessi
limitate, revoca e audit sotto il controllo dell’host. Mini, in quel perimetro,
era una base CLI che negava l’operazione senza il canale parent, non ancora
collegata al Supervisor di produzione. F10 permetteva una preview via MCP,
lasciando il commit checkup alla UI Web fidata, dopo rilettura, step-up e
gesto del medico. Il pianificatore semantico resta in sola lettura e limitato
a due operazioni ammesse.

La fase comprende inoltre cattura e trascrizione italiana Apple sul dispositivo,
su macOS 26+, con consenso, audio limitato in RAM e revisione del testo.
Provider v2 e adapter ufficiali OpenAI/Anthropic sono integrati ma
`default OFF`, con prove su trasporti simulati e senza credenziali o rete live.
Il [quadro del sistema](./STATE_OF_THE_SYSTEM.md) distingue questi risultati
dagli sviluppi successivi.

## ✨ Cosa resta aperto dopo `v0.8.5`?

Le condizioni aperte della 0.8.5 vanno lette come una registrazione storica,
non come un elenco immutabile di difetti attuali. Comprendevano il completamento
Lume — componenti interni, filo, tipografia, Settings scene e QA manuale — e
le prove Apple su VoiceOver reale mobile, dispositivi fisici, preparazione
all’App Store e parità completa dell’interfaccia.

Restano distinzioni essenziali anche dopo la pubblicazione sorgente 0.8.6:
account, conservazione dei dati, invio live e qualità clinica non si deducono
dai test del codice; installer e compatibilità con host MCP esterni richiedono
prove proprie. Il raccordo Mini WUL-696 supera l’assenza storica del callsite
Supervisor, ma la prova sintetica non chiude il percorso clinico end-to-end.

Per la registrazione visita, microfono reale e validazione clinica non sono
attestati e non esiste scrittura clinica automatica. Offline, copertura dei
comandi UI e superfici derivate dai documenti dei client paired restano
parziali o riservati all’host dove documentato.

## 🍎 Posso usarlo su Mac, iPad o iPhone?

La superficie di riferimento della 0.8.6 è la web app locale sul Mac. Nel
sorgente esiste anche il lavoro sul bundle macOS/home-base, ma la release non
ne distribuisce un installer nativo firmato o notarizzato e non attesta la
consegna delle app mobili.

Il disegno mantiene il Mac come nodo `home-base` e iPadOS/iOS come client
associati esplicitamente, o *paired*. La lettura viene prima: le scritture
remote sono ammesse solo dove il contratto le prevede, con versioni e limiti
espliciti. Non esiste per questo una sincronizzazione automatica.

## 🖥️ E Windows/Linux?

Le prove del core Swift condiviso su Linux e Windows e quelle circoscritte
del runtime Node sono passi di portabilità, non app complete. Il Mac conserva
il ruolo di nodo e il fronte nativo più avanzato; iPhone e iPad seguono il
modello paired; Linux e Windows hanno prove di core e percorsi specifici.
Nessuna di queste evidenze estende da sola la distribuzione dichiarata della
0.8.6 o attesta parità universale.

## 🏠 Che cos'è `home-base`?

È il nodo che conserva il database autorevole. Quando l’operatore attiva la
modalità di rete, il Mac espone `/api/v1/network/*` a client fidati sulla
stessa rete: servono sia la credenziale del dispositivo associato sia una
sessione operatore valida.

L’attivazione è facoltativa e il perimetro resta `read-only-first`. Le prime
scritture documentate riguardano profilo/status paziente, diario, terapie,
checkup e osservazioni versionati; le estensioni seguono i contratti dei
singoli domini, non un permesso generale sul database.

## 🖥️ Ci sono ancora Preview Profiles?

No, non su `main`. La root web locale apre il cockpit Kree8, senza selettore
Graphite/Kree8 o profili di anteprima persistiti. Stack AI locale, Smart Import
da rivedere e contesto paziente SISS/FSE appartengono alla shell ufficiale.

Questo non impedisce di scegliere le funzioni intelligenti. Il selettore della
Fabric configura funzioni e modelli ammessi, non un’altra shell. Le
sperimentazioni future richiedono un percorso esplicito e verificabile; non
diventano selettori persistiti nelle `Impostazioni` per il solo fatto di esistere.

## 🏛️ Cosa vuol dire integrazione SISS in MediFlow, oggi?

Significa preparare il contesto del paziente e accompagnare l’operatore verso
i percorsi ufficiali già utilizzabili: handoff contestuale, prescrizione
`webapp-assisted` e pre-controlli locali dove pertinenti. Il dominio locale
delle prescrizioni di prestazione, distinto dalle terapie farmacologiche,
serve alla documentazione e al riesame del caso.

Non significa integrazione regionale nativa certificata, accesso arbitrario
a REST/WS regionali o un’interfaccia prescrittiva che sostituisca il modulo
ufficiale. MediFlow non genera NRE, non esegue invio prescrittivo regionale e
non effettua writeback FSE/SISS.

## 🤖 L'AI manda dati paziente fuori dal computer?

Non nel percorso predefinito. AnyDoc, Apple Vision, Ollama e ATHENA/MLX
lavorano localmente entro i rispettivi limiti. Gli adapter OpenAI/Anthropic
sono `default OFF`; la loro prova amministrativa richiede intento esatto,
opt-in dell’host, riferimento al segreto e politiche esplicite di uscita e
conservazione. I test di quel percorso usano trasporti simulati: non provano
invii live.

L’integrazione ChatGPT è distinta dalle API e resta opzionale. Collegamento
dell’account, configurazione, smoke sintetico e funzionamento reale non sono
sinonimi. Per inviare un contenuto devono essere soddisfatti consenso e
controlli del percorso; non è dichiarata una nuova prova live consumer sul
candidato finale. Nessuna preview Fabric autorizza una scrittura clinica.

## 🤖 Che cosa può fare un agente tramite MCP?

Può usare il catalogo delimitato: cercare terminologia, leggere Open Loops
nel contesto paziente concesso, preparare una proposta di follow-up e
interrogare il pianificatore in sola lettura. Per F10 produce soltanto
un’anteprima della transizione; la conferma e la scrittura restano nella UI
Web fidata e richiedono il gesto del medico.

MCP non riceve la prova autorizzativa della scrittura, non importa SQLite e
non possiede autorità generale. Autenticazione, validità del contesto,
scadenza dei permessi, revoca, audit e ricevute continuano a valere anche
quando l’operazione non passa da una schermata.

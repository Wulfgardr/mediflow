---
summary: "Canonical broad snapshot of current MediFlow product state, runtime boundaries, data model, AI lanes, and integration limits."
read_when:
  - "Needing a single current-state overview before planning or implementation."
  - "Checking whether a feature, integration, or claim is shipped, directional, or out of bounds."
---

# Stato del Sistema MediFlow

> [!IMPORTANT]
> **Stato documento: CANONICAL (lettura completa dello stato corrente).**
> Questa pagina distingue il prodotto disponibile, il contenuto dei sorgenti e
> le prove che ne documentano lo sviluppo. Per i principi stabili prevalgono
> [ARCHITECTURE.md](../ARCHITECTURE.md) e [SECURITY.md](../SECURITY.md); per i
> flussi operativi, [docs/walkthrough.md](./walkthrough.md). La governance della
> repository è definita da [AGENTS.md](../AGENTS.md) e
> [docs/repository-topology.md](./repository-topology.md).

Ultimo aggiornamento del raccordo di consegna: 2026-09-26. Le prove della release
del 20 settembre e delle candidature precedenti conservano data e revisione.

<!-- reconciliation-20260912 -->
**La `0.8.6` è stata pubblicata come [codice sorgente](https://github.com/Wulfgardr/mediflow/releases/tag/v0.8.6)
il 20 settembre 2026 alle 19:19:26 UTC**, non come draft o prerelease. Comprende
il runtime locale sul Mac, con interfaccia browser su localhost e accesso
senza interfaccia grafica per client e agenti autorizzati. Gli archivi disponibili
sono ZIP e TAR.GZ: non sono installer nativi firmati o notarizzati e non
attestano app complete Windows, Linux, iOS o iPadOS. Il client nativo segue un
percorso separato e non è un requisito di consegna della 0.8.6.

La release corrisponde al commit `46296266c0a8ff4d4ab19216af7e761cddec7d78`,
tree `76ecc6b32a44d852e6ca7aeeba03b449f6c3c5bb`.
La [CI sul commit pubblicato](https://github.com/Wulfgardr/mediflow/actions/runs/35530827079)
ha completato, come la PR353, sei workflow e sette controlli richiesti, senza
bypass né riesecuzione dei workflow. Su main, Playwright conta 159 test
passati e 51 skip previsti, senza flaky, fallimenti o retry; l’harness ChatGPT
conta 26 test passati, inclusi 10 casi di conformance, senza skip, fallimenti
o cancellazioni. Nella PR353, invece, 157 test Playwright erano passati subito
e due al retry automatico già previsto, con 51 skip. I due casi riguardavano
l’avviso di modello AI in hold e l’estrazione OCR di un’immagine: il risultato
successivo non dimostra che la causa dell’intermittenza sia stata risolta.

Il confronto degli archivi scaricati mediante API GitHub con il tree ha dato
corrispondenza per 2844/2844 blob Git in ciascuno. Lo ZIP misura 18.335.516 byte,
SHA256 `a2867cef3c2044e6e65aafe3230105b3c098f64ad3b6d00fd4a8faf273663fd2`;
il TAR.GZ misura 16.418.260 byte,
SHA256 `3934c67fe2c95c5c62a479342c7c55da0d1304dfe747ed018ec320edb932edc7`.
Questi dati identificano gli archivi della release, non una futura revisione
editoriale. Lo storico delle versioni resta nel [CHANGELOG](../CHANGELOG.md).

Pubblicare i sorgenti e superare prove sintetiche non equivale ad ammettere
un deployment clinico. Tale valutazione resta aperta in WUL-688 e spetta al
referente competente. Il coordinamento della consegna sorgente e del passaggio
alla 0.9.0 [WUL-669](https://linear.app/wulfgardr/issue/WUL-669) è invece
concluso dal 23 settembre. Non viene dichiarata una nuova prova live di account o
provider consumer sul candidato finale. Integrazione ChatGPT, login,
configurazione, prova sintetica ed esecuzione reale rimangono fatti distinti.

### Seguito della consegna — 23 settembre, riletto il 26 settembre 2026

Le [correzioni funzionali PR 358](https://github.com/Wulfgardr/mediflow/pull/358)
e il [dossier PR 359](https://github.com/Wulfgardr/mediflow/pull/359) sono
integrati in `main`, riletto a `6c212221a98f9b8e45cc1d243226d0adb41770bd`.
Comprendono il ritorno alla lista dopo il primo paziente, la conservazione
della preferenza del modello con funzione spenta e il messaggio della sintesi
disattivata. Non modificano retroattivamente il tag o gli archivi `v0.8.6`.

Il progetto 0.8.6 conta 21 issue concluse, quattro in revisione e due tracker
superati: WUL-683/684 trasferiscono requisiti a WUL-705/728/732, senza
dichiarare eseguito tutto il censimento o la semplificazione. WUL-685–688
conservano applicabilità, ruoli, adozione delle procedure e decisione sul
deployment concreto. Il loro stato non è un difetto software da chiudere
automaticamente.

WUL-729 conserva separatamente il timeout intermittente del selettore nativo
AnyDoc osservato nella CI della PR 358: il tentativo successivo superato non
ne dimostra la causa o la risoluzione. Il primo lavoro 0.9.0 parte dal
censimento WUL-705 e dalle verifiche richieste, secondo la
[roadmap](./ROADMAP.md#roadmap-vigente--21-settembre-2026), senza riaprire le
accettazioni 0.8.6 già documentate né qualificare piattaforme differite.

MediFlow si può usare senza AI. Le funzioni intelligenti sono facoltative e
producono proposte da rivedere; i fornitori esterni sono spenti per
impostazione predefinita. Gli agenti accedono ai comandi MediFlow, non al
database: autenticazione, permessi, verifica della validità del contesto,
conferma pertinente alle scritture cliniche, audit e ricevute restano necessari.
Né una preferenza di modello né una ricevuta possono sostituire tali requisiti.

**Come leggere la ricostruzione seguente.** I due aggiornamenti datati
ricostruiscono le candidature precedenti: verbi, limiti e risultati valgono per
quelle prove. Le sezioni tematiche descrivono i contratti e il contenuto
implementativo, segnalando le osservazioni della 0.8.5. Non sono un’attestazione
di esecuzione di ogni funzione sul commit pubblicato.

La [verifica notturna dell’8 settembre](./analysis/2026-09-07-086-release-verification.md#verifica-notturna-dell8-settembre-programma-ancora-aperto)
registrava build produzione 11b9, suite aggregata 4c99 senza fallimenti ma con
esclusioni esplicite, Linux standalone e Windows preview. Restavano da
verificare caricamento locale a freddo, nuovo percorso ChatGPT, installazione
WHO pulita, accuratezza OCR completa, parità desktop/Mini e dossier finale.
Quella fotografia non sostituisce il quadro di pubblicazione appena descritto,
né la pubblicazione chiude automaticamente tutti quei temi.
[ADR 0119](./adr/0119-anydoc-apple-vision-current-source.md) precisa inoltre la
precedenza di AnyDoc e Apple Vision nel percorso documentale 0.8.6: le prove
0.8.5 conservano la propria revisione.

---

## Aggiornamento di candidatura: 6–7 settembre 2026

Il 7 settembre la richiesta dell’utente riaprì lo sviluppo di impostazioni
guidate, integrazione ChatGPT, scelta del modello per esperienza, cataloghi e
parità desktop. Il [piano operativo](./analysis/2026-09-07-086-guided-configuration-plan.md)
ne definiva fasi e prove quando le capacità richieste non erano ancora tutte
implementate. L’utente aveva nuovamente reso disponibili VM Windows/Linux e
disco Xcode; prima di ogni test occorreva comunque verificare sorgenti e
ambiente. Le indisponibilità registrate in altri passaggi descrivevano momenti
diversi, non una proprietà permanente della repository.

Il [verbale integrato 0.8.6](./analysis/2026-09-06-086-integrated-closeout.md)
riunì le prove storiche e i controlli delle candidature successive. Risultavano
integrati navigazione web e Apple, form progressivi e scelta web tra barra
superiore e laterale. La decisione di sviluppo concluso su `c320694c3` rimase
un fatto storico. Gli addenda indipendenti chiusero il contratto PIN su
`cefa5c78` e verificarono la correzione degli allegati su `be923328`, poi
integrati in `11a42f68`, senza finding reportabili residui nel perimetro
sorgente revisionato.

La [verifica di rilascio](./analysis/2026-09-07-086-release-verification.md)
distingueva la build `e7f8a555a`, lo smoke MCP, una suite completa con un
fallimento e le prove focalizzate. Il pacchetto sorgente era autorizzato,
mentre CI finale, PR, merge e tag non erano ancora attestati: questa attesa
appartiene alla candidatura, non allo stato della release pubblicata il
20 settembre. Firma ed entitlements di produzione non erano verificati.
ThisDeviceOnly riguardava il nuovo inserimento della chiave cache e non il
token paired. La membership operatore–ambulatorio era un non-goal di ADR 0036,
non un finding aperto.

La verifica UI iPhone ↔ Mac/Home Base venne mantenuta come seguito nativo,
separato dalla consegna 0.8.6. XCTest, firma e prove UI conservati nel verbale
non attestavano una validazione multipiattaforma completa o installer firmati
di produzione.

Windows e Linux avevano acquisito prove locali su sistemi operativi reali:
build Node, avvio da directory vuota, configurazione ordinaria e percorsi
UI/headless, con runtime, TLS e database delle fixture nel rispettivo guest.
Per usare il pacchetto AnyDoc disponibile, Windows eseguiva Node x64 emulato su
ARM64; Apple Vision rimaneva specifico del Mac. Le suite non dimostravano una
parità funzionale universale.

Su `52ae794ab` la suite Node completa registrò 3.206 PASS e uno skip previsto,
con lint completo PASS. La ricevuta SwiftPM su `af139` registrò 822 PASS e uno
skip canonico su 823 test; la correzione del wrapper non rieseguì la suite.
Le compilazioni generic macOS universale e iOS device furono PASS con
`CODE_SIGNING_ALLOWED=NO`, senza avvio dell’app, Keychain o UI. Anche le dodici
prove API HTTPS con pairing distinti restavano diverse dalle sei combinazioni
app mobile/home-base.

Sul runtime `25e8f8708`, il full Windows registrò 145 PASS, un FAIL e 12 skip.
Il confronto colori fu riprodotto e corretto nel test separando hover e
selezione da tastiera. Il gruppo portable conservò nove timeout su 248 casi,
mentre MCP, Mini e Supervisor, eseguiti separatamente, furono PASS. Un controllo
con i soli file di test eseguiti in sequenza completò gli stessi 248 casi senza
errori; `5c25d0968` adottò quella sola opzione nel runner canonico. Il riepilogo
Node era completo, ma il wrapper non aveva acquisito il codice d’uscita del
figlio: non era quindi lo stesso esito del precedente run canonico fallito e
non identificava la causa dei timeout. La successiva esecuzione canonica di
`npm run test:headless-portable`, con runner `5c25`, superò tutti i 248 casi,
senza skip o retry e con codice d’uscita nativo 0. L’app del guest restava
compilata da `25e`. Linux completò 145 casi ordinari, distinti tra full e
opt-in, con 42 esclusioni esplicite e tutti i controlli headless PASS. Sorgenti,
fixture, simulazioni e precedenti prove CRUD/export restavano separati nel
verbale.

Le due suite UI firmate normalmente per il simulatore su `dc1fc0522`
(`5ced` più il solo fix demo `8fc`) registrarono 71 PASS, 11 skip previsti e
zero FAIL su 82 esecuzioni. Fixture sintetiche coprivano rotazione,
accessibilità, bozza e archivio; le sei combinazioni di app e host reali erano
ancora da verificare. Dopo lo sblocco del Mac, un’ulteriore osservazione XCTest
mostrò apertura del campo di configurazione e valore invariato PASS, senza
osservare il menu di selezione. Il riempimento del campo e il percorso reale
iPhone/Mac rimasero incompleti. Il limite d’uso del 20% fu revocato, ma la prova
venne differita per la decisione di chiusura. I volumi Xcode e delle VM furono
scollegati; le evidenze vennero conservate senza rieseguirle in quell’ambiente.
Alla chiusura di quella registrazione il candidato non era ancora pubblicato,
unito a main o rilasciato. Non è lo stato corrente della 0.8.6.

## Aggiornamento di candidatura: 5 settembre 2026

La [readiness 0.8.5](./release-085-readiness.md) raccoglie la revisione Pro e i
controlli locali riferiti al commit runtime `4f2aa312c`. Le ricevute precedenti
non verificavano automaticamente questo candidato. AppleShared/XCTest e
distribuzione restavano gate aperti: il codice sorgente e il canale binario
Apple avevano condizioni di consegna distinte.

## 🧭 1. Lettura rapida

MediFlow organizza cartella e lavoro ambulatoriale a partire dai dati, dalle
fonti e dalle attività da seguire. Non richiede di affidare queste funzioni a
un modello: il gestionale deve restare utile quando tutti i provider AI siano
disabilitati. La vocazione aperta e gratuita rende possibile studiarne e
discuterne le scelte; la modularità consente di non attivare ciò che non serve,
anche quando le risorse siano limitate. Non ne discende un requisito hardware
misurato o la gratuità dei servizi esterni.

La web app Next.js è la superficie primaria e SQLite locale (`medical.db`) è
lo storage autorevole, accessibile dal server attraverso Drizzle. La
cifratura avviene nel client per i campi clinici sensibili. Il file SQLite non
è cifrato integralmente: identificativi e metadati non sono tutti coperti dal
mapping. Questo non equivale a un perimetro zero-knowledge dell’intero database
o dei backup. Non sono attivi per default cloud o telemetria.
La repository pubblica `Wulfgardr/mediflow` è l’unica operativa; quella privata
precedente è archiviata e non è una destinazione alternativa per materiale
sensibile.

Il cockpit è l’ingresso web ufficiale, senza selettori di shell o preview
profiles persistiti. Lume e il contratto DTCG sono attivi nei sorgenti, mentre Vetro Clinico resta il riferimento storico e transitorio;
non viene dichiarata una parità estetica completa. Il contratto locale
`/api/v1/*`, con OpenAPI a presidio della parte stabile, permette ai client di
condividere le operazioni senza possedere un altro database autorevole.
La modalità `network-home-base` è una scelta esplicita su rete fidata:
abilita `/api/v1/network/*` per dispositivi paired e scritture versionate
circoscritte a profilo/status, diario, terapie, checkup, osservazioni e
prescrizioni. Le classi documentali restano quelle di ADR 0076. Disattivandola,
i pairing rimangono salvati ma i token diventano inerti e il piano dati
risponde `403 NETWORK_MODE_DISABLED` fino alla riattivazione.

Il Mac è il fronte nativo più maturo. La shell Apple/home-base può mostrare lo
stato del runtime e gestire esplicitamente backend production e proxy TLS,
con arresto limitato nel tempo ed escalation. `MediFlowCore` raccoglie logica
portabile, cifratura, contratti, filtri, clinical scales e store SQLite locale.
Le prove Node, UI e headless Windows/Linux riportate sopra non sono frontend
SwiftUI nativi né attestano app complete per quei sistemi.

Le misure di parità UI 0.8 hanno una storia precisa. iPhone 2/2, iPad 7/7,
build/probe macOS e localhost 82/82 PASS appartengono alla baseline
`0843726fe`; non verificano revisioni successive. Xcode è un prerequisito
della macchina di prova, non uno stato durevole del codice. La parità è
clinico-semantica, non di pixel; VoiceOver reale mobile non è provato e la
deroga storica non autorizza affermazioni di conformità. Nel checkpoint 0.8.2
le PR 163-176 risultavano su `main`, con review finali DeepSeek e Sol pulite;
sul push a main Apple Native superò build, suite iPhone e 4/4 contratti iPad
senza skip. Anche questi risultati restano attribuiti a quel checkpoint.

L’estrazione documentale parte da AnyDoc locale. Per i PDF supportati, solo
le pagine `needsOcr` passano al riconoscimento Apple Vision, dopo rendering
selettivo e prima della ricomposizione nell’ordine originale. La sorgente deve
restare valida per tutta l’operazione; errori e input non supportati fermano
il percorso e le vecchie route rispondono `410`. DeepSeek-OCR 2/CUDA conserva
lo stato `OUT_OF_SCOPE_FOR_0.8.5_NON_BLOCKING`. Il livello di assorbimento
dell’evidenza è stato misurato su corpus sintetico multi-fonte: recupero della
fonte, disciplina delle citazioni, recupero di fonti superate e leakage da
fonti non più correnti non sono misure di qualità clinica sul campo.

Le funzioni `AI Patient Insight`, Smart Import, Document Synthesis e Treatment
Reasoning attraversano ingressi applicativi distinti. La struttura che le
coordina, l’Intelligence Fabric, permette scelte per funzione entro il catalogo
e l’autorità dell’host; non rende intercambiabile qualunque modello. Ogni
risultato è una proposta con ricevuta, provenienza e validità del contesto
visibili, senza applicazione di dati clinici. Ollama e ATHENA/MLX hanno ambiti
locali specifici e nessun fallback silenzioso. Il selettore guidato copre
cinque capability, filtra i profili, esegue prove sintetiche e attiva i binding
in modo atomico con CAS e rollback, senza persistere segreti o qualificare da
solo il runtime. I numeri dello smoke ATHENA e gli esiti F6/F7 sono conservati
nella sezione AI, con il loro limite storico 0.8.5.

Il Supervisor Node avvia Web standalone e MCP `stdio` come figli distinti su
IPC ereditato. Il catalogo MCP offre ricerca terminologica, Open Loops del
paziente selezionato, proposte follow-up e query semantiche circoscritte in
sola lettura. WUL-696 aggiunge il punto d’ingresso Mini, con gli stessi comandi
CLI in una sessione NDJSON, attivazione Web e parent AIP obbligatori. La prova
con ricerca terminologica e audit su fixture è distinta dal completamento
clinico end-to-end e dallo smoke standalone del tree finale. MCP e Mini usano
lo stesso OperationClient governato; il planner ammette al massimo due
operazioni di lettura consentite, mai SQL diretto o scritture.

L’eccezione F10 non sposta il commit nell’agente: MCP prepara soltanto la
transizione `pending -> completed|cancelled`; la UI trusted rilegge la
risorsa, richiede ruolo medico attivo, step-up e gesto specifico e compie il
commit Web con CAS, idempotenza, audit e ricevuta atomici. Il proof non
attraversa MCP. Anche cattura e trascrizione italiana Apple su macOS 26 o
successivo richiedono consenso, tengono l’audio solo in RAM entro limiti
espliciti e trasferiscono il testo alla bozza dopo review, senza writer
automatici. Microfono reale e validazione clinica non rientrano nella prova
0.8.5.

Le prescrizioni di visite, esami, imaging, riabilitazione e screening sono un
dominio distinto dalle terapie: item e abbinamenti al repertorio restano da
rivedere e non producono invii regionali. Le attese locali web collegano
prestazioni previste e risultati con salvataggio esplicito, senza estensione
paired. Per SISS/FSE sono documentati handoff contestuale e
`webapp-assisted`, non un’integrazione regionale nativa qualificata senza
`SSI/A2A` e scenari approvati. PHI/PII, credenziali, dati runtime, corpus
autenticati e note personali di account restano fuori da Git.

---

## 🧱 2. Cosa e gia deciso

### 2.1 Local-first non e un dettaglio

Il dato nasce nel client locale, dove i campi clinici sensibili vengono cifrati
prima della persistenza sul disco autorevole. Quando presenti, AnyDoc, servizi
terminologici e provider AI ammessi possono operare localmente; l’eventuale
rete locale richiede un’abilitazione esplicita e un ambito delimitato. È questo
il significato operativo di local-first, non soltanto una preferenza per un
certo tipo di installazione.

Senza ADR e documentazione esplicita non sono ammessi sincronizzazione cloud
implicita, telemetria o analytics in background, upload automatico di documenti
clinici, database remoto multi-tenant o bypass del Mac `home-base` da parte
dei client mobili. Un runtime AI remoto come default resta vietato.

### 2.2 La shell web ufficiale e una sola

L’ingresso `/` usa il cockpit Kree8 come grammatica visuale di riferimento:
un’ispirazione esterna, non un prodotto MediFlow distinto. ADR 0060 supera
Graphite per la root, conservando il principio di ADR 0047: non tornare a
shell concorrenti o a un selettore permanente. Graphite rimane quindi un
riferimento storico, non una seconda esperienza supportata.

Le superfici AI, Smart Import e contesto paziente SISS entrano nel runtime
ufficiale quando mature, senza preview profiles persistiti. Le sperimentazioni
richiedono filoni di lavoro espliciti e non selettori nascosti nelle
impostazioni; non si aggiungono chooser permanenti e la documentazione deve
continuare a descrivere una sola esperienza supportata.

Documenti/ADR principali:

- [ADR 0060](./adr/0060-kree8-cockpit-live-root-entry.md)
- [ADR 0047](./adr/0047-graphite-workbench-single-official-web-shell.md)
- [ADR 0050](./adr/0050-functional-preview-profiles-retired-on-mainline.md)
- [docs/walkthrough.md](./walkthrough.md)

### 2.3 Il Mac resta il nodo autorevole

La famiglia Apple non è composta da tre applicazioni con tre archivi clinici
indipendenti. Il Mac mantiene SQLite e il ruolo `home-base`; API versionate e
limiti di rete espliciti collegano shell diverse per macOS, iPhone e iPad. Il
core Swift condiviso è la direzione architetturale; cache mobili derivate e
riconciliazione esplicita non vanno confuse con dati autorevoli o con una
sincronizzazione già completata.

L’impostazione resta read-only-first, ma i contratti non si fermano ai primi
cinque moduli: lifecycle paziente, diario, terapie, checkup, osservazioni,
prestazioni e protesica dispongono di scritture versionate. I cataloghi restano
in sola lettura per i client paired e i documenti ammettono creazione manuale
cifrata. Sono esclusi hard delete, PUT/DELETE paired degli allegati, artefatti
derivati da documenti, invocazione AI, scrittura offline, sincronizzazione
record-level e multi-master. Il pairing non concede un’autorizzazione
generale al client remoto.

Documenti/ADR principali:

- [ADR 0034](./adr/0034-local-only-default-and-network-home-base-opt-in.md)
- [ADR 0038](./adr/0038-network-readonly-data-plane-auth-boundary.md)
- [ADR 0048](./adr/0048-apple-shared-client-architecture-and-home-base-runtime.md)
- [docs/mobile-home-base-smoke.md](./mobile-home-base-smoke.md)

### 2.4 Il documento e evidenza, non testo da ingoiare

Prima di ricavare una proposta occorre poter risalire al documento e al punto
che la sostiene. Per questo il percorso è `artifact-first`: riconosce il
formato dai byte e affida ad AnyDoc locale, in un processo con limiti
espliciti, la produzione di Markdown normalizzato, evidenza e provenienza,
senza rete o servizi hosted.

Nella 0.8.5, per i PDF supportati, solo le pagine `needsOcr` vengono
materializzate e renderizzate entro i limiti previsti, quindi riconosciute con
Apple Vision sul Mac. La composizione rispetta l’ordine originale ed è
pubblicata soltanto se sorgente e sessione siano ancora correnti. Immagini
dirette, documenti cifrati, input ambigui e motore indisponibile interrompono
il percorso; le vecchie route OCR rispondono `410`.

Il risultato rimane evidenza da rivedere. `summarySnapshot` e
`parseEvidenceArtifactSnapshot` sono dati clinici e persistono cifrati; i nuovi
`parseEvidenceArtifactSnapshot` possono includere `sectionMap`, ancore
`page/section/snippet` e conflitti terapeutici da sottoporre all’operatore.
`patients.documentInsights` è una proiezione mantenuta per compatibilità, non
il modello documentale definitivo. La presenza di diagnosi o terapie in un
testo libero non ne autorizza la promozione automatica: una scrittura
strutturata richiede review e soglie di certezza documentate.

Documenti/ADR principali:

- ADR 0040 (private)
- [ADR 0042](./adr/0042-document-driven-new-patient-review-and-prudent-therapy-persistence.md)
- [ADR 0102](./adr/0102-document-synthesis-source-authority.md)
- [ADR 0107](./adr/0107-anydoc-local-attachment-extraction.md)

### 2.5 Le integrazioni regionali restano dentro canali ufficiali

Preparare il contesto del paziente e aprire il percorso corretto può essere
utile senza simulare un’integrazione che non esiste. MediFlow ammette
`portal-handoff` e `webapp-assisted`; il prescrittivo continua a usare il
canale ufficiale. Un’integrazione SISS/FSE nativa richiede qualifica,
provisioning e scenario approvato, mentre SGDT/FSE e prescrittivo nativo
richiedono analisi specifiche per scenario.

Il corpus locale SISS/FSE serve a istruire queste decisioni, non a eludere i
requisiti regionali. Documenti autenticati o non redistribuibili restano fuori
da Git.

Documenti/ADR principali:

- [docs/siss-baseline.md](./siss-baseline.md)
- [docs/siss-ssi-a2a-feasibility.md](./siss-ssi-a2a-feasibility.md)
- [docs/siss-modulo-prescrittivo-regionale.md](./siss-modulo-prescrittivo-regionale.md)
- [docs/siss-fse-docs-corpus.md](./siss-fse-docs-corpus.md)
- [ADR 0045](./adr/0045-siss-native-integration-boundary-requires-qualified-ssi.md)
- [ADR 0046](./adr/0046-modulo-prescrittivo-regionale-first-slice-webapp-assisted.md)
- [ADR 0049](./adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md)

---

## 🖥️ 3. Superfici runtime

La tabella distingue responsabilità e limiti dei componenti nei sorgenti.
«Integrato» non significa installato su ogni host, clinicamente qualificato o
compreso in un installer pubblicato. Le prove tri-OS e native sono quelle
attribuite alle revisioni precedenti, non una nuova attestazione della 0.8.6.

| Superficie | Stato | Uso reale | Boundary |
| --- | --- | --- | --- |
| Web app locale | Primaria | Cartella e attività ambulatoriali sul Mac; root Kree8 e route locali, senza attestazione di deployment clinico | HTTP localhost, sessione web |
| `/api/*` | Runtime web | CRUD, auth, proxy locali, sistema | Session cookie |
| `/api/v1/*` | Contratto locale/shared | Client native e superfici stabili | Bearer token locale, TLS proxy |
| `/api/v1/network/*` | First slice home-base | Lista/dettaglio pazienti e write limitati/versionati su profilo/status, diario, terapie, checkup e osservazioni da device paired | Credenziale device + sessione operatore |
| macOS Apple shell | Implementata; seguito nativo separato | Fronte nativo piu maturo: shell Apple/home-base, workspace paziente condiviso, runtime panel e store locale verificabile; Lume e consegnata nella card clinica opaca, mentre le altre superfici restano in migrazione | Firma/notarizzazione esplicite, Ollama/MLX non app-managed |
| `MediFlowCore` tri-OS | Prove storiche tri-OS | Core Swift condiviso per logica clinica, cifratura, contratti, filtri, conflict handling, clinical scales e SQLite locale | CI Linux/macOS/Windows; non equivale a app complete Windows/Linux |
| iPhone/iPad | Paired | Client paired non-AI, cache cifrata degradabile e workflow online versionati sui moduli core | No SQLite diretto |
| AnyDoc | Estrazione locale | Conversione deterministica degli allegati supportati in Markdown normalizzato | Processo figlio bounded; nessuna rete; non è un provider Fabric |
| Fallback `needsOcr` | Integrato sul Mac | Routing, manifest, rendering selettivo e riconoscimento Apple Vision | Review-only; fail-closed fuori da macOS o senza motore disponibile |
| Selector Fabric | Integrato | Discovery compatibile, smoke sintetico e binding atomico per cinque capability | Nessun segreto persistito; discovery non equivale a readiness |
| Ollama | Provider locale capability-specific | Percorsi generativi Fabric ammessi dalla capability | Solo loopback; nessun OCR o fallback implicito |
| ATHENA/MLX | Provider locale capability-specific | Solo Treatment Reasoning review-only | Nessuna prescrizione o apply clinico |
| OpenAI / Anthropic | Adapter ufficiali `default OFF` | Probe amministrativa Document Synthesis review-only con policy e secret reference host-owned | Solo transport fake nel tree; nessuna credenziale, rete live o runtime readiness |
| MCP | Superficie figlia locale | Catalogo, terminology search, Open Loops patient-scoped, proposta follow-up e query semantica bounded read-only | Usa il Supervisor locale della 0.8.5; nessuna authority caller-supplied |
| Mini | Lane WUL-696: callsite Supervisor | Parità dei comandi CLI su NDJSON; ricerca terminologica production su fixture | Attivazione Web e parent AIP obbligatori; stesso perimetro di capability, nessun apply |
| Write checkup F10 | Integrata end-to-end | Preview MCP e commit Web con ruolo, step-up, gesto, CAS, idempotenza, audit e receipt | L'agente non riceve proof e non esegue il commit |
| Semantic planner | Integrato, sola lettura | Core, validazione, esecutore e adapter MCP/Mini presenti; sessione Mini e MCP usano lo stesso adapter; DoD clinico end-to-end distinto | Massimo due operazioni allowlisted; nessun SQL libero o write |
| ICD-11 WHO | Application Service server-only, sidecar locale | Search con output MediFlow data-only e URI canonico | Disattivato per default; provisioning manuale e prova sul target non attestati dal quadro fornito |
| OpenMed | Shadow/benchmark | Redaction lane locale non client-facing | Non runtime clinico |

---

## 🗄️ 4. Percorso dati clinici

### 4.1 Scrittura web ordinaria

Dopo lo sblocco, la master key resta soltanto nella RAM del client. Il medico
opera nella web app, che cifra i campi sensibili prima di inviare il payload
alle route `/api/*`; il server persiste il ciphertext in SQLite. Audit e log
restano PHI-safe e descrivono l’operazione senza sostituire il dato clinico.

### 4.2 Lettura e rendering

Il server legge i record cifrati e li restituisce nel formato previsto. È il
browser o client, con la master key in memoria, a decifrarli. L’interfaccia
mostra soltanto quanto sia necessario al lavoro corrente: la possibilità di
leggere non è un invito a trasferire tutto il contenuto della cartella.

### 4.3 Allegati e artifact documentali

Il medico carica o seleziona un allegato corrente, la cui autorità appartiene
all’host. Il runtime ne riconosce il formato dai byte e chiama AnyDoc con
limiti di input, tempo e output, ottenendo Markdown normalizzato, evidenza e
provenienza. Se il PDF è supportato, soltanto le pagine `needsOcr` passano a
rendering e Apple Vision locale; prima di ricomporle nell’ordine originale
viene ricontrollata la sorgente.

Immagini dirette, documenti cifrati, formati non supportati e indisponibilità
del motore richiedono revisione manuale. Il flusso non inventa testo e non
produce proposte da contenuto incompleto. Solo l’evidenza ancora valida può
alimentare servizi successivi e proposte tipizzate da rivedere; l’applicazione
è un gesto separato, mai autorizzato dalla preview Fabric.

Quando i flussi di dominio li persistono, allegato, `summarySnapshot`,
`parseEvidenceArtifactSnapshot` e proiezione `documentInsights` restano
cifrati. I consumer previsti sono `AI Patient Insight`, Smart Import, nuova
anagrafica da documento e strumenti di troubleshooting documentale: la
condivisione dell’evidenza non fonde le loro responsabilità applicative.

### 4.4 Home-base paired patient data plane

Abilitata la modalità `network-home-base`, il dispositivo remoto apre un
intento di pairing PHI-safe. Il Mac deve confermarlo esplicitamente prima di
rilasciare la credenziale dedicata. Le route `/api/v1/network/patients*`
richiedono contemporaneamente dispositivo paired valido, sessione operatore
valida sul nodo e ambito clinico risolto dal nodo stesso.

`GET` pazienti rimane in sola lettura. `PUT /api/v1/network/patients/{id}`
modifica soltanto profilo/status e richiede
`network.replica.write-patient-profile` e `version`.
Il diario `/api/v1/network/patients/{id}/entries*` ammette lettura, creazione,
aggiornamento e soft-delete con capability dedicate e `entries.version`;
riferimenti agli allegati sono accettati solo se sigillati e validati dal
client. Hard delete, sincronizzazione e campi AI o derivati da documenti
restano bloccati.

Le risorse condivise `/api/v1/patients/{id}/entries*`,
`/api/v1/patients/{id}/therapies*`, `/api/v1/patients/{id}/checkups*` e
`/api/v1/patients/{id}/observations*` mantengono, per web e native, semantica
reversibile e versionata: PUT figli con controllo di versione e `409` sul
conflitto, lista attiva per default, `includeDeleted=true` per i tombstone e
DELETE sempre come soft-delete. L’audit distingue eliminazione e
aggiornamento.

Lo stesso limite paired vale per `/api/v1/network/patients/{id}/therapies*`,
`/api/v1/network/patients/{id}/checkups*` e
`/api/v1/network/patients/{id}/observations*`: capability specifiche,
`therapies.version`/`checkups.version`/`observations.version`, conflitti `409`
PHI-safe e soft-delete, senza hard delete remoto o campi AI/documentali.
Disabilitando `network-home-base` si conservano i pairing, ma i token diventano
inerti e il piano dati risponde `403 NETWORK_MODE_DISABLED` fino alla
riattivazione della modalità.

---

## 🤖 5. AI stack e regole di promozione

### 5.1 Runtime operativo locale 0.8.5

Questa sezione conserva il perimetro AI della 0.8.5: il runtime operativo è
locale e il default generativo protetto resta la baseline finché benchmark e
governance non giustifichino un cambiamento. Le successive preferenze per
funzione non autorizzano il chiamante a scegliere liberamente qualsiasi
provider, modello o sede di esecuzione.

L’Application Service Layer mantiene l’autorità dell’host. È la Fabric a
risolvere provider, modello e venue per capability e a restituire ricevuta e
provenienza PHI-safe. Il chiamante non impone provider, modello, venue o
fallback; il gate di uscita dalla macchina rimane chiuso per default. Gli
adapter cloud richiedono opt-in dell’host, lifecycle, policy e riferimento al
segreto. I sorgenti non includono credenziali o prove di rete live.

`AI Patient Insight`, Smart Import, Document Synthesis e Treatment Reasoning
producono soltanto proposte. L’interfaccia ne rende visibili ricevuta,
provenienza e validità del contesto; nessuna ricevuta è un grant e nessuna
preview applica dati. Ollama serve solo i percorsi generativi locali ammessi,
ATHENA/MLX soltanto Treatment Reasoning. AnyDoc resta un’estrazione
deterministica separata: il suo uso di Apple Vision sulle pagine PDF
`needsOcr` non rende nessuno dei due un provider Fabric `ocr`.

ATHENA richiede modello e runner MLX offline già presenti. Il percorso
eseguibile assoluto, controllato dall’host, è indicato in
`MEDIFLOW_ATHENA_MLX_GENERATE_BIN`: MediFlow non scarica né prepara il modello.
Il supporto del runner è nel commit `2574cf5fc`, verificato con TDD 6/6,
typecheck ed ESLint. Uno smoke sintetico sul percorso di produzione con
modello BF16 locale registrò 10,6 secondi, 64 token e 211 caratteri di output,
senza conservare il raw output. È una singola osservazione, non un benchmark,
uno SLI o una prova di qualità clinica.

Il router documentale usa `shadow` per default. In modalità `active` può
evitare il modello soltanto sulle route esplicitamente eleggibili e ad alta
confidenza; non può promuovere proposte cliniche senza review e salvataggio
espliciti.

### 5.1.1 Perimetro sorgente 0.8.5

Il [crosswalk verificabile](./capability-mapping/fabric-generative-runtime-crosswalk.v1.json)
`fabric-generative-runtime-crosswalk.v1.json` collega capability, ingresso,
production root, route, ricevuta, provenienza e UI. Il guard ne controlla il
mapping e mantiene separata la ricevuta storica `candidate_not_integrated`.

`patient_insight`, `smart_import`, `document_synthesis` e `treatment_reasoning`
hanno limite `proposal_only`. Per `ocr`, il crosswalk Fabric rimane
`unavailable`: Apple Vision è parte della composizione AnyDoc, non una
production root Fabric.

Questa registrazione descrive i sorgenti della 0.8.5, non CI remota, firma,
tag, pubblicazione, installazione o operatività su un altro host. Non esiste
un benchmark di release per latenza, throughput, qualità generativa o
accuratezza OCR; la 0.8.5 non dichiara prestazioni in questi ambiti.

### 5.1.2 Esiti di perimetro F6 e F7

I gate separano ciò che la `0.8.5` include dalle parti escluse: queste ultime
non sono funzioni consegnate né dipendenze implicite della patch.

| Gate | Implementato | Verificato nel tree locale | Residuo escluso | Esito |
| --- | --- | --- | --- | --- |
| F6 — OCR selettivo | AnyDoc first-pass e fallback Apple Vision locale sulle sole pagine PDF `needsOcr`, con ricomposizione e controllo current-source | Contratti bounded, fail-closed e percorso sintetico sul Mac eleggibile | DeepSeek-OCR 2/CUDA, benchmark di qualifica e readiness universale | Fallback locale integrato |
| F7 — provider esterni | Provider v2, secret broker, adapter HTTPS ufficiali e probe amministrativa review-only OpenAI/Anthropic | Transport fake, route admin-only e `default OFF` | Credenziali, rete live, retention account e runtime readiness remota | `INTEGRATED / DEFAULT_OFF` |

Un abbonamento o login consumer OpenAI/Anthropic non fornisce accesso alle
API. Registry, probe e adapter, da soli, non autorizzano onboarding, invio di
PHI o esecuzione remota. L’integrazione ChatGPT successiva ha un proprio
contratto e non trasforma retroattivamente queste prove con transport fake
in esecuzioni reali.

### 5.1.3 Headless, MCP e Mini nella 0.8.5

Il Supervisor Node portabile è il processo padre fidato: avvia Web standalone
e MCP come figli distinti su IPC ereditato e conserva contesto, lease, revoca
e audit. MCP `stdio` pubblica catalogo, ricerca terminologica, Open Loops del
paziente selezionato, proposta follow-up `proposal_only` e query semantica
circoscritta in sola lettura. Gli adapter non importano SQLite, non accettano
autorità fornita dal chiamante e non aprono listener.

Il titolo conserva il riferimento 0.8.5; il raccordo Mini WUL-696 è uno
sviluppo successivo. La prova storica con un client agente nominato,
autorità Web genuina e ricerca terminologica con audit su fixture non
qualifica quel client per la 0.8.6 né dimostra compatibilità con altri agenti.
Il contratto corrente è l’accesso mediato dai comandi MediFlow: attivazione
Web e parent AIP sono obbligatori, altrimenti il percorso si chiude. Le prove
non attestano tutti i percorsi clinici end-to-end, login HTTP, server Next
standalone o onboarding.

F10 espone in MCP solo la preview `pending -> completed|cancelled`. La UI
Web fidata ricontrolla la risorsa, richiede ruolo medico attivo, step-up e
gesto specifico e compie il commit con CAS, idempotenza, audit e ricevuta.
Proof e commit non sono delegabili all’agente: replay, revoca, logout o cambio
di selezione negano l’operazione.

Il planner collegato al Supervisor compone al massimo due operazioni di
lettura consentite, senza SQL libero o scritture. La shell macOS include
cattura e trascrizione italiana Apple on-device, con consenso esplicito,
audio solo in RAM entro limiti definiti e trasferimento alla bozza dopo
review. Non esegue writer clinici automatici. Smoke standalone del tree
finale, installer, onboarding ed esercizio su host esterni richiedono prove
separate dai sorgenti 0.8.5. Uscita implicita dalla macchina ed esecuzione AI
dai client paired restano chiuse.

### 5.2 Lane benchmark-only

> [!WARNING]
> Un percorso sperimentale documentato o misurato non è, per questo, una
> funzione clinica disponibile. Benchmark e modalità shadow restano strumenti
> interni finché non siano soddisfatte le condizioni di promozione.

OpenMed `redaction.v1`, HUMADEX / OpenMed NER, modelli generativi alternativi
non promossi, esperimenti MLX diversi da Treatment Reasoning e il comparator
cloud storico rimangono separati dal runtime clinico; il comparator è escluso
dal candidato `0.8.5`.

MLX non diventa un provider generico: nella 0.8.5 ATHENA/MLX è ammesso
soltanto per Treatment Reasoning. Ollama non esegue OCR e Apple Vision opera
entro AnyDoc. Ogni altro percorso MLX resta benchmark, shadow o hold secondo
la matrice di esecuzione. Gli adapter ufficiali OpenAI/Anthropic e le probe
review-only restano `default OFF`; transport fake, assenza di credenziali e
assenza di prove live non autorizzano esecuzione o egress.

La promozione richiede corpus sintetico o case pack governato, benchmark
ripetibile, stop-rules, modalità shadow quando applicabile, rollback e
fallback espliciti e aggiornamento di documentazione/ADR se cambia un limite
architetturale. La [matrice di runtime](./ai-runtime-serving-matrix.md)
distingue `runtime`, `shadow`, `benchmark_only` e `hold`: installare un
modello non significa averlo ammesso all’esecuzione.

### 5.3 Comparator cloud escluso

Il comparator cloud di engineering resta nella documentazione storica. Il
candidato `0.8.5` non ne include esecuzione, configurazione delle credenziali
o uscita in rete: non è un percorso runtime né una prova di provider
disponibile.

---

## 📚 6. Documentazione: come leggere il repository

### 6.1 Percorso consigliato per capire tutto

Questi documenti rispondono a domande diverse. Leggerli nell’ordine proposto
permette di partire dal prodotto e arrivare ai contratti senza scambiare una
sintesi o una prova storica per una nuova decisione.

1. [README.md](../README.md): ingresso prodotto.
2. [AGENTS.md](../AGENTS.md): regole operative e repository canonica.
3. [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md): quadro corrente e ricostruzione
   delle prove storiche.
4. [ARCHITECTURE.md](../ARCHITECTURE.md): principi stabili.
5. [SECURITY.md](../SECURITY.md): minacce considerate, privacy, registrazione degli eventi e oscuramento dei dati identificativi.
6. [docs/walkthrough.md](./walkthrough.md): flusso end-to-end.
7. [docs/topologia-dati-flussi.md](./topologia-dati-flussi.md): percorsi dati
   e trust boundaries.
8. [docs/repository-topology.md](./repository-topology.md): governance della
   repository e confine Git/fuori-Git.
9. [docs/README.md](./README.md): mappa canonica e fonti autorevoli per tema.
10. [docs/markdown-index.md](./markdown-index.md): inventario completo.
11. [docs/adr/README.md](./adr/README.md): decisioni architetturali.

### 6.2 Repository pubblica e artefatti locali

La repository pubblica `Wulfgardr/mediflow` ospita prodotto e installazione,
architettura e sicurezza, roadmap, FAQ, walkthrough, ADR, documenti canonici,
regole per gli agenti, workflow contributivo e script di sviluppo. È il
riferimento operativo unico per sviluppo e rilascio, non un archivio di dati
clinici.

Database reali, artefatti runtime, `medical.db`, `.sqlite`, `.sqlite3`, `.next`
e `tmp-*` restano fuori da Git, insieme a PHI/PII, credenziali, log o
schermate con dati clinici, note personali di account, billing e limiti di
spesa. Lo stesso vale per documenti riservati e fonti autenticate SISS/FSE.
La repository privata archiviata non è un’alternativa per conservarli.

---

## 🧩 7. Stato per area funzionale

### 7.1 Pazienti e cartella clinica

I sorgenti comprendono anagrafica, diario, terapie, osservazioni, allegati,
archiviazione, appuntamenti/checkup e agenda sui casi visibili. Campi
strutturati e proiezione documentale convivono con versioning e confronto
prima della scrittura nei percorsi pertinenti. Le attese web collegano
esplicitamente prestazione prevista e risultato, senza estensione paired o
scritture autonome.

La cancellazione paziente è reversibile secondo ADR 0066: DELETE scrive un
tombstone controllato dalla versione, con `deletedAt`/`deletionReason`; le
letture usano l’helper comune per i soli pazienti attivi. Ripristino admin e
purge amministrata dry-run/execute per l’erasure GDPR hanno audit dedicato
(`patient.purged`, `patient.restored`). Nessuna cancellazione fisica avviene
nel percorso ordinario: l’erasure passa solo dalla purge amministrata e
registrata.

Lo svuotamento del contenitore di test considera le membership M2M: esclude
chi appartiene anche ad ambulatori live e applica soft-delete soltanto ai
pazienti di test, con `deletionReason` specifica e audit per paziente. Il PUT
profilo con `ambulatoryId` cambia la membership primaria senza azzerare quelle
multi-ambulatorio.

Vanno conservati cifratura client-side, conflitti espliciti e audit PHI-safe;
non sono ammesse scritture remote non governate. `[LOCKED DATA]` è soltanto
un segnaposto visuale: se la decifratura fallisce, il ciphertext originale
rimane intatto e non deve mai essere sovrascritto.

### 7.2 Backup, restore e continuita

Il backup usa l’artefatto v1, con preflight prima del ripristino, scheduler
notturno macOS `launchd`, retention `keep-last-N` e controlli anti-regressione.
Le date dei backup schedulati sono stringhe ISO; il ripristino riconosce anche
il formato legacy in secondi Unix.

La riparazione del database è progettata per resistere a un arresto:
backup online better-sqlite3 con checkpoint WAL, sostituzione atomica
retire-by-rename, mutex per percorso e recupero all’avvio dei file `.old-*`
superstiti, con fallback legacy `VACUUM INTO`. Una seconda riparazione
concorrente riceve `409`.

Backup contenenti PHI non entrano nella repository. Un ripristino distruttivo
richiede sempre preflight e ogni modifica a manifest o schema richiede
l’aggiornamento della documentazione.

### 7.3 Smart Import e nuova anagrafica da documento

AnyDoc estrae localmente i formati supportati. Per i PDF, routing, manifest,
materializzazione e rendering selettivo delle pagine `needsOcr` consentono il
passaggio ad Apple Vision e la ricomposizione legata alla sorgente ancora
corrente. Su questa evidenza si possono rivedere suggerimenti, sopprimere il
rumore di una fonte che non aggiunge novità cliniche e alimentare il percorso
di nuova anagrafica con persistenza prudente delle terapie, attraverso
l’azione applicativa distinta: la proposta Fabric non autorizza il writer.

Immagini dirette, documenti cifrati, formati non supportati o motore locale
indisponibile richiedono revisione manuale; nessuna proposta nasce da testo
incompleto. Anche l’identità è estratta con prudenza: per la nascita non si
usa la prima data incontrata, le date sono costruite in UTC e il codice
fiscale è riconosciuto anche in forma omocodica. Un dato assente è preferibile
a uno attribuito senza fondamento.

Restano esclusi promozione automatica di diagnosi/terapie da testo ambiguo,
importazione silenziosa di documenti reali senza review e uso di documenti
reali come fixture Git. DeepSeek-OCR 2/CUDA, benchmark OCR e disponibilità
universale conservano lo stato `OUT_OF_SCOPE_FOR_0.8.5_NON_BLOCKING`.

### 7.4 SISS, FSE e Protesica

Il pannello paziente SISS prepara il contesto e apre i percorsi ufficiali;
il prescrittivo è `webapp-assisted`. L’utilità PRREG Apple copia localmente
il codice fiscale e apre la dashboard nel browser di sistema, senza una
nuova route paired. Il corpus SISS/FSE ha sincronizzazione e controllo della
freschezza locali; il diario protesico conserva fonti documentali e handoff
`Protesica-RL`.

Visite, esami, imaging, riabilitazione e screening hanno un dominio locale
per prescrizioni di prestazione, con item codificabili e abbinamento al
repertorio, distinto da farmaci e protesica. Nessuno di questi percorsi
attesta un canale SISS nativo certificato, sostituisce il modulo prescrittivo
regionale o genera NRE, invii regionali e writeback FSE/SISS. Scraping
aggressivo e bypass di autenticazioni o vincoli regionali restano esclusi.

### 7.5 Apple/native e tri-OS

Il catalogo AIFA si importa da CSV locale nella web UI, conservando manifest,
hash SHA-256 e indici SQLite. La ricerca server-side è limitata e per prefisso
su nome, principio attivo e AIC; gli autocomplete web e Apple usano lo stesso
catalogo senza scaricarlo integralmente nel browser o nel client paired.

La shell macOS, il workspace paziente, il pannello runtime e lo store locale
verificabile costituiscono il fronte nativo più maturo. ADR 0078 è `Accepted`:
le prime superfici Lume web e la card clinica opaca nativa sono consegnate,
mentre componenti interni e verifica manuale completa restano aperti.
`MediFlowCore` è condiviso e testato su macOS, Linux e Windows; `/api/v1`,
proxy TLS e runbook di sviluppo sostengono i client, senza attestare la
pubblicazione di app complete. iPhone/iPad restano client paired non-AI con
cache cifrata degradabile e primi flussi online versionati sui moduli core.

La fotografia post-Wave 5 conserva **66 capability: 30 full, 13 partial,
23 host-only e 0 missing-both**. Tra le 43 per cui la parità è un obiettivo,
30 sono full, pari al 70%. PR #21 e `WUL-401`, completata, hanno consegnato
bundle, fixture, probe AX e runbook P6 di base. Prerequisiti operativi e
verbale manuale sul Mac sbloccato restano in `WUL-481`; offline degradato
onesto in `WUL-403`. Smart Import e invocazione AI paired restano host-only
per ADR 0076. Il riferimento è la [matrice di parità](./parity-matrix.md).

Le direzioni successive comprendono app Windows/Linux complete oltre i
launcher sorgente, chiusura dei residui `WUL-481`/`WUL-403`, decisione separata
sui quattro residui documentali e cache cifrata derivata con riconciliazione
esplicita. Non sono ammessi accesso mobile diretto a SQLite,
sincronizzazione cloud, scritture remote generiche o piano AI remoto dentro
il piano dei dati clinici.

### 7.6 Impostazioni e superficie di sistema

Le impostazioni sono organizzate in sidebar: Generale per profilo, aspetto e
ambulatori; Sicurezza e Dati per accesso, backup e repertori; Intelligenza
Artificiale per modelli e funzioni; Avanzate per diagnostica, sviluppo e zona
pericolo. `/settings` apre la sintesi `Stato sistema` e conserva i redirect
dalle vecchie ancore. Privacy Mode è persistente nell’header e CMD+K permette
la ricerca rapida delle impostazioni.

L’import AIFA rende visibili fonte, URL, data di scarico, versione e stato di
provenienza; nessun dataset AIFA è incluso nella repository. Restore e reset
richiedono la parola di conferma digitata (`RIPRISTINA` / `RESET`) nelle
superfici di avvertimento. La riorganizzazione non attenua queste conferme e
non introduce nuovi percorsi remoti o cloud.

---

## ⚙️ 8. Regole di manutenzione

Una funzione che cambia richiede l’aggiornamento del proprio documento
canonico e, se cambia il percorso reale, del [walkthrough](./walkthrough.md).
Modifiche a trust boundary, API o dati riguardano anche la
[topologia dei flussi](./topologia-dati-flussi.md); modifiche alla precedenza
delle fonti vanno nell’[indice canonico](./README.md). Aggiunte, rimozioni o
rinomine Markdown richiedono l’aggiornamento dell’[inventario](./markdown-index.md).
Issue e roadmap pubbliche devono riflettere i cambi di priorità operativa.

Un nuovo limite architetturale, o la modifica di uno esistente, richiede ADR
prima del codice, verifica di [SECURITY.md](../SECURITY.md), controllo
OpenAPI se riguarda `/api/v1` e dichiarazione esplicita delle esclusioni.
Non basta aggiornare la descrizione della funzione dopo averla implementata.

Se cambia la topologia della repository, vanno aggiornati
[AGENTS.md](../AGENTS.md) e la [guida dedicata](./repository-topology.md).
Remote, branch, PR, tag e release devono riferirsi alla repository pubblica
canonica; database, artefatti runtime, credenziali e materiali riservati
restano fuori da Git.

---

## 🧪 9. Check rapidi

### 9.1 Verifica docs-only

Per una modifica solo documentale, i controlli di base sono:

```bash
git diff --check
rg --files -g '*.md' | sort
```


Se cambiano esempi di comandi, contratti o script, occorre eseguire anche il
comando citato oppure dichiarare perché non sia stato eseguito.

### 9.2 Verifica runtime generale

Per modifiche applicative non banali:

```bash
npm run lint
npm run typecheck
npm run build
npm run check:never-regress
```


I controlli specifici restano legati alla superficie modificata:

- `/api/v1`: `npm run check:openapi:drift`
- pazienti/versioning: `npm run test:concurrency:patients`
- home-base network: `npm run test:network:home-base-readonly`, `npm run test:network:home-base-write`, `npm run test:network:home-base-diary-write`, `npm run test:network:home-base-therapy-write`, `npm run test:network:home-base-checkup-write`, `npm run test:network:home-base-observation-write`
- document intelligence: `npm run test:document-synthesis`, `npm run
  test:ai-context`, `npm run test:pdf-service`
- nuova anagrafica da documento: `npm run test:patient-document-import`

---

## ⚠️ 10. Stop rules

Prima di introdurre un canale cloud, una superficie remota di scrittura o un
cambiamento a cifratura, PIN o master key, fermarsi e scrivere un ADR o una
nota ADR-style. Lo stesso vale per promuovere nel runtime clinico un percorso
AI di solo benchmark, superare `webapp-assisted` in SISS/FSE o accedere a
SQLite da mobile. Aggiungere uno schema persistente di document intelligence
o rimuovere presidi zero-knowledge, audit o no-egress richiede lo stesso
passaggio preventivo.

Il lavoro va fermato e suddiviso in filoni distinti quando il diff superi un
solo tema, una pagina pubblica richieda materiali privati per essere capita,
una modifica trascini dati o artefatti che devono restare fuori da Git oppure
il worktree contenga cambi non correlati.

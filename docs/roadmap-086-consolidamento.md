---
summary: "Roadmap 0.8.6: runtime locale/headless sul Mac, localhost, configurazione intelligente e prove distinte."
read_when:
  - "Pianificando il consolidamento 0.8.6 o valutando i residui dei branch hold."
  - "Proponendo alternative visive per impostazioni e scheda paziente localhost."
---

# MediFlow 0.8.6 — consolidamento funzionale e interfaccia

Aggiornamento: 20 settembre 2026. Stato: **release sorgente 0.8.6 pubblicata; programma complessivo e decisione sul deployment clinico ancora distinti dalla consegna sorgente**. Questa pagina conserva la preparazione del candidato, non un'attestazione di chiusura dell'intero programma. La [verifica notturna](./analysis/2026-09-07-086-release-verification.md#verifica-notturna-dell8-settembre-programma-ancora-aperto) registra esiti, SHA, piattaforme e residui della fase nella quale nessuna delle 28 issue era dichiarata Done e la Definition of Done complessiva non era raggiunta. Il [piano operativo corrente](./analysis/2026-09-07-086-guided-configuration-plan.md) prevale sulle dichiarazioni di completezza riferite alla sola base funzionale congelata. La preparazione conserva la [baseline WUL-670](./analysis/2026-09-05-mediflow-086-baseline.md) su `main` `b72ac713b`; nella fase di preparazione era usata `6a5463e8d`. La [roadmap generale](./ROADMAP.md) rimane il riferimento di prodotto.

Il riallineamento serale estende il quadro alle issue WUL-669–696 e alla revisione di documenti, scale e gerarchia della cartella. Il [piano corrente](./analysis/2026-09-07-086-guided-configuration-plan.md#riallineamento-serale-requisiti-e-consegna) ne registra risultati aggiunti, contratti e Definition of Done comune: modificare uno stato in Linear non equivale a completare una funzione, una prova installata o la release.

Il [verbale corrente](./analysis/2026-09-06-086-integrated-closeout.md) riguarda l'integrazione della base funzionale, delle composizioni UI B/A, di Search WHO locale e della cartella Apple. Le sezioni seguenti conservano i requisiti e le osservazioni preparatorie, senza dichiarare chiuse le issue. Le scelte B/A e sidecar locale sono recepite; provisioning WHO, revisione regolatoria e distribuzione devono restare verifiche distinte.

Il perimetro della 0.8.6 riguarda runtime locale/headless sul Mac e interfaccia browser localhost. Verifica UI iPhone–Mac/Home Base e client nativo sono sviluppi successivi separati, non gate della release sorgente; l'ammissione al deployment clinico rimane una decisione competente in WUL-688, con coordinamento WUL-669. Per l'accettazione prevalgono il contratto Linear aggiornato e le prove Web/AI richieste sul candidato pertinente, non gli stati preparatori conservati sotto.

## Risultato atteso

Il consolidamento parte da un'esigenza operativa: le funzioni già promesse devono funzionare in modo affidabile e rendere comprensibile il proprio uso. Le priorità indicate dall'utente sono fallback OCR effettivo, accesso a ICD-11 WHO, impostazioni essenziali ma informative, scheda paziente proporzionata e un miglioramento estetico concreto. La prima superficie è **localhost**; l'estensione Apple di navigazione della cartella, bozze e documenti su iPhone, iPad e Mac, guidata dai riferimenti illustrati richiesti, appartiene invece a un seguito separato e non all'accettazione 0.8.6.

Questo obiettivo non richiede di integrare tutti i branch rimasti: si recuperano soltanto i contributi che risolvano un problema ancora presente e superino le verifiche sulla nuova base. Nel confronto fra proposte Lume può essere accantonato, ma sostituirlo nel prodotto richiede una decisione visiva e il conseguente allineamento di `DESIGN.md`.

## Template per ogni intervento

| Campo | Contenuto richiesto |
| --- | --- |
| Problema | Che cosa impedisce o rende difficile il lavoro dell'utente |
| Stato ed evidenza | Segnalazione, codice osservato, prova runtime oppure dato non verificato |
| Risultato | Comportamento concreto che deve ottenere l'utente |
| Intervento | Cambiamento minimo e materiale locale da recuperare |
| Accettazione | Scenari ripetibili e risultato atteso |
| Dipendenze / decisioni | Contratti, scelta prodotto, credenziali o piattaforme necessarie |
| Consegna | Owner, issue reale, nuovo branch/worktree, SHA, verifiche ed esito |

L'elenco seguente identifica le issue del programma; l'assegnazione degli owner esecutivi rimane da completare nel quadro preparatorio. Gli identificativi storici dei branch servono invece a individuare le fonti da esaminare.

## 1. OCR e composizione dello stack intelligente — essenziale

**Problema.** Un'indicazione generica di inattività non consente di distinguere una configurazione mancante da un errore o da un percorso escluso. Il fallback OCR deve invece portare a un risultato effettivo sui documenti supportati, rendendo comprensibile ogni impedimento.

**Stato osservato nella preparazione.** AnyDoc estrae testo in modo deterministico, ma non esegue OCR. `lib/domain/documents/anydoc-current-source-composition.ts` contiene la continuazione Apple Vision e lo stato del sistema descrive OCR selettivo locale, mentre la capacità Fabric `ocr` risulta `unavailable`. Le formulazioni precedenti di ADR 0107/0111 non sono compatibili fra loro e richiedono una precedenza esplicita. In questa preparazione non è stata eseguita una prova OCR live.

**Risultato.** Il documento testuale passa da AnyDoc; una scansione supportata raggiunge il motore OCR locale previsto. Chi lo usa deve vedere avanzamento, risultato, limite o azione di recupero. Anche l'organizzazione delle capacità deve partire dal lavoro consentito: leggere documenti, sintetizzare, importare e consultare terminologie.

**Intervento.** Verificare anzitutto l'intero percorso AnyDoc → riconoscimento delle pagine → Apple Vision → ricomposizione → revisione. Su questa base vanno corretti i guasti riprodotti, definiti i comportamenti per immagini singole e PDF misti ed esplicitate le piattaforme supportate. Un secondo motore locale va valutato solo per un requisito rimasto scoperto, mantenendo AnyDoc come primo passaggio. Per ogni funzione Fabric occorre censire configurazione, provider, disponibilità osservata, ultimo tentativo e motivo di blocco: non si attivano capacità non qualificate soltanto per rendere verdi gli indicatori.

**Accettazione.** Usare fixture sintetiche italiane per PDF testuale, scansione, PDF misto con scansione nell'ultima pagina, immagine singola con esito dichiarato e file protetto o corrotto. Verificare ordine delle pagine, testo atteso e provenienza, oltre a motore assente, errore, timeout e nuovo tentativo. Testo vuoto o risultato riferito a un allegato sostituito non possono costituire successo. Sul Mac supportato, il fallback deve completare una scansione end-to-end dalla UI: dichiararne l'indisponibilità non soddisfa il requisito. Sugli altri sistemi occorre una decisione esplicita di supporto prima di promettere equivalenza.

**Dipendenze.** Occorrono il riallineamento del contratto OCR e la scelta di fixture e profilo hardware; i risultati devono comunque essere rivisti prima dell'uso clinico.

## 2. ICD-11 WHO accessibile e verificabile — essenziale

**Problema.** Ricerca e cross-check terminologico devono essere utilizzabili senza che il servizio locale di supporto, chiamato “sidecar”, imponga una configurazione opaca.

**Stato registrato nella preparazione.** [Setup WHO](./icd-who-setup.md) e ADR 0115 descrivono Search attraverso un sidecar locale spento per default, con endpoint loopback fisso e provenienza degli artifact. Il vecchio container su porta 8888 è ritirato. Questa fase non aveva provisionato né verificato un catalogo WHO locale: digest, snapshot, licenza e prove di riavvio/ripristino erano ancora da registrare.

**Risultato.** Dalle Impostazioni l'utente deve capire che cosa manchi, completare il setup e verificare una ricerca. Dalla scheda deve ottenere codice, descrizione, release e lingua, così da poter confermare la codifica.

**Intervento.** La proposta iniziale prevedeva di rendere utilizzabile l'adapter esistente con setup guidato e verifica esplicita della connessione. Il cross-check va inteso come confronto di codice e descrizione con la fonte WHO, non come validazione della diagnosi; occorre verificare anche la copertura del lookup puntuale. Il confronto fra API online e deployment locale deve riguardare requisiti concreti di offline, manutenzione e distribuzione. Il 6 settembre l'utente ha scelto il **sidecar locale**, superando la proposta online: servono quindi aggiornamento dell'ADR e implementazione del servizio, non la riattivazione di un interruttore.

**Accettazione.** Eseguire il setup da installazione pulita e provare ricerca sintetica riuscita, codice noto, query senza risultati, credenziali assenti o non valide, rete assente, timeout e recupero. Mostrare la data dell'ultima verifica e distinguere configurazione, risposta live e cache. Le credenziali restano solo sul server; i test non usano dati paziente e non è ammessa alcuna assegnazione diagnostica automatica. Release e lingua devono essere esplicite: il binding documentato è `2026-01`, MMS, inglese.

**Dipendenze.** Risolta la scelta del sidecar, nella preparazione restano contratto, provisioning locale e prova finale. La [documentazione WHO](https://icd.who.int/docs/icd-api/), consultata il 5 settembre, è il riferimento upstream da verificare rispetto al binding scelto.

## 3. Impostazioni semplici, navigabili e utili — essenziale

**Problema.** Quando le informazioni tecniche hanno lo stesso peso delle azioni necessarie, diventa difficile capire se l'accesso e le funzioni dell'Intelligence Fabric siano utilizzabili.

**Stato osservato.** Sidebar, sotto-route e ricerca sono già presenti nelle impostazioni in `app/settings/layout.tsx`. Poiché il problema riguarda gerarchia, contenuto e utilità, un'ulteriore sidebar non lo risolverebbe.

**Risultato e intervento.** La proposta raccoglie il lavoro in cinque aree principali:

| Area | Contenuto visibile subito |
| --- | --- |
| Panoramica | Funzioni operative, problemi attuali, azione consigliata |
| Accesso e sicurezza | Sessione, PIN/blocco, dispositivi e verifiche pertinenti |
| Documenti e intelligenza | OCR, importazione, sintesi e relativo servizio |
| Cataloghi e collegamenti | ICD-11 WHO, repertori e collegamenti disponibili |
| Preferenze e dati | Aspetto, ambulatori, backup e manutenzione ordinaria |

La ricerca deve restare sempre disponibile; la diagnostica tecnica va nei “Dettagli avanzati” delle aree pertinenti e le funzioni distruttive devono essere separate. Ogni funzione presenta **a cosa serve · stato · cosa fare**, con timestamp della verifica raggiungibile accanto allo stato e provider, log e identificativi negli approfondimenti. “OCR: da configurare. Serve per leggere le scansioni. Configura il servizio” è un esempio del testo proposto, non uno stato osservato nella preparazione.

**Accettazione.** Da Impostazioni, OCR, WHO e stato dell'accesso devono essere raggiungibili ciascuno entro due passaggi, e il problema deve essere comprensibile senza aprire la diagnostica tecnica. Provare caricamento, errore, assenza di configurazione e successo; il controllo di connessione deve aggiornare lo stato dalla risposta reale. Accesso, blocco, sblocco e logout richiedono un account sintetico, senza interrompere la sessione reale. Ricerca, tastiera e ritorno alla pagina devono funzionare, e ogni voce esistente deve trovare una destinazione nella nuova mappa.

**Dipendenze.** Servono l'inventario delle impostazioni e un vocabolario di stato condiviso con OCR/WHO/Fabric. Rendere il testo più semplice non autorizza a eliminare controlli necessari.

## 4. Scheda paziente, sizing e direzione visiva — essenziale

**Problema segnalato.** L'utente descrive una composizione “a T”, nella quale l'intestazione larga con menu a tendina sovrasta una scheda centrale ristretta, mentre terapie, SISS e altre sezioni risultano poco armoniche. È una segnalazione, non una misura tratta da screenshot acquisiti nella preparazione.

**Risultato.** La finestra deve offrire uno spazio di lavoro proporzionato, nel quale identità del paziente e navigazione rimangano riconoscibili senza far prevalere il contenitore su dati e azioni.

**Intervento proposto.** Usare una sola griglia per intestazione e contenuto: testata compatta con identità e azioni, indice delle sezioni a sinistra, contenuto flessibile e approfondimenti in un pannello laterale aperto su richiesta. Terapie, diario, documenti e collegamenti devono essere destinazioni esplicite, senza una seconda barra di menu a tendina per la navigazione principale. Nelle finestre strette l'indice collassa, ma paziente e sezione attiva restano visibili. La larghezza adatta a leggere un testo va distinta dallo spazio necessario a tabelle e moduli.

**Accettazione.** Confrontare le proposte con contenuti sintetici identici: pazienti con pochi o molti dati, nomi lunghi, numerose terapie, errori e sezioni vuote. Provare almeno 1280×800, 1440×900, 1920×1080 e 768×1024, zoom 200%, tastiera e focus. Non sono ammesse azioni tagliate o scorrimento orizzontale dell'intera pagina; apertura di una sezione e ritorno devono conservare il contesto, senza perdere dati durante navigazione o modifica. Impostazioni e paziente richiedono approvazione visiva congiunta prima di estendere il redesign al runtime.

Il 6 settembre il prototipo navigabile è stato scelto nella composizione **B con barra superiore predefinita, A con barra laterale selezionabile nelle Impostazioni**. Queste lettere identificano le due composizioni runtime, non le tre direzioni estetiche iniziali riportate sotto. Nella preparazione rimaneva aperta la rifinitura delle Impostazioni.

### Tre direzioni da confrontare

I riferimenti seguenti provengono dal catalogo Personal Aesthetic Studio e sono stati consultati il 5 settembre 2026 per costruire candidati, non per documentare design già approvati. Le schede Refero descrivono siti e stili, senza provare l'usabilità dei prodotti autenticati; la verifica visuale di schermate sorgente e mockup rimaneva parte del confronto da svolgere.

| Candidato | Riferimenti | Traduzione proposta in MediFlow | Rischio da verificare |
| --- | --- | --- | --- |
| A — Precisione operativa | [Linear via Refero](https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1), [ReUI](https://reui.io/components) | Superfici chiare, bordi sottili, indice stabile, righe informative compatte; enfasi limitata | Densità eccessiva o testo troppo piccolo |
| B — Chiarezza essenziale | [Apple via Refero](https://styles.refero.design/style/aecac5da-f397-4ddf-b71f-de1efc434cb8), [coss UI](https://coss.com/ui) | Poche gerarchie, controlli riconoscibili, spaziatura regolare; pannelli progressivi | Troppo spazio vuoto rispetto al lavoro clinico |
| C — Studio operativo | Template `workspace.html` e registro sage operational di Personal Aesthetic Studio | Base carta/salvia, sans sobria, griglia rigorosa e dettagli progressivi | Colore/materiale che distrae o riduce il contrasto |

**Proposta iniziale:** partire da A con la leggibilità di B, confrontandola con C e con il prodotto esistente sugli stessi contenuti. Da Personal Aesthetic Studio si conservano gerarchia, densità progressiva e sobrietà, mentre A/B sperimentano una base neutra al posto della carta calda. È un'eccezione candidata, non una modifica della costituzione personale: un principio di composizione può essere ripreso senza adottare un'intera libreria né copiare un sito.

## 5. Onboarding assistito e tailoring — essenziale

Il percorso assistito può iniziare da due o tre domande sull'attività e sul modo di lavorare, purché spieghi che cosa configuri e permetta di cambiare scelta. La professione dichiarata non verifica l'identità e non concede privilegi. Anche il percorso manuale deve portare a un'app utile, con provider spenti per default.

Gli agenti operano esclusivamente attraverso il layer MediFlow mediato e i suoi comandi nominati: capacità autorizzate, autenticazione, verifica della validità delle informazioni, conferma delle scritture cliniche, audit e ricevute restano condizioni del percorso. Non ricevono accesso diretto a SQLite e non si presume che qualsiasi agente sia compatibile. Le funzioni AI sono facoltative e producono soltanto proposte da rivedere; Codex o un account AI non sono prerequisiti.

L'accettazione richiede raccomandazioni comprensibili e modificabili, anteprima e conferma delle azioni, configurazione idempotente, ripresa dopo interruzione, cambio di profilo e rollback. Non sono ammessi invii di dati all'esterno o privilegi impliciti, né dati clinici nelle domande. La design arena deve includere anche questi flussi.

## 6. Deslop globale del codice — essenziale

Il censimento deve coprire il codice first-party di web, librerie, packages, native, tooling e test, cercando duplicazioni, percorsi morti, astrazioni inutili e incoerenze fra nomi, testi e documentazione. Non tutta la complessità è eliminabile: generated, vendor, dati locali e archivi probatori restano esclusi dalla pulizia meccanica.

Ogni rilievo deve collegare evidenza, impatto, proposta, rischio e verifica prevista, con classificazione REMOVE/SIMPLIFY/CONSOLIDATE/KEEP/DEFER. Le modifiche procedono per tranche tematiche reversibili, coordinate con le lane funzionali, senza quote di righe da cancellare e preservando controlli, migrazioni, compatibilità e test significativi.

L'accettazione richiede un inventario che dichiari copertura e limiti, ma anche tranche utili effettivamente completate, comportamenti preservati e regressioni verificate. Benefici concreti e debito residuo devono essere espliciti: il solo censimento non equivale alla consegna del deslop.

## 7. GDPR e AI Act — essenziale

L'obiettivo è soddisfare integralmente gli obblighi applicabili al perimetro d'uso, ai ruoli e alla versione dichiarati. Località del codice, supervisione umana e checklist automatica non costituiscono, da sole, una certificazione di conformità.

Preparare una matrice obbligo → fonte/versione/data di applicabilità → ruolo → controllo → evidenza → gap. Occorre distinguere gli obblighi del prodotto dalle responsabilità organizzative e i documenti adottati dai semplici template. L'esame comprende finalità, dati sanitari, diritti, retention, sicurezza, fornitori e trasferimenti, con DPIA quando richiesta; per l'AI, classificazione, literacy, trasparenza e ulteriori obblighi condizionati al sistema e al ruolo. Se l'intended purpose fa emergere un possibile confine da dispositivo medico, valutarlo separatamente.

I riferimenti ufficiali consultati il 5 settembre 2026 sono [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng), [AI Act](https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng) e [Commissione europea](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai). Durante il lavoro devono essere riletti i testi consolidati, gli aggiornamenti e il calendario vigente.

L'accettazione richiede interventi e prove per i requisiti applicabili, un dossier riferito al candidato esatto e una revisione competente identificata e registrata. Il gate rimane aperto quando manchi una decisione giuridico-regolatoria o un adempimento applicabile: non si presumono firme, nomine, certificazioni o esenzioni.

## Filone operativo su Linear

Il [Progetto 0.8.6](https://linear.app/wulfgardr/project/mediflow-086-consolidamento-funzionale-e-interfaccia-cb068ec8f3d4) e il [Contratto operativo](https://linear.app/wulfgardr/document/mediflow-086-contratto-operativo-issue-e-definition-of-done-533669b0b37b) sono stati articolati inizialmente in 20 ticket, coordinamento e 19 attività, con sei milestone e dipendenze esplicite. Linear governa il piano, mentre ADR e contratti del repository governano l'implementazione. In assenza di template Linear disponibili, ogni issue è stata strutturata con outcome, scope/contratti, DoD, limiti e fonti.

| Issue | Risultato |
| --- | --- |
| WUL-669 | Coordinamento del programma |
| WUL-670 | Baseline e recupero selettivo dei branch |
| WUL-671 | OCR e fallback locale end-to-end |
| WUL-672 | Decisione API WHO / sidecar e cross-check |
| WUL-673 | Setup e uso effettivo ICD-11 |
| WUL-674 | Stato attendibile delle capacità intelligenti |
| WUL-675 | Accesso, PIN, blocco e logout verificabili |
| WUL-676 | Design arena: impostazioni, paziente e onboarding |
| WUL-677 | Confronto utente e contratto UI scelto |
| WUL-678 | Impostazioni semplici e azionabili |
| WUL-679 | Scheda paziente, sizing e navigazione |
| WUL-680 | Verifica integrata e handover finale |
| WUL-681 | Decisione onboarding, triage di configurazione e profili |
| WUL-682 | Onboarding assistito implementato e reversibile |
| WUL-683 | Censimento globale del debito e piano deslop |
| WUL-684 | Deslop applicato e verificato |
| WUL-685 | Applicabilità GDPR/AI Act e matrice obblighi |
| WUL-686 | GDPR: controlli e documentazione |
| WUL-687 | AI Act: obblighi pertinenti e prove |
| WUL-688 | Dossier conformità e decisione competente |

Astra sceglie soluzioni, componenti, ordine dei sottopassi e suddivisione tecnica motivata. Le dipendenze condizionano il completamento, senza vietare la preparazione di lavoro indipendente; scelta estetica, nuovi costi o invii all'esterno e cambi sostanziali di perimetro richiedono invece la decisione pertinente. Le issue 0.8.5/1.0 sono preservate.

## Recupero selettivo dei branch locali

La selezione parte dal task `01a07256-8274-7263-813b-cdd0b099952e`, dal resoconto `REPORT.md` e dall'elenco `pending.md` della ricognizione del 5 settembre. Gli originali restano nel registro locale `.codex/state/mediflow-branch-closeout/2026-09-05`, esterno al repository. Quella fotografia usava `5cbbf777e`, precedente alla base della preparazione: 74 hold, 58 confronti conflittuali e 16 delta senza conflitti sono quindi dati storici, non l'esito di un nuovo audit sulla base corrente.

La preparazione ha riletto sette head pertinenti e confrontato i percorsi modificati con `main 6a5463e8d`, senza integrarli. Il prefisso comune è `codex/hold/`.

| Branch / SHA osservato | Destinazione 0.8.6 | Esito preparatorio |
| --- | --- | --- |
| `WUL-522-attachment-extraction-currentness-owner-harden-v1` / `1a60f3e41` | OCR, coerenza del risultato con l'allegato | Due file differiscono: candidato prioritario a revisione mirata, non fix qualificato |
| `WUL-522-local-ocr-apple-vision-execution` / `3d7dcf457` | OCR locale | 12 file differiscono; adapter storico Fabric da confrontare con composizione AnyDoc attuale |
| `WUL-522-fabric-provider-disclosure-v1` / `e90a9fe88` | Stato servizi e impostazioni | Nove file differiscono; il diff riporta una disclosure più statica rispetto al lifecycle corrente: recuperare intenti e prove, non sostituire il modello attuale |
| `WUL-559-web-states-lume` / `784423913` | Stati UI e accessibilità | Dei 16 percorsi cambiati nel branch, quattro coincidono già con main; riesaminare solo i residui pertinenti |
| `WUL-560b-command-center` / `131ea8f1a` | Ricerca e navigazione | Tre percorsi su dieci coincidono; il vecchio componente perderebbe voci e gestione successive: nessun trapianto integrale |
| `WUL-561-web-lume-mockup` / `697fdfbe6` | Scheda e confronto visivo | 40 percorsi differenti; materiale di studio, non base runtime da ripristinare |
| `WUL-565-macos-inspector-strumento-carta` / `c08d5c9e3` | Ispirazione per pannello contestuale | Otto percorsi differenti; proposta nativa separata, non dipendenza del redesign localhost |

**Altre famiglie del portafoglio.** Sessione, sintesi e verifica della validità del contesto entrano nel recupero solo quando risolvano un difetto riprodotto nei percorsi della release. Patient Insight e Treatment Reasoning richiedono la verifica delle capacità esistenti, non l'integrazione di ogni vecchio binding; harness e release hygiene possono sostenerne le prove. Governance conserva le informazioni necessarie, rendendole leggibili nella UI. XPC, ampliamento dei provider cloud, nuove capacità headless e parità Apple estesa restano fuori dal nucleo 0.8.6 salvo nuova decisione.

Secondo la ricognizione, WHO #322/#340 è già stato ricomposto in main: l'attività successiva deve renderlo utilizzabile e provarlo. Per tastiera e stati occorre consultare anche WUL-560/c/d e l'inventario WUL-562, evitando di duplicare verifiche. Gli altri rami sono soltanto mappati dal registro, non sottoposti ad audit funzionale.

Prima di recuperare un contributo, riprodurre il bisogno sulla base corrente, isolare la differenza utile, riallinearla al contratto e verificarla in un nuovo worktree dedicato. Worktree con modifiche locali e task attivi devono essere preservati: la recuperabilità di un branch, un merge senza conflitti o test storici non equivalgono a una consegna.

## Sequenza e completamento

1. **Inventario operativo e contratti:** costruire la mappa funzione → servizio → stato → azione, riprodurre i guasti con dati sintetici, decidere OCR/WHO e selezionare i residui utili.
2. **Confronto UX:** confrontare tre candidati per impostazioni e paziente su contenuti equivalenti, scegliendo struttura e stile. Il lavoro può procedere insieme alla verifica OCR.
3. **Consolidamento funzionale:** verificare OCR e WHO end-to-end, recuperare in modo mirato le verifiche sulla validità del contesto e la gestione della sessione e rendere attendibile lo stato dei servizi.
4. **Implementazione UI:** realizzare la nuova mappa di impostazioni e scheda secondo la direzione scelta, conservando contratti e comportamenti corretti del prodotto.
5. **Onboarding e deslop:** realizzare il percorso assistito reversibile su localhost, completare il censimento globale e applicare semplificazioni utili. La matrice nativa rimane un seguito separato.
6. **GDPR/AI Act:** avviare l'esame di applicabilità e requisiti dopo la baseline; interventi e dossier devono recepire le versioni finali di onboarding, UI, runtime e deslop.
7. **Verifica 0.8.6:** esercitare scenari Web/AI, accessibilità e regressioni dei flussi toccati su runtime locale/headless e localhost, con prove sull'installazione target Mac e limiti documentati. Eventuali commit, PR, CI remota, tag e release restano passaggi separati che richiedono la relativa autorità.

Il criterio preparatorio di consegna della 0.8.6 richiede che i sette filoni essenziali soddisfino le rispettive accettazioni. Per OCR supportato e WHO, i soli test simulati non permettono di dichiarare il funzionamento reale: una decisione aperta su quel funzionamento blocca l'affermazione. La pianificazione non può promettere una data prima di conoscere guasti, scelta visiva e recuperi utili.

## Evidenza di questa preparazione

La preparazione ha esaminato contratti, setup, roadmap, skill e catalogo estetico, insieme al task e agli artefatti della ricognizione. Sono stati ispezionati i sorgenti pertinenti e sette head locali, approfondendo due diff UI. Non sono stati avviati server, OCR, WHO o test applicativi, né osservata l'interfaccia autenticata o eseguito un benchmark clinico. L'evidenza riguarda dunque piano e selezione preliminare, non la qualificazione delle funzionalità o dei branch.
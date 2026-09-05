---
summary: "Mini roadmap preparatoria 0.8.6: OCR, ICD-11, impostazioni, scheda paziente e recupero selettivo dei branch locali."
read_when:
  - "Pianificando il consolidamento 0.8.6 o valutando i residui dei branch hold."
  - "Proponendo alternative visive per impostazioni e scheda paziente localhost."
---

# MediFlow 0.8.6 — consolidamento funzionale e interfaccia

Data: 5 settembre 2026. Stato: **sviluppo locale avviato**, con
[baseline WUL-670](./analysis/2026-09-05-mediflow-086-baseline.md) su `main`
`b72ac713b`; la preparazione usava `6a5463e8d`. Nessuna release 0.8.6 consegnata.
La [roadmap generale](./ROADMAP.md) resta la fonte prodotto;
questo documento ne dettaglia il candidato 0.8.6.

## Risultato atteso

Rendere affidabili le funzioni già promesse e semplice capire come usarle.
Le priorità indicate dall'utente sono OCR con fallback funzionante, ICD-11 WHO
accessibile, impostazioni essenziali e informative, scheda paziente proporzionata
e un miglioramento estetico concreto. La prima superficie è **localhost**.
La compatibilità Apple va preservata; una riscrittura completa dei client non
è implicita in questo aggiornamento.

La release non coincide con l'integrazione di tutti i branch rimasti. Recuperiamo
soltanto contributi che risolvono un problema attuale e superano le verifiche
sulla nuova base. Lume può essere accantonato nel confronto delle proposte;
la sua sostituzione nel prodotto richiede una scelta visiva e l'allineamento
successivo di `DESIGN.md`.

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

Le issue del programma sono elencate sotto; gli owner esecutivi sono da assegnare.
Gli identificativi storici nei riferimenti branch individuano fonti da esaminare.

## 1. OCR e composizione dello stack intelligente — essenziale

**Problema.** Le capacità visibili come inattive non permettono di capire se
manca una configurazione, se c'è un errore o se il percorso è escluso. Il fallback
OCR deve produrre un risultato effettivo sui documenti supportati.

**Stato osservato.** AnyDoc è estrazione deterministica, non OCR. Nel codice
`lib/domain/documents/anydoc-current-source-composition.ts` è presente la
continuazione Apple Vision; lo stato del sistema descrive OCR selettivo locale,
mentre la capacità Fabric `ocr` resta `unavailable`. Esistono anche formulazioni
precedenti incompatibili negli ADR 0107/0111: occorre fissarne esplicitamente la
precedenza. Nessuna prova OCR live è stata eseguita in questa preparazione.

**Risultato.** Un documento con testo usa AnyDoc; una scansione supportata passa
al motore OCR locale previsto. L'utente vede avanzamento, risultato, limite o
azione di recupero. Le capacità sono organizzate per ciò che consentono di fare:
leggere documenti, sintetizzare, importare, consultare terminologie.

**Intervento.** Verificare prima il percorso AnyDoc → riconoscimento delle pagine
→ Apple Vision → ricomposizione → revisione. Correggere i guasti dimostrati,
definire il comportamento per immagini singole e PDF misti, e rendere esplicita
la matrice delle piattaforme supportate. Valutare un secondo motore locale solo
se serve a coprire un requisito scoperto; AnyDoc resta il primo passaggio.
Per ogni funzione Fabric censire configurazione, provider, disponibilità
osservata, ultimo tentativo e motivo dell'eventuale blocco. Non attivare capacità
non qualificate soltanto per ottenere indicatori verdi.

**Accettazione.** Fixture sintetiche italiane: PDF testuale, scansione, PDF misto
con scansione nell'ultima pagina, immagine singola con esito dichiarato, file
protetto o corrotto. Controllare ordine delle pagine, testo atteso e provenienza;
provare motore assente, errore, timeout e nuovo tentativo. Nessun successo con
testo vuoto o risultato riferito a un allegato sostituito. Sul Mac supportato
il fallback deve completare una scansione end-to-end dalla UI; un messaggio di
indisponibilità, da solo, non soddisfa questo requisito. Per gli altri sistemi
serve una decisione esplicita di supporto prima di promettere equivalenza.

**Dipendenze.** Riallineamento del contratto OCR; selezione delle fixture e del
profilo hardware. I risultati restano da rivedere prima dell'uso clinico.

## 2. ICD-11 WHO accessibile e verificabile — essenziale

**Problema.** La ricerca e il cross-check terminologico devono essere utilizzabili
senza una configurazione opaca del servizio indicato come “sidecar”.

**Stato osservato.** [Setup WHO](./icd-who-setup.md) e ADR 0115 descrivono un
Application Service server-side verso WHO, con credenziali OAuth e rete abilitate
esplicitamente. Il vecchio container su porta 8888 è ritirato dal percorso
applicativo. Il resoconto branch conferma che issuer WHO e retirement hanno già
corrispondenti in main. Non è stato verificato un account WHO live.

**Risultato.** Da Impostazioni l'utente comprende cosa manca, completa il setup
e verifica una ricerca; dalla scheda ottiene risultati con codice, descrizione,
release e lingua, utili alla conferma della codifica.

**Intervento.** Proposta iniziale: rendere operabile l'adapter già presente con
setup guidato e controllo esplicito della connessione. Definire il cross-check
come confronto codice/descrizione contro la fonte WHO; non confonderlo con una
validazione della diagnosi. Verificare se il servizio attuale copre anche il
lookup puntuale necessario. Confrontare API online e deployment locale WHO
soltanto rispetto a requisiti concreti di offline, manutenzione e distribuzione.
Se è richiesto proprio un sidecar locale, registrare la decisione e aggiornare
l'ADR prima di implementarlo: non è un semplice interruttore da riaccendere.

**Accettazione.** Setup da installazione pulita; ricerca sintetica riuscita;
codice noto, query senza risultati, credenziali assenti/non valide, rete assente,
timeout e recupero. Mostrare l'ultima verifica con data; distinguere servizio
configurato, risposta live e cache. Credenziali solo sul server; nessun dato
paziente nei test. Nessuna assegnazione diagnostica automatica. Release e lingua
devono essere esplicite: il binding documentato è `2026-01`, MMS, inglese.

**Dipendenze.** Scelta online/sidecar e disponibilità delle credenziali per la
prova finale. La [documentazione WHO](https://icd.who.int/docs/icd-api/), consultata
il 5 settembre, è la fonte upstream da verificare per il binding scelto.

## 3. Impostazioni semplici, navigabili e utili — essenziale

**Problema.** Troppe informazioni tecniche competono con le azioni necessarie.
È difficile sapere se accesso e Intelligence Fabric funzionano.

**Stato osservato.** Esistono già sidebar, sotto-route e ricerca nelle
impostazioni (`app/settings/layout.tsx`). La richiesta riguarda gerarchia,
contenuto e utilità, quindi non si risolve aggiungendo un'altra sidebar.

**Risultato e intervento.** Proposta di cinque aree principali:

| Area | Contenuto visibile subito |
| --- | --- |
| Panoramica | Funzioni operative, problemi attuali, azione consigliata |
| Accesso e sicurezza | Sessione, PIN/blocco, dispositivi e verifiche pertinenti |
| Documenti e intelligenza | OCR, importazione, sintesi e relativo servizio |
| Cataloghi e collegamenti | ICD-11 WHO, repertori e collegamenti disponibili |
| Preferenze e dati | Aspetto, ambulatori, backup e manutenzione ordinaria |

Ricerca sempre disponibile. Diagnostica tecnica raccolta in “Dettagli avanzati”
nelle aree pertinenti; funzioni distruttive chiaramente separate. Ogni funzione
mostra: **a cosa serve · stato · cosa fare**. Il timestamp della verifica è
accessibile vicino allo stato; provider, log tecnici e identificativi sono
approfondimenti. Esempio di copy proposto: “OCR: da configurare. Serve per leggere
le scansioni. Configura il servizio”. Non è uno stato rilevato in questa sessione.

**Accettazione.** Partendo da Impostazioni, trovare OCR, WHO e stato accesso entro
due passaggi di navigazione ciascuno; capire il problema senza aprire dettagli
tecnici. Provare caricamento, errore, non configurato e successo. Un controllo
di connessione deve aggiornare lo stato dalla risposta effettiva. Accesso,
blocco, sblocco e logout si verificano con un account sintetico, senza interrompere
la sessione reale. Ricerca, tastiera e ritorno alla pagina funzionano; ogni voce
attuale ha una destinazione nella nuova mappa.

**Dipendenze.** Vocabolario di stato condiviso con OCR/WHO/Fabric e inventario
delle impostazioni. La semplificazione del testo non elimina controlli necessari.

## 4. Scheda paziente, sizing e direzione visiva — essenziale

**Problema segnalato.** Intestazione larga con menu a tendina e scheda centrale
ristretta producono una composizione “a T”. Terapie, SISS e altre sezioni sono
poco armoniche. È una segnalazione dell'utente, non una misura da screenshot
acquisita in questa sessione.

**Risultato.** Contesto paziente riconoscibile, navigazione stabile e area di
lavoro proporzionata alla finestra. Dati e azioni prevalgono sul contenitore.

**Intervento proposto.** Un'unica griglia per intestazione e contenuto. Testata
compatta con identità e azioni; indice delle sezioni a sinistra; contenuto
flessibile; approfondimenti in pannello laterale su richiesta. Terapie, diario,
documenti e collegamenti diventano destinazioni esplicite. Nessuna seconda barra
di menu a tendina per la navigazione principale. Su finestre strette l'indice
collassa, mantenendo visibili paziente e sezione attiva. Distinguere larghezza
di lettura dei testi da spazio utile per tabelle e moduli.

**Accettazione.** Confronto a contenuti sintetici identici: paziente scarno e
denso, nomi lunghi, molte terapie, errori e sezioni vuote. Verificare almeno
1280×800, 1440×900, 1920×1080 e 768×1024, zoom 200%, tastiera e focus. Niente
azioni tagliate o scorrimento orizzontale dell'intera pagina. Aprire una sezione
e tornare indietro conserva il contesto; navigazione e modifiche non perdono
dati. Approvazione visiva su impostazioni e paziente insieme, prima del redesign
runtime esteso.

### Tre direzioni da confrontare

Fonti recuperate dal catalogo Personal Aesthetic Studio e consultate il
5 settembre 2026. Sono riferimenti per candidati, non design già approvati.
Le schede Refero descrivono siti e stili: non provano l'usabilità dei prodotti
autenticati. La verifica visiva delle schermate sorgente e dei mockup resta
parte del prossimo confronto.

| Candidato | Riferimenti | Traduzione proposta in MediFlow | Rischio da verificare |
| --- | --- | --- | --- |
| A — Precisione operativa | [Linear via Refero](https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1), [ReUI](https://reui.io/components) | Superfici chiare, bordi sottili, indice stabile, righe informative compatte; enfasi limitata | Densità eccessiva o testo troppo piccolo |
| B — Chiarezza essenziale | [Apple via Refero](https://styles.refero.design/style/aecac5da-f397-4ddf-b71f-de1efc434cb8), [coss UI](https://coss.com/ui) | Poche gerarchie, controlli riconoscibili, spaziatura regolare; pannelli progressivi | Troppo spazio vuoto rispetto al lavoro clinico |
| C — Studio operativo | Template `workspace.html` e registro sage operational di Personal Aesthetic Studio | Base carta/salvia, sans sobria, griglia rigorosa e dettagli progressivi | Colore/materiale che distrae o riduce il contrasto |

**Proposta iniziale:** A con la leggibilità di B. Confrontarla con C e con il
prodotto attuale usando gli stessi contenuti. Da Personal Aesthetic Studio si
mantengono gerarchia, densità progressiva e sobrietà; A/B sperimentano una base
neutra al posto della carta calda. È un'eccezione candidata, non una modifica
della costituzione personale. Non serve adottare un'intera libreria o copiare
un sito per recuperare un buon principio di composizione.

## 5. Onboarding assistito e tailoring — essenziale

Percorso AI consigliato con due/tre domande iniziali su attività, modalità di
lavoro preferita e ambiente. La proposta orienta verso Interactive, Headless/Agent
o una combinazione, spiega cosa configura e permette di cambiare scelta.
La professione dichiarata non verifica identità né concede privilegi.

La decisione tra agente esterno, guida integrata e soluzione ibrida resta da
risolvere con un confronto di bootstrap, costi, privacy, distribuzione e recupero.
Non imporre Codex o un account AI; il percorso manuale deve portare a un'app
utile. Mac, Windows e Linux richiedono una matrice di entrypoint e artifact
realmente disponibili e verificati, distinta dalla sola compatibilità web.

Accettazione: raccomandazione comprensibile e modificabile; anteprima e conferma
delle azioni; configurazione idempotente; ripresa dopo interruzione; cambio
profilo e rollback; nessun egress o privilegio implicito. Nessun dato clinico
nelle domande. La design arena comprende anche questi workflow.

## 6. Deslop globale del codice — essenziale

Censire il codice first-party complessivo, inclusi web, librerie, packages,
native, tooling e test: duplicazioni, percorsi morti, astrazioni inutili e
incoerenze di naming/copy/documentazione. Non assumere che ogni complessità sia
eliminabile. Generated, vendor, dati locali e archivi probatori sono esclusi
da pulizia meccanica.

Ogni finding ha evidenza, impatto, proposta, rischio e verifica prevista.
Classificare REMOVE/SIMPLIFY/CONSOLIDATE/KEEP/DEFER; applicare tranche tematiche
reversibili, coordinate con le lane funzionali. Preservare controlli, migrazioni,
compatibilità e test significativi. Nessuna quota di righe da cancellare.

Accettazione: inventario con copertura e limiti, tranche utili completate,
comportamenti preservati e regressioni verificate, benefici concreti e debito
residuo espliciti. Il solo censimento non equivale al deslop consegnato.

## 7. GDPR e AI Act — essenziale

Obiettivo: soddisfare integralmente gli obblighi applicabili al perimetro d'uso,
ai ruoli e alla versione dichiarati. Il codice locale, la supervisione umana
o una checklist automatica non certificano conformità.

Preparare matrice obbligo → fonte/versione/data di applicabilità → ruolo →
controllo → evidenza → gap. Distinguere obblighi del prodotto da responsabilità
organizzative e documenti adottati da semplici template. Esaminare finalità,
dati sanitari, diritti, retention, sicurezza, fornitori e trasferimenti, DPIA
quando richiesta; classificazione AI, literacy, trasparenza e ulteriori obblighi
condizionali secondo sistema e ruolo. Valutare separatamente un eventuale
confine dispositivo medico se emerge dall'intended purpose.

Fonti ufficiali consultate il 5 settembre 2026:
[GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng),
[AI Act](https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng) e
[Commissione europea](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai).
Rileggere testi consolidati, aggiornamenti e calendario vigente durante il lavoro.

Accettazione: requisiti applicabili coperti da interventi e prove, dossier sul
candidato esatto e revisione competente identificata e registrata. Se manca
una decisione giuridico-regolatoria o un adempimento applicabile, il gate resta
aperto. Nessuna firma, nomina, certificazione o esenzione presunta.

## Filone operativo su Linear

[Progetto 0.8.6](https://linear.app/wulfgardr/project/mediflow-086-consolidamento-funzionale-e-interfaccia-cb068ec8f3d4)
· [Contratto operativo](https://linear.app/wulfgardr/document/mediflow-086-contratto-operativo-issue-e-definition-of-done-533669b0b37b).
Creati 20 ticket: coordinamento e 19 attività, sei milestone e dipendenze
esplicite. Linear governa il piano; gli ADR e i contratti repository governano
l'implementazione. Non c'erano template Linear disponibili: ogni issue usa
outcome, scope/contratti, DoD, limiti e fonti.

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

Astra sceglie soluzioni, componenti, ordine dei sottopassi e suddivisione tecnica
motivata. Le dipendenze sono gate di completamento, non divieti di preparare
lavoro indipendente. Scelta estetica, nuovi costi/egress e cambi sostanziali di
scope richiedono la decisione pertinente. Issue 0.8.5/1.0 preservate.

## Recupero selettivo dei branch locali

Input: task `01a07256-8274-7263-813b-cdd0b099952e`, resoconto `REPORT.md` ed elenco
`pending.md` della ricognizione del 5 settembre. Gli originali restano nel registro
locale `.codex/state/mediflow-branch-closeout/2026-09-05` esterno al repository.
Quella fotografia usava `5cbbf777e`; la base odierna è successiva. I suoi 74 hold,
58 confronti conflittuali e 16 delta senza conflitti sono dati storici, non un
nuovo audit di integrazione sulla base corrente.

Sette head pertinenti sono state rilette e confrontate per i percorsi modificati
con `main 6a5463e8d`; nessuna è stata integrata. Prefisso comune: `codex/hold/`.

| Branch / SHA osservato | Destinazione 0.8.6 | Esito preparatorio |
| --- | --- | --- |
| `WUL-522-attachment-extraction-currentness-owner-harden-v1` / `1a60f3e41` | OCR, coerenza del risultato con l'allegato | Due file differiscono: candidato prioritario a revisione mirata, non fix qualificato |
| `WUL-522-local-ocr-apple-vision-execution` / `3d7dcf457` | OCR locale | 12 file differiscono; adapter storico Fabric da confrontare con composizione AnyDoc attuale |
| `WUL-522-fabric-provider-disclosure-v1` / `e90a9fe88` | Stato servizi e impostazioni | Nove file differiscono; il diff riporta una disclosure più statica rispetto al lifecycle corrente: recuperare intenti e prove, non sostituire il modello attuale |
| `WUL-559-web-states-lume` / `784423913` | Stati UI e accessibilità | Dei 16 percorsi cambiati nel branch, quattro coincidono già con main; riesaminare solo i residui pertinenti |
| `WUL-560b-command-center` / `131ea8f1a` | Ricerca e navigazione | Tre percorsi su dieci coincidono; il vecchio componente perderebbe voci e gestione successive: nessun trapianto integrale |
| `WUL-561-web-lume-mockup` / `697fdfbe6` | Scheda e confronto visivo | 40 percorsi differenti; materiale di studio, non base runtime da ripristinare |
| `WUL-565-macos-inspector-strumento-carta` / `c08d5c9e3` | Ispirazione per pannello contestuale | Otto percorsi differenti; proposta nativa separata, non dipendenza del redesign localhost |

**Altre famiglie del portafoglio.** Sessione, sintesi e currentness entrano solo
per un difetto riprodotto nei percorsi di questa release. Patient Insight e
Treatment Reasoning rientrano nella verifica delle capacità esistenti, senza
obbligo di integrare ogni vecchio binding. Harness e release hygiene possono
supportare le verifiche. Governance conserva le informazioni necessarie, rese
leggibili nella UI. XPC, ampliamento provider cloud, nuove capacità headless e
parity Apple estesa restano fuori dal nucleo 0.8.6 salvo nuova decisione.

WHO #322/#340 è materiale già ricomposto in main secondo la ricognizione:
la nuova attività è renderlo utilizzabile e provarlo. Per tastiera e stati,
consultare anche WUL-560/c/d e l'inventario WUL-562 prima di duplicare verifiche.
Gli altri rami sono stati mappati dal registro, non sottoposti ad audit funzionale.

Prima di recuperare un contributo: riprodurre il bisogno sulla base corrente,
identificare la differenza utile, riallinearla al contratto e verificarla in un
nuovo worktree dedicato. Preservare worktree dirty e task attivi. Branch
recuperabile, merge senza conflitti e test storici non equivalgono a consegna.

## Sequenza e completamento

1. **Inventario operativo e contratti:** mappa funzione → servizio → stato →
   azione, riproduzione dei guasti sintetici, decisione OCR/WHO, selezione residui.
2. **Confronto UX:** tre candidati per impostazioni e paziente con contenuti
   equivalenti; scegliere struttura e stile. Può procedere mentre si verifica OCR.
3. **Consolidamento funzionale:** OCR e WHO end-to-end; recuperi mirati su
   currentness/sessione; stato dei servizi attendibile.
4. **Implementazione UI:** nuova mappa impostazioni e scheda sulla direzione scelta,
   conservando contratti e comportamenti corretti del prodotto corrente.
5. **Onboarding e deslop:** percorso assistito reversibile e matrice piattaforme;
   censimento globale e semplificazioni utili.
6. **GDPR/AI Act:** applicabilità e requisiti possono partire dopo la baseline;
   interventi e dossier recepiscono onboarding, UI, runtime e deslop finali.
7. **Verifica 0.8.6:** scenari funzionali, accessibilità e regressioni dei flussi
   toccati; prove sull'installazione target e note dei limiti. Poi separatamente
   eventuali commit, PR, CI remota, tag e release con l'autorità necessaria.

La 0.8.6 è candidata alla consegna quando i sette filoni essenziali soddisfano
le rispettive accettazioni. OCR supportato e WHO non vengono dichiarati operativi
con soli test fake; una decisione aperta sul loro funzionamento blocca quel claim.
Nessuna data promessa finché non sono noti guasti, scelta visiva e recuperi utili.

## Evidenza di questa preparazione

Letti contratti, setup, roadmap, skill e catalogo estetico, task e artefatti della
ricognizione. Ispezionati sorgenti pertinenti e sette head locali; approfonditi
due diff UI. Non avviati server, OCR, WHO o test applicativi; nessuna osservazione
dell'interfaccia autenticata né benchmark clinico. Questa consegna riguarda il
piano e la selezione preliminare, non certifica le funzionalità o i branch.

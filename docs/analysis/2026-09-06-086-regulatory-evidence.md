# MediFlow 0.8.6: applicabilità ed evidenze GDPR / AI Act

Data di ricerca: **2026-09-06**, Europe/Rome. Lane **WUL-685 / WUL-688**.
Baseline esaminata: **`c160bdce250c0120682f45e3dd1a9d587f7b9935`**,
branch `codex/WUL-685-086-compliance`, worktree `mediflow-086-compliance`.
Seguito tecnico **WUL-686/687**, stesso giorno, da `c10b21a24c3763ea9b58b47ff224b9fdc506b94b`:
delta P2/P9 e verifiche locali nelle sezioni 6.1 e 7.

**Esito: matrice candidata per revisione; gate giuridico-regolatorio aperto.**
La ricerca documenta requisiti, condizioni ed evidenze nel sorgente pubblico.
Non attesta conformità, adeguatezza di un deployment, qualificazione del
prodotto, adozione di procedure o completamento di WUL-686/687/688.

### Raccordo del 23 settembre 2026: due contesti professionali sul Mac

Il perimetro ora dichiarato comprende **uso professionale individuale sul Mac**,
sia nell'attività autonoma sia per conto di una struttura, da mantenere separati.
Include la valutazione esplicita dell'AI remota. Non sono stati letti o modificati
archivi clinici, account dei provider o configurazioni della struttura.

La sorgente `v0.8.6`, commit
`46296266c0a8ff4d4ab19216af7e761cddec7d78`, è pubblicata. Le nuove prove usano
quella sorgente in un runtime di produzione localhost con dati sintetici.
La checkout documentale `f05b3847d863fcddf53c87be88ba4b884b938aca` aggiunge
documenti e asset; non trasforma prove storiche in prove sul tag. La qualifica
dell'app nativa storica e delle piattaforme successive resta fuori perimetro.
Questa sezione prevale sui precedenti riferimenti a una release sorgente ancora
da pubblicare o a Xcode come prerequisito del dossier.

| Contesto | Trattamento da valutare | Decisione ancora necessaria |
| --- | --- | --- |
| Attività professionale autonoma | Cartella dei propri assistiti, documenti ricevuti, note, scale, consultazione dei repertori ed eventuali proposte AI | Finalità e presupposti per ciascun uso, informativa e registro adottati, conservazione e gestione delle richieste; ruolo effettivo del professionista secondo l'attività |
| Attività per una struttura | Dati trattati nell'incarico conferito, su dispositivo individuale | Identificazione del titolare e delle istruzioni ricevute; autorizzazione a dispositivo, archivio, copie e fornitore AI. Il possesso del Mac non attribuisce tali poteri |

La separazione richiesta deve comprendere archivi, documenti esportati, backup,
sessioni e configurazioni dei provider. Un filtro «ambulatorio» nella stessa
cartella non viene assunto come separazione tra titolari. La configurazione
operativa candidata usa directory dati e sessioni distinte; destinazioni e
procedure reali non sono ancora state configurate o collaudate. Non spostare
automaticamente dati della struttura nell'archivio dell'attività autonoma.

#### Canale remoto scelto e istruzioni della struttura

Il 23 settembre l'utente ha circoscritto il provider esterno a **OpenAI tramite
ChatGPT OAuth**; altri provider restano futuri. Le istruzioni della struttura
per dati sul Mac, copie e AI sono **da concordare**. Non è quindi dimostrata
l'autorità operativa per tale trattamento; non è un difetto risolvibile con un
test del software. Il tipo di piano/workspace ChatGPT e le condizioni realmente
applicabili non sono ancora attestati; OAuth identifica il metodo di accesso,
non il contratto o il ruolo del fornitore.

Fonti OpenAI rilette il 23 settembre:

- [Codex con un piano ChatGPT](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan):
  l'accesso ChatGPT segue i termini e i controlli dati del piano. Per Plus/Pro
  l'uso dei contenuti per migliorare i modelli dipende dalle impostazioni;
  Business/Enterprise/Edu hanno condizioni differenti. Non sono state lette né
  cambiate le impostazioni dell'account concreto.
- [Termini europei per servizi individuali](https://openai.com/policies/eu-terms-of-use/),
  aggiornati 16 gennaio 2026: richiedono diritti sugli input e verifica degli
  output; limitano l'uso di output riferiti a persone per decisioni con effetti
  materiali, incluse quelle mediche. È un vincolo concreto da risolvere per
  Patient Insight e Treatment Reasoning, non superato dal solo pulsante di
  conferma umana.
- [Services Agreement](https://openai.com/policies/services-agreement/) e
  [DPA](https://openai.com/policies/data-processing-addendum/), quest'ultimo
  efficace dal 1 gennaio 2026: l'accordo professionale e il trattamento per
  conto del cliente vanno collegati al servizio e all'account coperti. Non si
  attribuisce quel DPA a un account individuale soltanto perché usa OAuth.
  La clausola HIPAA riguarda la propria definizione statunitense di PHI: non
  sostituisce la valutazione GDPR dei dati sanitari italiani.

Non sono dedotti dall'opt-out dall'addestramento: assenza di conservazione,
residenza esclusivamente UE, applicabilità del DPA, autorizzazione della
struttura o idoneità clinica. Il flusso MediFlow usa il trasporto Codex descritto
nell'ADR0134; le condizioni del canale effettivo devono coprire proprio quel
flusso. Il DPA dedicato a ChatGPT Sites e le condizioni di ChatGPT Health non
sono usati come copertura dell'integrazione MediFlow.

La decisione candidata resta distinta per ciascun uso: collaudo sintetico
locale ammesso nel task; uso per la struttura e invii di dati sanitari remoti
non ammessi dal presente dossier. L'attività autonoma richiede ancora le
procedure adottate e la valutazione delle funzioni realmente utilizzate.
Questa è una proposta documentata di perimetro, non una firma o un'approvazione
professionale già raccolta.

#### Applicabilità italiana circoscritta

Il [provvedimento del Garante del 7 marzo 2019](https://www.garanteprivacy.it/home/docweb/-/docweb-display/docweb/9091942),
riletto il 23 settembre, chiarisce che i trattamenti necessari alla cura svolti
da un professionista vincolato al segreto non richiedono il consenso privacy
del paziente come presupposto; usi ulteriori richiedono una valutazione distinta.
Per il professionista sanitario che opera individualmente in libera professione
non impone il DPO per questa sola attività, mentre resta il registro dei
trattamenti. Queste indicazioni non qualificano automaticamente l'uso per una
struttura né un invio al provider AI. Informativa, finalità, basi applicabili e
responsabilità restano da registrare per ciascuno dei due contesti. La necessità
di DPIA va motivata rispetto a trattamenti e rischi effettivi, comprendendo
l'AI remota, senza dedurla soltanto dal numero di postazioni.

La [pagina della Commissione sull'AI Act](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai)
è stata riletta: espone l'aggiornamento del 3 agosto 2026 e il calendario già
registrato in §2. I tentativi di rilettura dei testi EUR-Lex in questa sessione
hanno restituito una verifica automatica del browser: non sono conteggiati come
nuova lettura degli atti. Il registro normativo del 6 settembre resta attribuito
alla ricerca originaria; nessuna classificazione è dedotta dal solo calendario.

#### Flussi, prove e decisioni del deployment

| Flusso o controllo | Meccanismo e prova disponibile | Limite concreto e responsabile del seguito |
| --- | --- | --- |
| Accesso locale | Setup ordinario su archivio vuoto; quattro casi E2E sul tag per ciclo accesso/blocco/logout/reset e recupero tra schede | Le prove riguardano account sintetici. Le credenziali brevi hanno un rischio separato già assegnato a WUL-722; non dichiarare risolto quel rischio dai test di accesso |
| Cartella senza AI | Primo paziente, nota cifrata e ADL; rilettura dopo riavvio su archivio sintetico. Bozza di onboarding ripresa e cambio profilo con rollback | La prima ricevuta apre nota/scala tramite URL UI. La prova successiva tramite clic ha riprodotto il ritorno alla guida dopo creazione: candidato di correzione WUL-732, non modifica retroattiva del tag |
| Persistenza e copie | Cifratura per i campi dichiarati in SECURITY, directory dati esplicite, backup e ripristino secondo i contratti esistenti | Il file SQLite non è integralmente cifrato; export, metadati e copie hanno coperture differenti. Sul Mac di prova FileVault risulta attivo, ma non sono stati ispezionati gli archivi reali né la destinazione dei loro backup. WUL-721/730 conservano le correzioni pertinenti |
| Diritti, conservazione e ripristino | Matrice P2 delle categorie esportate e test di restore già attribuiti alla rispettiva revisione; tombstone e purge distinti | PDF/FHIR non equivalgono a risposta completa a una richiesta. Occorrono procedura di ricerca delle copie, decisione di conservazione e riconciliazione dei record cancellati dopo il backup; WUL-686 con WUL-730 |
| AI remota | ADR0134: quattro operazioni nominate, consenso al payload congelato, controlli su fonti/modello, proposte da rivedere e nessuna applicazione clinica automatica. CI del tag: harness browser sintetico e test dei quattro controller | Provider live finale non attestato. Prima di dati reali identificare canale, account, condizioni sul trattamento, retention, addestramento, destinatari e trasferimenti; documentare autorizzazione separata per i due contesti. WUL-687/688; nessuna credenziale è stata utilizzata |
| Selezione dei modelli | 45 controlli mirati sul tag passati: default persistito, override, lettore del binding, revoca, conflitto e annullamento, con peer sintetici | Non qualificano ogni combinazione UI/modello/provider né un servizio remoto disponibile. WUL-691 conserva la matrice delle singole funzioni e WUL-726 i cambiamenti correnti |
| Headless | Accesso mediato con comandi nominati, autorizzazioni, conferma delle scritture, audit e ricevute; evidenza preesistente raccordata in WUL-697 | Nessun permesso generale a leggere SQLite o a inviare dati a un agente esterno. Il provider eventualmente usato dall'agente va incluso nel flusso concreto; WUL-731 |

Per l'AI, distinguere Patient Insight, Smart Import, Document Synthesis e
Treatment Reasoning. Quest'ultimo mantiene la propria finalità di ragionamento
clinico: non è riclassificato come semplice riassunto. Il giudizio applicabile
deve riguardare funzione, impiego effettivo e influenza sulla decisione medica;
il controllo umano e l'installazione locale sono elementi della valutazione,
non un'esenzione generale.

**Esito operativo del dossier: preparazione avanzata, ammissione clinica ancora
aperta per entrambi i contesti e per l'AI remota.** Gli elementi mancanti sono
la configurazione effettiva dei due archivi, le istruzioni della struttura,
le condizioni dell’account ChatGPT OAuth scelto, l'adozione delle procedure e la
decisione motivata sulle funzioni incluse. La pubblicazione del sorgente resta
un risultato distinto, già conseguito. Le prove private sintetiche sono nel
registro di consolidamento del 23 settembre; nessun dato paziente, token o
backup è incluso nel dossier pubblico.

### Raccordo tecnico del 12 settembre 2026

Le sezioni successive conservano la fotografia del 6 settembre e le sue
baseline. Questo aggiornamento aggiunge prove delimitate; non sostituisce la
matrice con un'attestazione della release corrente.

Il sorgente esaminato è `65d0a3ac36e8e7dbe918fd366c6855e56123a6c6`.
La QA localhost usata per le prove interattive ha invece build
`4kDmyY4VX6cfJMZhKj12d`, precedente a quel sorgente. Le integrazioni OpenAI e
OCR sono ancora in corso. **Non esiste ancora una qualifica finale ottenuta
sommando queste prove.** Il gate WUL-697 richiede la stessa candidata per Mac,
localhost e Headless sul Mac; WUL-680 e la decisione WUL-688 restano aperti.

| Raccordo | Prova eseguita | Limite conservato |
| --- | --- | --- |
| P2, export PDF | Dal comando ordinario della scheda sintetica è stato scaricato un PDF di 9.080 byte. Estrazione del testo e ispezione della pagina renderizzata confermano identità sintetica, nota manuale e scala ADL 6/6, senza tagli o sovrapposizioni osservati. | Prova sulla QA precedente, non sulla candidata finale. Restano le esclusioni della matrice §6.1: non è un export completo per una richiesta di accesso. |
| P3, restore | Sul sorgente indicato, [backup-total-roundtrip.test.ts](../../lib/backup-total-roundtrip.test.ts) eseguito con Node 24.19.0 e directory dati sintetiche isolate: 7 test superati, nessun errore o skip, codice di uscita 0. Verificati scheduler e ripristino delle collezioni previste, conservazione dei byte cifrati, controlli di autorità, audit e rollback. | Non prova l'interfaccia del ripristino, la gestione delle copie esterne, i tempi legali di conservazione o la gestione dei record cancellati dopo la creazione del backup. P3 resta parzialmente coperto. |
| P3, distinzione del drill | Lo [script del drill](../../scripts/backup-restore-drill.mjs) dichiara `sandbox-payload-materialization`: materializza il payload JSON e verifica il preflight. Non è stato eseguito in questo raccordo. | Non presentarlo come prova del ripristino effettivo del database. |

Provenienza delle prove, conservate nel checkpoint locale di collaudo fuori
da Git, senza database o sessioni nel dossier pubblico:

- PDF sintetico, SHA-256:
  `653d51e0bfe05ae6903237e071ae512c5806a4132913034a76fd677b6b358c97`.
- Output originale dei test di restore, SHA-256:
  `d7b55920966a26d7dfeab4a8a59527896326e2c521f8793a6035704ca93ed23a`.
- Ricevute: `localhost-pdf-report.json` e
  `backup-total-roundtrip-current.json`, con superficie, versione, esito e limiti.

La responsabilità operativa del seguito e della revisione è stata indicata
dall'utente nel registro locale, con eventuale supporto legale. Questo non
equivale a revisione già effettuata, nomina, base giuridica o classificazione.
La conclusione dovrà riferirsi alla candidata esatta e alle decisioni
applicabili; non è richiesta qui una nuova attribuzione personale pubblica.

## 1. Perimetro e metodo

Sono stati letti AGENTS, CONTRIBUTING, SECURITY, i confini pertinenti di
ARCHITECTURE, la guida [privacy e AI](../privacy-and-ai-governance.md),
[ADR 0065](../adr/0065-intended-purpose-and-claims-guard.md),
[COMPLIANCE](../COMPLIANCE.md), la matrice dei runtime e la
[roadmap 0.8.6, sezione 7](../roadmap-086-consolidamento.md#7-gdpr-e-ai-act--essenziale).
README e STATE_OF_THE_SYSTEM descrivono ancora una fotografia sorgente 0.8.5;
le loro vecchie verifiche non sono prove sul candidato 0.8.6.

La prima fase è un'ispezione statica: file pubblicabili della repository, senza database,
configurazioni effettive, credenziali, dati clinici, servizi avviati o contatti
esterni. Le fonti normative sono state rilette online; la data di consultazione
non coincide con la data di pubblicazione o di applicazione della norma.

Nelle matrici, **T** identifica un supporto tecnico del prodotto e **O** un
adempimento organizzativo. Anche nelle righe T il destinatario dell'obbligo
legale resta il soggetto individuato dalla norma. I nomi dei ruoli sono
categorie da valutare, non nomine né attribuzioni a persone o organizzazioni.
**Condizionale** significa che manca una decisione di applicabilità, non che
l'obbligo sia escluso. Le sigle delle fonti e delle evidenze rimandano ai
registri seguenti. I gap indicano il limite della prova raccolta, non una
violazione accertata.

## 2. Fonti ufficiali e versioni

Tutte le fonti seguenti sono state consultate il **6 settembre 2026**. I
consolidati EUR-Lex sono strumenti documentali; per il testo autentico valgono
gli atti pubblicati in Gazzetta ufficiale, comprese modifiche e rettifiche.
Le pagine della Commissione orientano l'interpretazione e non modificano la
legge. Non sono state usate fonti commerciali o post social come autorità.

| ID | Fonte e URL esatto | Versione / data osservata | Uso e limite |
| --- | --- | --- | --- |
| G1 | [GDPR, consolidato corrente](https://eur-lex.europa.eu/eli/reg/2016/679) | EUR-Lex `02016R0679-20160504`, EN `000.002`; consolidamento 04/05/2016, rettifica OJ L 127 del 23/05/2018 | Il selettore corrente restituisce questa versione; la data 2016 non significa che si sia ignorata la rettifica. Applicazione generale dal 25/05/2018, art. 99. |
| A1 | [AI Act, consolidato corrente](https://eur-lex.europa.eu/eli/reg/2024/1689) | EUR-Lex `02024R1689-20260727`, EN `001.001`, 27/07/2026 | Base della matrice AI; il solo atto originale del 2024 non basta per il calendario corrente. |
| A2 | [Regolamento (UE) 2026/1744, Digital Omnibus on AI](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=OJ:L_202601744) | Atto 08/07/2026; OJ 24/07/2026; entrata in vigore 27/07/2026, art. 4 | Modifica vigente, non semplice proposta o accordo politico. |
| C1 | [Commissione: AI Act](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai) | Pagina aggiornata 03/08/2026 | Calendario e raccordo con A2; prevale A1 per condizioni e deroghe puntuali. |
| C2 | [Commissione: definizione di sistema AI](https://digital-strategy.ec.europa.eu/en/library/commission-publishes-guidelines-ai-system-definition-facilitate-first-ai-acts-rules-application) | Pubblicazione 06/02/2025 | Guida non vincolante alla definizione; evitare di equiparare ogni algoritmo a un sistema AI. |
| C3 | [Commissione: AI literacy, Q&A](https://digital-strategy.ec.europa.eu/en/faqs/ai-literacy-questions-answers) | Pagina aggiornata 27/07/2026 | Le risposte descrivono l'art. 4 modificato; l'introduzione conserva una formulazione precedente sul livello sufficiente. Per obbligo e data esatta prevalgono A1/A2. |
| C4 | [Commissione: trasparenza AI](https://digital-strategy.ec.europa.eu/en/policies/guidelines-ai-transparency-obligations) | Pagina di presentazione aggiornata 06/08/2026 | Distingue informazione all'utente, marcatura leggibile da macchina e disclosure del deployer. Non è una prova di adesione a un codice di pratica. |
| C5 | [Commissione: linee guida sui sistemi ad alto rischio](https://digital-strategy.ec.europa.eu/en/policies/guidelines-ai-high-risk-systems) | Pagina aggiornata 06/07/2026; testo descritto come **draft** nella pagina consultata | La scadenza della consultazione non prova l'adozione finale. Usata come orientamento, non come classificazione vincolante. |
| C6 | [Commissione: basi giuridiche e dati sensibili](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/legal-grounds-processing-data_en?prefLang=ro) | Pagina ufficiale consultata; versione editoriale non esposta nel risultato | Supporto a G1 artt. 6 e 9; nessuna base selezionata per MediFlow. |
| C7 | [Commissione: obblighi GDPR](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/obligations_en) | Pagina corrente consultata; versione editoriale non esposta | Informative, sicurezza, DPIA, violazioni e DPO; gli esempi non sostituiscono la valutazione del caso concreto. |
| C8 | [Commissione: richieste degli interessati](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/dealing-requests-individuals_en) | Pagina corrente consultata; versione editoriale non esposta | Procedure per i diritti e relativi limiti. |
| C9 | [Commissione: trasferimenti internazionali](https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/rules-international-data-transfers_en) | Pagina corrente consultata; versione editoriale non esposta | Strumenti del capo V GDPR, senza selezionare un meccanismo per un account concreto. |
| C10 | [Commissione: Q&A sulle clausole contrattuali standard](https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/new-standard-contractual-clauses-questions-and-answers-overview_en) | Pagina dinamica; richiama le due decisioni del 04/06/2021 | Distingue clausole titolare/responsabile e trasferimenti; modello disponibile non equivale a contratto concluso. |
| M1 | [MDR, consolidato corrente](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02017R0745-20260719) | EUR-Lex `02017R0745-20260719`, EN `007.001`, 19/07/2026 | Solo verifica preliminare del confine: artt. 2(1), 2(12), 52 e allegato VIII, regola 11. |
| M2 | [MDCG 2019-11 rev.1, software](https://health.ec.europa.eu/document/download/b45335c5-1679-4c71-a91c-fc7a4d37f12b_en?filename=mdcg_2019_11_en.pdf) | Giugno 2025, pubblicazione Commissione 17/06/2025; documento di 36 pagine | Guida MDCG ospitata sul sito ufficiale: non vincolante e non posizione ufficiale della Commissione. Distinzione fra gestione documentale e moduli con finalità medica. |

Per ripetere la ricerca usare i selettori correnti G1/A1 e il
[selettore MDR](https://eur-lex.europa.eu/eli/reg/2017/745/oj/eng), confrontando
i CELEX sopra registrati con eventuali nuove versioni. Non sostituire
silenziosamente una versione nel dossier già revisionato.

### Calendario da usare nel dossier

| Codice | Disposizioni | Applicabilità osservata in G1 / A1 / A2 |
| --- | --- | --- |
| D-G | GDPR | Dal **25/05/2018**, con condizioni proprie di ciascun articolo. |
| D-A | AI Act, regola generale | Dal **02/08/2026**; non tutte le disposizioni seguono questa data. |
| D-L | AI Act, capo I e divieti preesistenti | Dal **02/02/2025**; il testo modificato dell'art. 4 è vigente dal **27/07/2026**. |
| D-N | Nuovi divieti art. 5(1)(ba), (bb), 5(1a), (1b) | Dal **02/12/2026**, art. 113(a). Non estendere questa data ai divieti preesistenti. |
| D-M | Marcatura ex art. 50(2) | D-A; solo per sistemi generatori già **immessi sul mercato prima del 02/08/2026**, art. 111(4) prevede adeguamento entro **02/12/2026**. Una vecchia branch non prova questo presupposto. |
| D-H | Capo III, sezioni 1–3, salvo art. 6(5) | **02/12/2027** per art. 6(2)/allegato III; **02/08/2028** per art. 6(1)/allegato I, art. 113(c). |
| D-P | Obblighi sui modelli GPAI, capo V | Dal **02/08/2025**; modelli immessi prima di tale data: art. 111(3), entro **02/08/2027**. |

Il rinvio D-H riguarda le sezioni nominate dall'art. 113(c): **non autorizza
un rinvio indistinto dell'intero AI Act**. Trasparenza e literacy richiedono
valutazione adesso. Per registrazione, valutazione di conformità, monitoraggio,
incidenti e sistemi preesistenti, il revisore deve raccordare la singola
disposizione agli artt. 111/113 e alla classificazione; questa lane non concede
esenzioni temporali. Gli artt. 102–110 si applicano dal 27/07/2026.

## 3. Evidenze della repository e stato dei documenti

Ogni percorso sotto è riferito alla baseline iniziale, non a una release
pubblicata. Il prefisso **E** identifica una lettura statica; un test citato ma
non eseguito in questa lane è soltanto una possibile superficie di verifica.

| ID | Evidenza pubblica letta | Cosa dimostra / limite |
| --- | --- | --- |
| E1 | [ADR 0065](../adr/0065-intended-purpose-and-claims-guard.md), [privacy e AI](../privacy-and-ai-governance.md), [COMPLIANCE](../COMPLIANCE.md) | Finalità assistiva e claim ammessi. ADR 0065 è `Accepted`, 24/05/2026; non è una decisione MDR o una nomina privacy. |
| E2 | [SECURITY](../../SECURITY.md), [ARCHITECTURE](../../ARCHITECTURE.md), [campi cifrati](../../lib/db.ts), [primitive crittografiche](../../lib/security/security.ts) | `ENCRYPTED_FIELDS`, cifratura per campo, confini auth e topologia dichiarati. Non cifratura integrale né prova della macchina dell'operatore. |
| E3 | [cascade paziente](../../lib/patient-cascade.ts), [purge admin](../../app/api/system/purge-patient/route.ts), SECURITY | Distinzione tombstone/purge, conteggi dry-run e sessione admin. La purge del database live non raggiunge copie esportate. |
| E4 | [mapper FHIR](../../lib/fhir/bundle-mapper.ts), [test mapper](../../lib/fhir/bundle-mapper.test.ts), [test report PDF](../../lib/report-service.test.ts), COMPLIANCE | Mappatura di Patient, Condition, Encounter, MedicationStatement e Observation; copertura per categoria in §6.1. Non un export completo di tutti i dati personali e degli allegati. |
| E5 | [ADR retention](../adr/0023-backup-retention-policy-keep-last-n.md), [preflight](../../lib/backup-restore-preflight.ts), [formato backup](../../lib/backup-artifact.ts), [drill](../../scripts/backup-restore-drill.mjs) | Contratti e strumenti presenti. `keep-last-N` copre file dello scheduler; nessun drill eseguito qui né periodo legale di conservazione determinato. |
| E6 | [matrice runtime](../ai-runtime-serving-matrix.md), [gate egress](../../lib/ai-egress-gate.ts), [stato Fabric](../../lib/ai-providers/fabric/status.ts) | Quattro percorsi generativi `proposal_only`; `available_unqualified`; gate narrativo chiuso. Le classi Fabric `deterministic/generative` non sono qualificazioni giuridiche. |
| E7 | [contratto Treatment Reasoning](../../lib/treatment-reasoning-contract.ts), [contratto output ATHENA v2](../../lib/ai-providers/fabric/treatment-reasoning-athena-output-contract-v2.ts) | `recommendation`, `safetyFlags`, azioni di review/prefill; output v2 con `writesPerformed: 0` e `applyPolicy: none`. Motivo concreto per lo screening MDR per funzione. |
| E8 | [inventario compliance](../../lib/compliance-evidence-inventory.ts), [test inventario](../../lib/compliance-evidence-inventory.test.ts), [E2E compliance](../../e2e/settings-compliance.spec.ts) | Inventario statico `mediflow.compliance-evidence.v1`, `technical_evidence_inventory_only`, `legalVerdict: not_assessed`. Riferimenti versionati aggiornati in P9; test unitari eseguiti nel seguito tecnico, E2E non eseguito. |
| E9 | [claims guard](../../scripts/check-claims-guard.mjs), [ADR 0092](../adr/0092-limite-digest-bound-readiness-ai-locale.md), SECURITY | Guard testuale e limiti di readiness. Non audit legale, qualifica clinica o prova di assenza di egress del processo reale. |

Le policy tecniche e gli ADR accettati sono **documenti adottati nel progetto**.
La guida privacy è orientamento editoriale; la roadmap è pianificazione;
l'inventario in-app è descrittivo. Nessuno di questi stati dimostra l'adozione
da parte del soggetto che effettua il trattamento.

Nel corpus Markdown pubblico interrogato non sono emerse prove di informative
adottate, registro dei trattamenti, DPIA deliberata, procedura data breach,
accordi con responsabili o registro di iniziative di literacy. Non si conclude
che tali documenti manchino fuori dalla repository. Gli schemi di raccolta e
le checklist proposti qui restano **template da completare e revisionare**;
non diventano documenti adottati con un commit. Eventuali riferimenti a prove
organizzative riservate vanno conservati nel dossier autorizzato esterno a Git.

## 4. Matrice GDPR

Versione **G** nelle righe = G1, consolidato `20160504 / 000.002`, riletto il
06/09/2026. Le pagine C6–C10 sono fonti interpretative alle versioni del registro.

### Supporti tecnici del prodotto

| ID | Obbligo | Fonte | Versione | Data | Ruolo applicabile | Controllo T | Evidenza repo | Gap / delta verificabile |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GT1 | Minimizzazione e protezione per progettazione/default | G1 artt. 5, 25; C7 | G | D-G | Titolare; responsabile per le proprie prestazioni | Local-first, opt-in, dati minimi per capacità | E2, E6 | Preparare mappa categoria → copia → accesso → egress, includendo paired, export, backup e provider; il default dichiarato non prova il deployment. |
| GT2 | Sicurezza commisurata al rischio | G1 art. 32; C7 | G | D-G | Titolare / responsabile | Cifratura per campo, autenticazione, separazione admin e client | E2, E3 | Censire i dati non coperti da cifratura applicativa e le misure compensative da verificare sull'host. Non dedurre dalla norma un obbligo universale di cifrare ogni byte di SQLite. |
| GT3 | Esattezza e rettifica | G1 artt. 5(1)(d), 16; C8 | G | D-G | Titolare; responsabile a supporto | Fonti consultabili, proposta AI separata dalla conferma | E1, E6, E7 | Prova sintetica di correzione della fonte e invalidazione/riesame dei derivati. La correttezza dello schema AI non prova correttezza clinica. |
| GT4 | Accesso e portabilità nei rispettivi presupposti | G1 artt. 15, 20; C8 | G | D-G | Titolare | Export locale e inventario dei dati disponibili | E4, E8 | Confrontare dati trattati con dati esportati, inclusi allegati e derivati pertinenti. Un Bundle FHIR v0 non dimostra completezza dell'accesso; art. 20 non si applica a ogni base giuridica. |
| GT5 | Conservazione ed erasure con relative eccezioni | G1 artt. 5(1)(e), 17; C8 | G | D-G | Titolare; responsabile su istruzioni | Tombstone, purge admin e retention scheduler | E3, E5 | Testare il grafo live su fixture; predisporre manifest delle copie esterne e istruzioni per il restore dopo erasure. Nessuna cancellazione automatica fondata sulla sola richiesta, senza verifica dei limiti legali. |
| GT6 | Limitazione e gestione delle opposizioni/comunicazioni | G1 artt. 18, 19, 21; C8 | G | D-G | Titolare | Procedura per sospendere gli usi contestati e mantenere le sole operazioni ammesse | E1, E3 | Non è emerso un meccanismo generale di limitazione nelle superfici cercate. Tombstone e purge non ne dimostrano l'equivalenza. Prima definire procedura e copertura di AI, export e paired; eventuale nuovo contratto richiede ADR. |
| GT7 | Disponibilità e verifica delle misure | G1 art. 32(1)(b)–(d); C7 | G | D-G | Titolare / responsabile | Backup, preflight e ripristino; audit tecnico con minimizzazione | E2, E5 | Allegare risultato del drill sintetico sul candidato esatto e prova separata del deployment; definire accessi e retention dell'audit. Identificatori redatti non sono automaticamente anonimi. |

### Adempimenti organizzativi

| ID | Obbligo | Fonte | Versione | Data | Ruolo applicabile | Controllo O | Evidenza repo | Gap / decisione competente |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GO1 | Responsabilità e ruoli secondo attività effettive | G1 artt. 4(7)–(8), 24, 26, 28 | G | D-G | Titolare, eventuali contitolari/responsabili | Mappa finalità/mezzi, istruzioni e accordi pertinenti | E1, E8: ruoli non assegnati | Compilare scheda del deployment. Autore del software, medico e amministratore tecnico non acquisiscono automaticamente un ruolo GDPR dal nome della funzione. |
| GO2 | Liceità e condizioni per dati sanitari | G1 artt. 6, 9(2)–(4); C6 | G | D-G, prima del trattamento pertinente | Titolare | Motivazione per ciascuna finalità, inclusi usi AI e fornitori | E1 | Selezionare base art. 6 e condizione art. 9 con le norme sanitarie nazionali pertinenti. Opt-in cloud o permesso del microfono non dimostrano consenso privacy valido né autorizzano nuove finalità. |
| GO3 | Informazione trasparente agli interessati | G1 artt. 12–14; C7 | G | D-G; tempi degli artt. 13/14 | Titolare | Informativa contestuale, canali e aggiornamenti | E1 è guida di prodotto | Template con finalità, categorie, destinatari, conservazione, diritti, contatti e fonti per raccolta indiretta; adozione e consegna non osservate. |
| GO4 | Registro dei trattamenti | G1 art. 30 | G | D-G | Titolare / responsabile, registri pertinenti | Registro operativo aggiornabile | E8 non è un registro art. 30 | Per dati sanitari/non occasionali non presumere l'esenzione sotto 250 addetti. Preparare schema; dati identificativi e adozione restano nel dossier organizzativo autorizzato. |
| GO5 | DPIA e consultazione preventiva quando richieste | G1 artt. 35–36; C7 | G | D-G, prima del trattamento a rischio pertinente | Titolare; DPO se designato, responsabile a supporto | Screening documentato e valutazione dei rischi | E2, E6 come input tecnico | Valutare scala, contesto, nuove tecnologie, soggetti vulnerabili e liste dell'autorità nazionale. Né obbligo universale per ogni studio né esenzione automatica perché locale; documentare il rischio residuo e l'eventuale consultazione. |
| GO6 | DPO nei casi previsti e autonomia del ruolo | G1 artt. 37–39; C7 | G | D-G | Titolare / responsabile che soddisfa i presupposti | Valutazione dei presupposti e supporto organizzativo | Nessuna nomina provata da E8 | Verificare natura pubblica, attività principali, scala e monitoraggio. Questa lane non decide l'obbligo nel caso concreto, non nomina e non firma. |
| GO7 | Gestione effettiva dei diritti | G1 artt. 12, 15–21; C8 | G | D-G; risposta normalmente entro un mese | Titolare; responsabile a supporto | Ricezione, verifica proporzionata dell'identità, valutazione, risposta tracciata | E3/E4 sono strumenti parziali | Procedura con eventuale proroga motivata fino ad altri due mesi e informazione entro il primo mese; distinguere accesso, portabilità, rettifica, limitazione ed erasure. |
| GO8 | Valutare decisioni esclusivamente automatizzate | G1 art. 22; C8 | G | D-G, condizionale | Titolare | Revisione umana effettiva e possibilità di contestazione | E1, E6, E7 | Accertare influenza reale degli output sul processo e conseguenze per la persona. Un pulsante di conferma non dimostra da solo intervento umano significativo; non invocare eccezioni senza istruttoria. |
| GO9 | Gestione delle violazioni di dati personali | G1 artt. 33–34; C7 | G | D-G, al verificarsi del presupposto | Titolare; responsabile informa il titolare | Procedura, registro incidenti e valutazione del rischio | SECURITY tratta segnalazioni di vulnerabilità, non prova questa procedura | Preparare runbook e simulazione senza dati reali: autorità senza ingiustificato ritardo e, ove fattibile, entro 72 ore dalla conoscenza, salvo rischio improbabile; interessati se rischio elevato, con eccezioni art. 34. Registrare anche i casi non notificati. |
| GO10 | Fornitori, copie e trasferimenti | G1 artt. 28, 32, 44–49; C9/C10 | G | D-G, prima dell'affidamento/trasferimento pertinente | Titolare / responsabile secondo il flusso | Due diligence, accordi, autorizzazioni e misure pertinenti | E5/E6: cloud spento, copie esplicite | Scheda per provider/servizio con accessi, località, subfornitori, retention e cancellazione. Verificare separatamente supporto remoto e copie sincronizzate dall'operatore; pseudonimizzazione e clausole scaricate non chiudono il trasferimento. |

La durata della conservazione clinica, le limitazioni dei diritti e la base
sanitaria nazionale sono **decisioni aperte**: questo dossier UE non esamina
l'intero ordinamento italiano. Il parametro `keep-last-N` non stabilisce un
periodo legale. Non si richiedono né si inseriscono dati identificativi per
preparare i template tecnici.

## 5. Matrice AI Act

Versione **A** = A1, consolidato `20260727 / 001.001` modificato da A2.
Si valuta il sistema e la funzione, non il solo modello né la parola AI nel
nome del componente. I quattro percorsi generativi E6 sono candidati concreti
allo screening; parser deterministici, ricerca, OCR e dettatura vanno descritti
per il loro funzionamento effettivo e non classificati dal solo catalogo Fabric.

### Controlli tecnici e dossier del sistema

| ID | Obbligo / criterio | Fonte | Versione | Data | Ruolo applicabile | Controllo T | Evidenza repo | Gap / delta verificabile |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AT1 | Perimetro, definizione e ruolo | A1 artt. 2, 3; C2 | A | D-L | Possibile provider/deployer; da accertare | Registro per sistema, finalità, utenti, output e distribuzione | E1, E6, E7 | Distinguere chi sviluppa/immette/mette in servizio sotto il proprio nome e chi usa. Licenza MIT, gratuità e funzionamento locale non provano esenzione: art. 2(12) mantiene i casi alto rischio, art. 5 o art. 50. |
| AT2 | Screening dell'alto rischio | A1 art. 6, allegati I/III; C5 | A | D-H, salvezza art. 6(5) | Provider; deployer per il proprio uso | Scheda motivata per funzione e possibile uso | E1, E7 | Verificare art. 6(1) con entrambe le condizioni e screening MDR sotto; allegato III punto 5(a) per accesso a servizi essenziali e 5(d) per emergenze/triage. Non assimilare automaticamente promemoria o sintesi a questi usi. |
| AT3 | Pratiche vietate | A1 art. 5; C1 | A | D-L; nuovi casi D-N | Operatori nei rispettivi atti di immissione, servizio o uso | Screening dei casi d'uso e limitazioni del prodotto | E1/E6 non descrivono tali finalità | Documentare il confronto con il catalogo aggiornato. Non è stata eseguita una verifica completa del comportamento; non dichiarare assenza universale di pratiche vietate. |
| AT4 | Informare dell'interazione AI | A1 art. 50(1), (5); C4 | A | D-A | Provider del sistema interattivo | Indicazione chiara al primo contatto, accessibile | E6/E8: stato e inventario; nessuna prova UI corrente | Verificare ciascuno dei quattro percorsi e le superfici native/headless pertinenti con dati sintetici. Anche il professionista è una persona fisica; non presumere che l'interazione sia ovvia. |
| AT5 | Marcatura dei contenuti generati | A1 artt. 50(2), 111(4); C4 | A | D-M | Provider del sistema generativo | Marcatura leggibile da macchina, rilevabilità e conservazione nei passaggi pertinenti | E6/E7: schema, provenienza e receipt | **Prova mancante** di una soluzione che soddisfi art. 50(2) per output, persistenza ed export. Una receipt interna o etichetta visiva non basta come prova. Valutare l'eccezione per editing standard/semantica non sostanzialmente alterata per funzione, non per l'intero prodotto. |
| AT6 | Requisiti tecnici del sistema ad alto rischio | A1 artt. 9–15, allegato IV; C1 | A | D-H, condizionale | Provider del sistema qualificato | Rischi, dati, documentazione, log, istruzioni, supervisione, accuratezza e robustezza | E2/E6/E7 sono componenti utili | Dossier per intended purpose con metriche, popolazioni/lingue, errori, limiti e monitoraggio. `available_unqualified`, schema valido e kill-switch non provano performance né copertura di questi requisiti. |

L'art. 6(3) non è un'esenzione generale per software assistivo: concerne i
sistemi dell'allegato III e richiede una valutazione motivata; il profiling
mantiene l'alto rischio in quel perimetro. Le condizioni degli artt. 6(4) e
49(2) vanno considerate nell'eventuale percorso di esclusione. Nessuna
valutazione o registrazione è stata effettuata da questa lane.

### Adempimenti per provider e deployer

| ID | Obbligo / criterio | Fonte | Versione | Data | Ruolo applicabile | Controllo O | Evidenza repo | Gap / decisione competente |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AO1 | Misure a sostegno della literacy | A1 art. 4; C3 | A | D-L, testo aggiornato 27/07/2026 | Provider / deployer rientranti nel campo della norma | Iniziative commisurate a persone, strumenti e contesto | E1/E9: istruzioni e limiti di prodotto | Preparare modulo su fonti, allucinazioni, automazione, dati sanitari, arresto e segnalazione, con registro vuoto delle iniziative. Non è imposto un certificato, una nuova carica o la garanzia di un livello individuale specifico. Erogazione non osservata. |
| AO2 | Uso e supervisione di sistemi ad alto rischio | A1 art. 26 | A | D-H, condizionale | Deployer del sistema qualificato | Persone competenti con autorità effettiva, uso secondo istruzioni, monitoraggio e log | E6/E7: proposta separata dall'apply | Definire compiti e gestione degli incidenti; verificare log sotto controllo del deployer, incluso il minimo previsto dall'art. 26(6) salvo altra legge applicabile. Non adottare una retention uniforme per tutti gli audit. |
| AO3 | Valutazione d'impatto sui diritti fondamentali | A1 art. 27 | A | D-H, prima dell'uso pertinente | Deployer ex art. 27: organismi di diritto pubblico, privati che prestano servizi pubblici, oppure usi allegato III 5(b)/(c) | FRIA quando ricorrono sistema e ruolo previsti | Nessuna FRIA adottata osservata | Riguarda art. 6(2), escluso allegato III punto 2; non deriva automaticamente dal solo uso sanitario/MDR. Raccordare con DPIA senza considerarle intercambiabili. |
| AO4 | Governance e ciclo di vita del sistema ad alto rischio | A1 artt. 16–21, 43, 47–49, 72–73, 86, 111/113 | A | D-H per artt. 16–21; altre disposizioni D-A con raccordo temporale da revisionare | Provider; deployer per gli obblighi pertinenti | Sistema qualità, dossier, percorso di valutazione, registrazione, monitoraggio e gestione incidenti/diritti | E8/E9 non costituiscono fascicolo di conformità | Dopo la qualificazione, enumerare gli adempimenti e le date per articolo. Nessuna dichiarazione UE, marcatura CE, registrazione o esclusione temporale dedotta dai test. |
| AO5 | Catena del modello e modifiche del sistema | A1 artt. 3, 25, 53–55, 111; C1 | A | D-P per GPAI; D-H per art. 25; transizioni condizionali | Provider del modello GPAI distinto dal provider del sistema e dal deployer | Distinta modelli/licenze/versioni, documentazione ricevuta, log delle modifiche | E6: modelli locali e provider nominati, readiness limitata | Integrare un modello non rende automaticamente provider di quel modello. Accertare eventuale sviluppo/modifica e fornitura sotto il proprio nome; mantenere prova delle date di immissione/servizio e delle modifiche. Nessun beneficio transitorio presunto. |
| AO6 | Trattamento eccezionale per rilevare/correggere bias | A1 art. 4a | A | Testo vigente dal 27/07/2026; condizionale | Provider/deployer nei casi dell'articolo | Valutazione separata di necessità e salvaguardie | Fixture sintetiche richieste da SECURITY; nessun trattamento reale esaminato | L'art. 4a non autorizza addestramento o riuso clinico generale e il par. 2 non impone questa attività. Non raccogliere dati speciali per colmare il dossier; mantenere aperta l'eventuale valutazione dedicata. |
| AO7 | Disclosure per contenuti/usi specifici | A1 art. 50(3)–(5); C4 | A | D-A, condizionale | Deployer degli usi indicati | Verifica di biometria/emozioni, deepfake o pubblicazione di testo su temi d'interesse pubblico | E1/E6 descrivono lavoro sulla cartella; non provano questi altri usi | Una nota clinica privata non equivale a pubblicazione al pubblico. L'eccezione di review editoriale dell'art. 50(4) non elimina la marcatura del provider ex 50(2). Sito/pubblicazioni e usi futuri richiedono esame dedicato. |

### Confine dispositivo medico: screening motivato, nessuna classe assegnata

| Obbligo / criterio | Fonte | Versione | Data | Ruolo applicabile | Controllo | Evidenza repo | Gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Qualificazione della singola funzione rispetto alla finalità medica; classificazione solo dopo qualificazione | M1 artt. 2(1), 2(12), 52, allegato VIII regola 11; M2; A1 art. 6(1) | M1 19/07/2026; M2 rev.1 giugno 2025; A | MDR: verificare prima dell'immissione/servizio pertinente; AI: D-H se art. 6(1) | Eventuale fabbricante/provider da individuare, nessuna attribuzione qui | Confronto fra finalità dichiarata, istruzioni, output e decisione influenzata | E1: workbench assistivo; E7: raccomandazioni e proposte terapia/diagnosi | **Gate aperto.** Preparare scheda specifica Treatment Reasoning e riesaminare altre funzioni se influenzano decisioni diagnostiche/terapeutiche. |

L'inferenza della lane è limitata: E7 giustifica questo screening. La gestione
e consultazione di una cartella non bastano da sole a qualificare un dispositivo;
un modulo che fornisce informazioni per decisioni diagnostiche o terapeutiche
richiede invece confronto con M1/M2. La revisione del medico, il divieto di
scrittura automatica e il nome workbench non risolvono il quesito.
Non si assegna classe I/IIa/IIb/III e non si presume un'esenzione in-house.
L'eventuale percorso AI ad alto rischio ex art. 6(1) richiede anche il
presupposto della valutazione di conformità da parte di terzi, non il solo
contesto sanitario. Il rinvio AI non sospende eventuali obblighi MDR.

## 6. Delta che il parent può preparare senza inventare autorità

Gli interventi seguenti sono proposte per le lane autorizzate del parent;
il seguito tecnico locale su P2/P9 è descritto in §6.1. Nessun gap legale diventa chiuso solo perché
è stato scritto un template o perché un test è verde.

| Delta / collegamento | Risultato preparabile | Verifica di accettazione proposta | Decisione o prova che resta esterna |
| --- | --- | --- | --- |
| P1 — GT1/GT2/GO10, WUL-686 | Inventario tecnico di categorie, persistenze, copie, destinatari possibili e copertura della cifratura | Ogni voce rinvia a un writer/export e alla misura pertinente; includere client paired, allegati, derivati, backup, audit e provider opzionali | Configurazione reale, accessi, protezione disco e adeguatezza rispetto al rischio |
| P2 — GT3/GT4/GO7, WUL-686 | Matrice di completezza dell'export e procedura di accesso/rettifica; colmare solo le lacune confermate | Fixture sintetica con dati in ogni categoria; confronto di contenuti e omissioni esplicite, verifica della correzione e dei derivati | Identità del richiedente, limiti e decisione sulla richiesta concreta |
| P3 — GT5/GT7, WUL-686 | Runbook erasure/restore e mappa delle copie esterne; manifest tecnico del drill sul candidato | Purge del grafo live e restore su ambiente sintetico; provare la gestione di record già cancellati prima di riprendere l'uso | Periodi legali, eventuale conservazione obbligatoria e gestione effettiva delle copie |
| P4 — GT6, WUL-686 | Specifica della limitazione di trattamento, con soluzione procedurale o controllo dedicato da valutare | Coprire lettura autorizzata, scrittura, AI, export e paired; documentare ciò che non può essere bloccato | Presupposti, eccezioni e autorizzazione alla ripresa; nuovo ADR se cambia il contratto |
| P5 — AT4/AT5, WUL-687 | Inventario delle disclosure e della provenienza degli output; proposta tecnica per la marcatura ex 50(2) | Esempi sintetici nei quattro flussi e nei passaggi di persistenza/export; verificare leggibilità umana e rilevabilità da macchina separatamente | Applicabilità/deroghe per funzione e adeguatezza della soluzione rispetto allo stato dell'arte |
| P6 — AT1/AT2/E7, WUL-685/688 | Scheda funzione → intended purpose → persone coinvolte → decisione influenzata → input/output → modello → limiti | Ogni campo fattuale ha un riferimento a sorgente/contratto; includere Treatment Reasoning e distinguere sistema/modello | Identità giuridiche, ruoli, qualificazione MDR e classificazione AI |
| P7 — AO1/GO3/GO4/GO5/GO9, WUL-686/687 | Template distinti per informative, registro, screening DPIA, incidenti e literacy; materiale formativo sintetico | Stato `template`, campi da compilare visibili, nessuna firma/nomina o base giuridica preseletta; scenario tabletop senza dati reali | Adozione, istruzioni, formazione effettiva, DPIA/consultazione e decisioni incidenti |
| P8 — AT6/AO2/AO4, WUL-687/688 | Indice delle evidenze per accuratezza, supervisione, log, rischi e ciclo di vita; distinguere disponibilità da qualifica | Metriche e soglie dichiarate per funzione, versione e popolazione prima delle prove; nessun risultato clinico estrapolato da fixture | Validazione pertinente all'uso, sistema qualità e adempimenti condizionali dopo qualificazione |
| P9 — E8/fonti, WUL-685/688 | Aggiornare nel parent i riferimenti normativi dell'inventario e i relativi test; integrare il nuovo Markdown negli indici globali | Conservare `legalVerdict: not_assessed`; separare versione normativa, data ricerca e receipt del candidato | Adozione del dossier da parte del revisore competente; nessun badge di conformità |

Questo file e i piccoli raccordi in COMPLIANCE/privacy sono documentazione
candidata. Gli indici globali restano al parent per espressa delimitazione
della lane; nessun loro aggiornamento è incluso nella patch.

### 6.1. Seguito tecnico P2/P9: copertura osservata e correzione circoscritta

**P9:** E8 ora rinvia ai consolidati G1/A1 tramite CELEX versionato e a C1;
le etichette distinguono data del testo e consultazione del 06/09/2026.
Restano `not_assessed`, schema v1 e inventario statico. Le due eccezioni URL
già dedicate all'inventario nel [guard](../../scripts/never-regress-allowlist.mjs)
sono limitate ai tre riferimenti; il test verifica anche il rifiuto di URL o
file diversi. Nessuna richiesta di rete è introdotta nell'inventario.

**P2:** confronto fra [ADR 0081](../adr/0081-fhir-r4-export-v0-contract.md),
mapper/generator FHIR e [report PDF](../../lib/report-service.ts).
I test riusano in sola lettura il [golden sintetico v1](../../native/contracts/fhir-golden-input.v1.json)
e la fixture PDF esistente. Quest'ultima ora contiene 31 voci per verificare
il limite di 30. Le assenze fuori DTO/argomenti derivano dalla lettura del
contratto e dei consumer, senza inventare fixture per categorie non accettate.

| Categoria | FHIR v0 effettivo | PDF effettivo | Evidenza / limite |
| --- | --- | --- | --- |
| Identità, codice fiscale, nascita, indirizzo, telefono | Campi selezionati di `Patient` | Anagrafica della scheda | Golden/test mapper; fixture/test PDF e sorgente. Nessun dossier anagrafico completo. |
| Caregiver, profilo e note globali | Il mapper legacy include caregiver; profilo/note assenti | Caregiver, profilo e note presenti | Sorgenti; test PDF sui campi e sulla sezione note. ADR v2 esclude caregiver: debito già dichiarato, non nuova copertura. |
| Diagnosi | `Condition`: codice/testo, con semantica temporale legacy | Sistema, codice, descrizione, data | Test mapper/PDF; `onsetDateTime` e stato implicito restano debito ADR v2. |
| Diario: date/tipo e testo | `Encounter` per voce non eliminata; testo/titolo ordinari assenti | Testo semplice delle prime 30 voci ricevute, escluse scale e voci eliminate | Test mapper sulle omissioni e tombstone; test PDF confronta tutte le 30 righe. Il limite PDF non viene rimosso. |
| Terapie | Farmaco testuale, stato, dose, periodo, motivazione; fixture attiva/sospesa conservata | Solo terapie attive, dose, principio attivo e motivazione | Test mapper/PDF; completate escluse dal PDF. Nessuna nuova storia terapeutica PDF. |
| Scale | `Observation` con punteggio numerico, data e nota | Scale ricevute dal chiamante, punteggio e interpretazione | Test mapper/adapter/PDF, incluso zero. Encounter aggiuntivo legacy e validazione int32 restano debito v2. |
| Osservazioni strutturate | Codice, valore numerico, unità e nota; il sorgente legacy ammette anche `valueString` | Codice, valore, unità, data e nota | Test mapper/PDF sui valori; `valueString` e validazione terminologica restano debito v2. |
| Checkup, esenzioni | Assenti dal Bundle; il generator legge ancora checkup | Assenti | Test mapper e lettura dei consumer. Esclusi dall'ADR v0; rimuovere la lettura checkup appartiene alla migrazione. |
| Allegati, documenti, derivati AI, audit | Nessun mapping nel DTO v1 | Nessun parametro/sezione dedicata | Solo evidenza statica. Il testo già salvato nel diario può comparire nel PDF, senza provenienza AI strutturata. Non aggiungere risorse o sezioni senza decisione di contratto. |
| Copie e backup | Non coperti dal Bundle paziente | Non coperti dalla scheda PDF | P3 resta separato; nessun drill o prova di completezza delle copie in questo seguito. |
| Istante di generazione | **Corretto:** `Bundle.timestamp` usa `generatedAt` già disponibile | Data/ora di generazione già renderizzate | Test di regressione FHIR fallito prima del fix, passato con stringa con offset e oggetto `Date`, anche dopo serializzazione JSON. |

Il fix runtime è una sola proprietà del Bundle, prevista da ADR 0081: non
cambia DTO, route o categorie. Il golden v1 resta storico e invariato; nessuna
parità Apple/v2 è attestata. `Patient.meta.lastUpdated` usa ancora l'istante
di export: non è prova dell'ultimo aggiornamento clinico. Restano inoltre
UUID/ordinamento, filtri lifecycle di paziente/terapie/osservazioni e controlli
semantici della migrazione v2. Questi debiti non sono risolti dal timestamp.
GT3 (rettifica e derivati) e la completezza della risposta ex GT4/GO7 restano
aperti; le esclusioni dei due export non autorizzano a escludere le stesse
categorie dalla valutazione di una richiesta concreta.

## 7. Gate di revisione competente e consegna

Per promuovere un dossier WUL-688 servono almeno:

1. Perimetro del candidato esatto, funzioni abilitate e scenario d'impiego;
   provenienza delle evidenze e date di immissione/servizio se rilevanti.
2. Decisione motivata su ruoli, finalità/basi, classificazione AI ed eventuale
   qualificazione MDR, con gestione dei quesiti nazionali ancora aperti.
3. Prove tecniche collegate alle righe applicabili e documenti organizzativi
   effettivamente adottati, distinti dai template; nessun gap applicabile
   mascherato come non applicabilità.
4. Revisione competente identificata e registrata nel luogo autorizzato,
   con conclusione, limiti e condizioni di riesame. Nessun nominativo, firma
   o nomina viene inserito da questa lane.

Il dossier tecnico può avanzare con P1–P9 mentre queste decisioni restano
aperte. **Il gate di conformità della sezione 7 della roadmap resta aperto**;
una PR o un commit della documentazione non lo chiuderebbero.

### Verifiche della prima fase documentale

Ispezioni eseguite: `git status --short`, `git branch --show-current`,
`git rev-parse HEAD`, letture mirate con `sed`/`rg` e ricerca Markdown tracciata
con `git grep`. Ricerca ufficiale online mediante selettori EUR-Lex, atto
modificativo e pagine Commissione del registro fonti.

Controlli documentali eseguiti:

- `git diff --check`: passato sui documenti tracciati modificati; il controllo
  viene ripetuto sul diff staged per includere il nuovo documento.
- `rg --files -g '*.md' | sort`: inventario di 212 file Markdown nel worktree.
- `npm run check:claims`: passato, 565 file esaminati e zero claim segnalati.
  Il guard include COMPLIANCE nelle proprie radici esplicite; questa nuova
  analisi e la guida privacy sono state rilette manualmente, senza attribuire
  loro copertura automatica da quel risultato.
- Verifica locale Python dei tre documenti: 41 collegamenti locali risolti
  verso file tracciati o verso la nuova analisi; numero di colonne coerente
  in tutte le tabelle. Nessuna dipendenza aggiunta o connessione dal controllo.

Il commit documentale è `c10b21a24c3763ea9b58b47ff224b9fdc506b94b`.
In questa prima fase non sono stati eseguiti test runtime, drill, UI, chiamate
ai provider o CI remota. Il seguito tecnico autorizzato aggiunge i controlli
seguenti e i soli messaggi di coordinamento al parent sui file e sulla consegna.

### Verifiche del seguito tecnico WUL-686/687

Node **24.19.0**, dipendenze clonate in modo indipendente con `cp -cR` dalla
checkout primaria; SHA-256 del lockfile identico:
`f4ae5e9e1bc78b74f7856f2a8e701d6d327c8c44ada729b738c7e55f983e4b93`.
Baseline: 34/34 test (inventario, FHIR, report e suite PDF-service esistente).
Prima dei fix: falliscono il controllo dei vecchi URL e quello del timestamp
assente; dopo i fix la suite mirata passa **18/18**, senza skip.

Comandi eseguiti nel worktree, con Node 24 nel `PATH`:

```bash
export PATH="/Users/leonardopegollo/.nvm/versions/node/v24.19.0/bin:$PATH"
node scripts/run-strip-types.mjs --test lib/compliance-evidence-inventory.test.ts lib/fhir/bundle-mapper.test.ts lib/fhir/clinical-adapter.test.ts lib/fhir/id.test.ts lib/report-service.test.ts
npm run lint
npm run typecheck
npm run check:claims
npm run check:never-regress
export NEXT_TELEMETRY_DISABLED=1
export MEDIFLOW_DATA_DIR="$(mktemp -d /tmp/mediflow-wul686-build.XXXXXX)"
npm run build
git diff --check
```

Lint, typecheck, claims e never-regress passano. Build e postbuild passano
(111 pagine statiche; controllo standalone Node 24.19.0/ABI 137), con cinque
warning Turbopack di tracing del filesystem, fuori dai file runtime modificati.
L'export PDF è verificato tramite il recorder jsPDF già nei test, non con un
file PDF renderizzato. Nessun server clinico avviato, E2E/UI, gate HL7, prova
di parità native, drill, provider o CI remota in questo seguito. I risultati
sono locali e non attestano integrazione, chiusura dei ticket o conformità.
Controllo documentale Python: 34 collegamenti locali risolti e 102 righe di
tabella con colonne coerenti; inventario di 212 Markdown. Il diff comprende
solo i sette file comunicati al parent, senza nuovi Markdown o indici globali.

Per identificare il commit del documento senza inserirvi uno SHA autoreferenziale:

```bash
git log -1 --format='%H %s' -- docs/analysis/2026-09-06-086-regulatory-evidence.md
```

## Schede operative candidate per i due contesti

Queste schede sono moduli di lavoro non adottati, da duplicare e compilare
separatamente per **A — attività autonoma** e **B — incarico per una struttura**.
Sono precompilati solo i fatti riportati nel raccordo del 23 settembre; i campi
non documentati restano esplicitamente da definire/confermare. Nessuna scheda è
un'informativa consegnabile, una decisione sulla necessità di DPIA o una prova
di conformità. In particolare B resta da concordare con la struttura; i due
contesti richiedono archivi, esportazioni, backup, sessioni e configurazioni
provider separati. Fonte dei campi e dei limiti: §3–4, §6 P1–P4/P7 sopra.

### 1. Registro operativo dei trattamenti — compilare A e B separatamente

| Campo | A — professionista autonomo | B — struttura su Mac |
| --- | --- | --- |
| Contesto e titolarità | Attività autonoma; titolare/ruolo effettivo: **da definire/confermare per attività e finalità** | Incarico della struttura; titolare, ruoli e istruzioni: **da concordare con la struttura** |
| Finalità e presupposti | **Da definire/confermare per ciascun uso**, compreso ogni uso AI | **Da concordare con il titolare** per ciascun uso; non ereditare le finalità di A |
| Interessati e categorie di dati | Assistiti e categorie effettive: **da definire/confermare** | Interessati e categorie conferite: **da concordare/confermare** |
| Destinatari e ruoli | Destinatari, responsabili e autorizzati: **da definire/confermare** | Struttura, autorizzati, responsabili/sub-responsabili: **da documentare secondo istruzioni** |
| Mac, archivio e accessi | Mac dell’utente; directory, sessioni, accessi e configurazione reale: **da verificare** | Mac individuale; autorizzazione, archivio, accessi e istruzioni: **da concordare e verificare** |
| Copie e trasferimenti | Elencare archivio, documenti, derivati, export, cache, sessioni, backup e destinatari/trasferimenti: **inventario da compilare** | Stesso inventario, separato da A; proprietario di ciascuna copia e autorizzazione: **da concordare** |
| AI esterna e conservazione | Solo canale remoto indicato: **OpenAI via ChatGPT OAuth**; piano/workspace, termini, retention, uso dati, destinatari e trasferimenti: **non identificati/da verificare** | Stesso solo canale selezionato; uso per dati della struttura e relative istruzioni/autorizzazioni: **da concordare**; piano/workspace non identificato |
| Durata e cancellazione | Durata clinica, criteri, eccezioni e cancellazione delle copie: **da definire/confermare**; `keep-last-N` è solo retention tecnica dei backup scheduler | Durate/istruzioni del titolare, eccezioni, copie e cancellazione: **da concordare**; nessun periodo dedotto dal backup scheduler |
| Sicurezza e misure | Misure applicate a ogni copia, accesso e provider: **da verificare sul deployment** | Misure richieste dalla struttura e prova sul Mac/copie: **da concordare e verificare** |
| Diritti e richieste | Procedura, referente, verifica proporzionata dell’identità e risposta tracciata: **da definire** | Canale, referente della struttura, escalation e risposta: **da concordare** |
| Registro delle copie per diritti/retention | Per ogni copia: supporto/percorso, contenuto, owner, destinatari, backup/export, retention, cancellazione, restore e verifica: **compilare senza dati identificativi in questo dossier** | Stessi campi, compilati separatamente; owner/istruzioni della struttura e prova di riconciliazione dopo restore: **da concordare** |
| Decisioni e approvazioni | Decisioni sulle finalità, misure e retention: **da registrare nel dossier autorizzato** | Istruzioni e autorizzazioni della struttura: **da acquisire nel dossier autorizzato** |

Il Bundle FHIR e gli altri export sono supporti parziali, non una risposta completa
a una richiesta. Un restore può reintrodurre record cancellati: documentare la
riconciliazione prima dell'eventuale ripresa d'uso. Per ciascuna richiesta
registrare riferimento non identificativo, data/canale, verifica identità,
diritti richiesti, copie cercate, valutazione/limiti, decisione, responsabile,
risposta e completamento: **procedura concreta da definire per A e concordare
per B**.

### 2. Scheda dati per predisporre l’informativa — due bozze non consegnabili

**Stato per A e B: BOZZA — NON CONSEGNABILE finché i campi applicabili non sono
risolti, verificati e approvati dal soggetto competente.** Duplicare la scheda;
non copiare titolarità, contatti o basi da un contesto all’altro.

| Campo da valorizzare | A — autonomo | B — struttura |
| --- | --- | --- |
| Titolare e ruolo effettivo | Da definire/confermare | Da concordare/confermare con la struttura |
| Contatti del titolare e del referente | Da definire/confermare | Da concordare; canale/referente della struttura non forniti |
| Finalità e base per ciascuna finalità | Da valutare e confermare per uso | Da concordare con il titolare; non preselezionare |
| Categorie di dati e interessati | Da verificare rispetto al trattamento concreto | Da concordare rispetto all’incarico |
| Destinatari, ruoli e trasferimenti | Da verificare; OpenAI via ChatGPT OAuth è l’unico provider esterno selezionato, condizioni non identificate | Da concordare; non attestare l’autorizzazione AI o trasferimenti |
| Durata/criteri di conservazione e copie | Da definire, incluse copie ed eccezioni | Da concordare con la struttura, incluse copie ed eccezioni |
| Diritti, modalità e limiti | Da completare per accesso, rettifica, limitazione, opposizione, cancellazione e portabilità; limiti da verificare | Da concordare canale, referente, limiti e gestione con il titolare |
| Reclamo e autorità di controllo | Da verificare e completare | Da confermare nel contesto della struttura |
| Conferimento dei dati e conseguenze | Da definire per ciascuna raccolta/finalità | Da concordare con la struttura per ciascun flusso |
| Decisioni automatizzate/profilazione | Accertare il flusso concreto e valorizzare; non dedurre dal solo controllo umano | Accertare il flusso concreto autorizzato e valorizzare |
| Fonte indiretta e modalità/tempi informativi | Da completare quando pertinenti | Da concordare quando pertinenti |
| Prova di revisione, approvazione e consegna | Nessuna prova raccolta; compilare nel dossier autorizzato | Nessuna prova raccolta; approvazione/consegna da concordare |

### 3. Screening DPIA — esito da decidere, nessuna risposta precompilata

Compilare uno screening per ciascun contesto e configurazione concreta. Le
risposte e l’esito restano **da valutare**; non precompilare “NO” né considerare
il funzionamento locale o il numero di postazioni decisivo.

| Domanda / elemento | A — autonomo | B — struttura |
| --- | --- | --- |
| Titolare, finalità, ruoli e configurazione valutata | Da definire/confermare | Da concordare/confermare |
| Natura, categorie di dati e persone interessate/vulnerabili | Da valutare e motivare | Da valutare con il titolare e motivare |
| Scala: soggetti, volume, frequenza, durata e ampiezza | Da raccogliere/verificare | Da raccogliere/verificare con la struttura |
| Tecnologia e flussi, incluse copie, export e backup | Da mappare per la configurazione reale | Da mappare separatamente secondo istruzioni |
| AI remota, payload, destinatari, account/condizioni e retention | OpenAI via ChatGPT OAuth selezionato; piano/condizioni ignoti; valutare se e come entra nel trattamento | Istruzioni/autorizzazione mancanti; valutazione sospesa sui fatti organizzativi |
| Rischi per diritti e libertà, probabilità e gravità | Da identificare e motivare | Da identificare con il contesto della struttura |
| Misure esistenti, lacune e mitigazioni proposte | Da documentare con evidenze deployment | Da concordare, attribuire e verificare |
| Rischio residuo e accettazione/escalation | Da decidere e attribuire al ruolo competente | Da decidere dal ruolo competente della struttura |
| Esito: DPIA necessaria? consultazione preventiva? | **Da decidere; nessun esito preselezionato** | **Da decidere; nessun esito preselezionato** |
| Responsabile, revisore/DPO se designato, data e riesame | Da identificare; nessuna nomina presunta | Da concordare; nessuna nomina presunta |

### 4. Procedura e registro incidenti; richieste, copie e restore

**Procedura candidata da revisionare e adattare separatamente.** In caso di
segnalazione: interrompere o contenere il flusso interessato senza cancellare
prove; conservare evidenze controllate e minimizzate; avvisare il responsabile/
titolare secondo i ruoli e le istruzioni; valutare il caso secondo GDPR artt.
33/34 e registrare anche gli eventi non notificati; ripristinare il flusso solo
dopo le verifiche e l’autorizzazione previste per quel contesto.

La [guida del Garante sui data breach](https://www.garanteprivacy.it/data-breach),
riletta il 23 settembre 2026, indica per il titolare la notifica senza ritardo
ingiustificato e, ove possibile, entro 72 ore dalla conoscenza, salvo che sia
improbabile un rischio per i diritti e le libertà. Documentare la valutazione e
l’eventuale ritardo: le 72 ore non sono un tempo da attendere. Chi tratta per
conto del titolare deve informarlo tempestivamente, secondo il ruolo effettivo
e le istruzioni ricevute. Per il rischio elevato valutare anche la comunicazione
agli interessati e le condizioni/eccezioni dell’art. 34. La
[guida EDPB](https://www.edpb.europa.eu/sme/assess-the-risks/data-breaches_en)
chiarisce che informazioni ancora incomplete possono essere integrate per fasi:
la raccolta delle evidenze non giustifica un rinvio indiscriminato.
Nel modulo registrare l’istante della conoscenza, il responsabile della
valutazione, i destinatari e la motivazione di ogni decisione.

Campi del registro (riferimento non identificativo; conservare i dettagli
necessari solo nel dossier autorizzato): contesto A/B; data/ora rilevazione;
segnalante e canale; descrizione minima; sistemi/copie/provider coinvolti;
contenimento; evidenze e accessi; categorie e stima degli interessati/dati;
valutazione del rischio e motivazione; persone avvisate e tempi; decisione
artt. 33/34, motivazione e responsabile; notifiche/comunicazioni o ragione della
mancata notifica; azioni correttive; verifica di restore/riconciliazione; criterio
e autorizzazione alla ripresa; chiusura e riesame. Tutti i campi di evento reale
sono **da compilare quando applicabili**; non inserire esempi o firme fittizie.

Per diritti, cancellazione e restore, allegare al record dell’evento/request la
mappa di **tutte** le copie e gli export/backup, con proprietario e prova di
ricerca; tipo di richiesta e riferimento non identificativo; verifica
proporzionata dell’identità; base e limiti da valutare; decisioni e istruzioni;
risposta tracciata; copie cancellate o preservate e ragione; riconciliazione dei
record cancellati dopo un restore; verifiche e autorizzazione prima di riprendere
l’uso. Tempi, eccezioni e conservazione clinica restano da definire/confermare
per A e da concordare con la struttura per B. Le segnalazioni di vulnerabilità
in `SECURITY.md` non costituiscono questa procedura di violazione di dati
personali.

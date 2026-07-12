---
summary: "EHR and provider-software scouting behind Lume's attention grammar: three GPT-5.6 lanes (US advanced apps, GP vendors worldwide, open health design systems), adopted patterns and rejections."
read_when:
  - "Refining the attention grammar, worklist, provenance, or safety rules of Lume."
  - "Checking what the GP/EHR market does and where MediFlow's competitive white space is."
---

# La perlustrazione

Metodo (2026-07-12, dopo ADR 0078): tre lane di ricerca web GPT-5.6 Terra via Codex CLI (S1 e S2 a effort high, S3 medium, sola lettura), su prompt di Fable; sintesi e integrazione nella specifica di Fable. Obiettivo: applicativi avanzati per provider USA, gestionali per general practitioner con UI pubbliche, e fonti aperte (design system sanitari, evidenza di usabilità) da cui derivare interfacce.

## 1. Cosa hanno trovato le lane

### S1: applicativi avanzati USA

I riferimenti più forti: **Navina** (Patient Portrait: sintesi orientata ai problemi con evidenza cliccabile per ogni inferenza), **Aidoc/Viz.ai** (un alert vero cambia la coda di lavoro e propone azione e team, non colora una riga), **Canvas Medical** (charting a comandi keyboard-first: modificabile, committed, entered-in-error come stati espliciti; nulla parte finché non è commit), **Freed** (la nota al centro, navigazione che sparisce), **Zus** (overview come indice clinico con drill-down laterale e provenienza), **Cedar** (spiegare il vincolo prima di chiedere l'azione), **Medplum** (primitive componibili prima del dashboard monolitico). Anti-pattern: alert senza coda né owner; contenuto generato che sembra un fatto clinico; cockpit unico e indistinto. Fonti nel rapporto di lane (URL inline, tra cui [Navina](https://www.navina.ai/core-technology), [Aidoc](https://www.aidoc.com/solutions/radiology/), [Canvas](https://help.canvasmedical.com/articles/4129367510-commands-introduction), [Zus](https://clinicalguide.zushealth.com/docs/the-zap-overview)).

### S2: gestionali GP nel mondo

I cinque con la UI più moderna: **Doctolib Médecin** (continuità agenda-dossier: il click sullo slot apre il dossier contestualizzato), **Elation** (Clinical Profile persistente a sinistra, cronologia e azioni al centro: la cartella come superficie di lavoro), **Akute** (trend longitudinali come primitive centrali), **Healthie**, **athenaOne**. Standard italiano (Millewin, Medico 2000): profondità normativa e prescrittiva alta, linguaggio visivo datato, densità senza gerarchia: è il contesto competitivo locale di MediFlow. Anti-pattern ricorrenti: agenda/cartella/prescrizione come mondi separati; dashboard di widget invece di una coda decisionale; modali in cascata; timeline come discarica cronologica. Fonti inline nel rapporto ([Elation](https://help.elationhealth.com/s/topic/0TO1G0000008q3WWAQ/patient-chart), [Doctolib](https://info.doctolib.fr/solution/solutions-cliniques/), [Medico 2000](https://www.mediatec.it/pages/page.php?content=schermateV6)).

### S3: fonti aperte ed evidenza

**NHS design system** (pattern check-answers, warning callout, ricerca pubblicata sugli expander per ridurre il sovraccarico), **VA.gov** (stati sempre evidenti, "nessun vicolo cieco" come criterio di release), **USWDS** (form verticali, errori accanto al campo, niente disabled opachi), **GoInvo** (hGraph e hRecord: overview multi-dominio con drill-down), **Medplum/OpenMRS** (primitive FHIR e shell modulare), **sicurezza clinica** (DCB0129/0160: la UI come controllo di rischio con hazard log; ONC SAFER: header paziente verificabile, niente identificativi completi su superfici esposte), **evidenza recente** (il tempo inbox dei medici di base cresce: +24% tra 2019 e 2023; alert fatigue contestuale; interrompere raramente e personalizzare). Fonti inline ([NHS](https://service-manual.nhs.uk/design-system/index), [VA](https://design.va.gov/), [SAFER](https://healthit.gov/clinical-quality-and-safety/safer-guides/), [Arndt 2024](https://pubmed.ncbi.nlm.nih.gov/38253499/)).

## 2. Cosa entra in Lume (integrazioni normative alla specifica)

Queste regole sono parte della lingua: [01-lingua.md](./01-lingua.md) le incorpora nella grammatica dell'attenzione e nel filo.

1. **L'agenda è la porta del lavoro.** Il click su una voce di worklist/agenda apre il contesto già montato (Quadro), mai un modulo separato. (Doctolib, Elation)
2. **La colonna dell'attenzione è una coda decisionale, non un feed**: ogni voce dichiara perché è lì, chi la possiede, se è delegabile, entro quando. Le voci già valutate non si ripresentano uguali (consolidamento, con audit). (S3: evidenza inbox; S1: Aidoc/Viz)
3. **Doppio binario clinico e amministrativo.** I blocchi amministrativi (rinnovi burocratici, moduli, fatturazione) vivono accanto al contesto clinico ma con registro visivo separato: mai lo stesso colore dei segnali clinici; il binario amministrativo usa il neutro minerale. (S1: Commure/Oscar)
4. **Un segnale cambia la coda o non è un segnale.** Un'urgenza riordina la worklist e propone l'azione; gli avvisi interruttivi si riservano ai rischi urgenti e azionabili. (Aidoc, Viz, evidenza su alert fatigue)
5. **Evidenza a richiesta, sempre.** Ogni inferenza o sintesi apre le sue fonti (documento, data, frammento) con un gesto: è il filo di provenienza reso contratto. (Navina, SmarterDx, Abridge)
6. **Il tratto pieno è il commit.** Niente parte (prescrizione, ordine, invio) finché il medico non firma: il passaggio tratteggiato -> pieno del filo è l'atto esplicito di commit, con gli stati intermedi visibili e l'errore marcato, non cancellato. (Canvas)
7. **Timeline con livelli di sintesi**: il filo del diario si filtra per tipo (visite, esami, prescrizioni, documenti, messaggi) e segnala i cambiamenti, non elenca soltanto. (S2)
8. **Trend come primitive di riga**: vitali e laboratorio si confrontano nella riga (delta, banda personale, mini-storia sul filo), non in un report a parte. (Akute; già anatomia canonica di Lume, qui confermata)
9. **La testata è anche sicurezza**: identità verificabile (data di nascita, identificativo, foto dove appropriato); con contesto paziente incerto le azioni cliniche si bloccano; nessun identificativo completo su superfici esposte (coerente con il privacy shield nativo). (ONC SAFER)
10. **Form verticali, errori accanto al dato, mai disabled opachi**: uno stato disabilitato spiega perché o non esiste. (USWDS, NHS)
11. **Primitive prima dei dashboard**: la libreria Lume si costruisce per primitive (testata, riga di lista, riga di laboratorio, filo, coda, pannello laterale) componibili, non per schermate monolitiche. (Medplum, OpenMRS)
12. **Ogni superficie clinica è un controllo di rischio**: le viste che toccano allergie, prescrizioni, import documenti e contenuti generati mantengono un hazard log leggero e si rivedono dopo ogni modifica rilevante. (DCB0129/0160, NHS service standard)

## 3. Cosa non entra

- **hGraph radiale come superficie primaria**: suggestivo, ma un radar non sostituisce valori, unità, date e drill-down; resta ispirazione per una vista d'insieme opzionale in analytics.
- **Score compositi in prima linea** (età biologica, indici sintetici): il confronto primario resta la baseline personale sul dato, non un numero riassuntivo.
- **Inbox separate per tipo** (una per referti, una per messaggi, una per task): frammentano il triage; la coda è una, con filtri e binari.
- **Dashboard di widget configurabili** come home: il cockpit ha una gerarchia decisa dal dominio, non un cruscotto da comporre.
- **Modali in cascata per operazioni frequenti**: al loro posto pannelli laterali che conservano il contesto (già legge di Lume).

## 4. Lo spazio bianco

La lane S2 lo formula così, e la ricognizione lo conferma: nessun prodotto combina davvero cockpit locale-first, worklist clinico-amministrativa unificata, trend longitudinali leggibili dentro la cartella e un confine review-first esplicito per documenti e contenuti generati. I moderni eccellono nella UX SaaS o nel patient engagement; i profondi (inclusi gli italiani) nella copertura normativa. La combinazione di MediFlow (locale-first, review-first già nel DNA di prodotto) con la grammatica di Lume (fuoco, coda decisionale, filo di provenienza, due voci) occupa esattamente quello spazio: una superficie unica, densa ma calma, che fa emergere ciò che merita attenzione adesso.

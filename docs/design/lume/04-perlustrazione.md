---
summary: "EHR and provider-software scouting behind Lume's attention grammar: three GPT-5.6 lanes (US advanced apps, GP vendors worldwide, open health design systems), adopted patterns and rejections."
read_when:
  - "Refining the attention grammar, worklist, provenance, or safety rules of Lume."
  - "Checking what the GP/EHR market does and where MediFlow's competitive white space is."
---

# La perlustrazione

Dopo ADR 0078, la ricerca del 2026-07-12 ha approfondito tre ambiti dai quali ricavare scelte di interfaccia: applicativi avanzati per i professionisti sanitari USA, gestionali per general practitioner con UI pubbliche e fonti aperte su design sanitario e usabilità. Il lavoro è stato affidato a tre lane web GPT-5.6 Terra via Codex CLI, in sola lettura, con S1 e S2 a effort high e S3 medium. Fable ne ha definito i prompt, curato la sintesi e integrato i risultati nella specifica.

## 1. Cosa hanno trovato le lane

### S1: applicativi avanzati USA

La lane individua riferimenti utili soprattutto nel rapporto fra sintesi e possibilità di agire. **Navina**, con Patient Portrait, organizza i problemi e rende cliccabile l'evidenza di ogni inferenza; **Aidoc/Viz.ai** mostra come un alert debba cambiare la coda, proporre un'azione e un team, anziché limitarsi a colorare una riga. **Canvas Medical** distingue nel charting a comandi keyboard-first gli stati modificabile, committed ed entered-in-error, impedendo l'invio prima del commit. Gli altri riferimenti riguardano la centralità della nota in **Freed**, l'overview come indice clinico con approfondimento laterale e provenienza in **Zus**, la spiegazione del vincolo prima dell'azione in **Cedar** e le primitive componibili di **Medplum**, preferite al dashboard monolitico. Da qui anche ciò che va evitato: alert senza coda o responsabile, contenuti generati indistinguibili dai fatti clinici e cockpit unici ma privi di articolazione. Le fonti sono riportate con URL nel rapporto di lane, fra cui [Navina](https://www.navina.ai/core-technology), [Aidoc](https://www.aidoc.com/solutions/radiology/), [Canvas](https://help.canvasmedical.com/articles/4129367510-commands-introduction) e [Zus](https://clinicalguide.zushealth.com/docs/the-zap-overview).

### S2: gestionali GP nel mondo

La ricognizione seleziona cinque prodotti per la modernità della UI: **Doctolib Médecin**, dove lo slot in agenda apre il dossier nel suo contesto; **Elation**, che mantiene il Clinical Profile a sinistra e porta cronologia e azioni al centro; **Akute**, con i trend longitudinali come elementi di base; **Healthie** e **athenaOne**. Per il mercato italiano, la lane descrive Millewin e Medico 2000 come gestionali di elevata profondità normativa e prescrittiva, ma con un linguaggio visivo datato e una densità poco gerarchizzata. È in questo confronto, non nella sola modernità estetica, che viene collocato MediFlow. I problemi ricorrenti sono la separazione fra agenda, cartella e prescrizione, i dashboard di widget al posto di una coda decisionale, le modali in cascata e le timeline che accumulano eventi senza sintetizzarli. Le fonti inline del rapporto comprendono [Elation](https://help.elationhealth.com/s/topic/0TO1G0000008q3WWAQ/patient-chart), [Doctolib](https://info.doctolib.fr/solution/solutions-cliniques/) e [Medico 2000](https://www.mediatec.it/pages/page.php?content=schermateV6).

### S3: fonti aperte ed evidenza

Le fonti aperte consentono di legare le scelte visive a criteri verificabili. Il **NHS design system** offre check-answers, warning callout e ricerca sugli expander per contenere il sovraccarico; **VA.gov** richiede stati evidenti e assenza di vicoli ciechi come criterio di release; **USWDS** privilegia form verticali, errori accanto al campo e stati disabilitati comprensibili. **GoInvo**, con hGraph e hRecord, esplora overview multi-dominio approfondibili, mentre **Medplum/OpenMRS** fornisce riferimenti per primitive FHIR e shell modulari. Sul piano della **sicurezza clinica**, la ricognizione richiama DCB0129/0160 per trattare la UI come controllo di rischio con hazard log e ONC SAFER per l'identità paziente verificabile, senza identificativi completi sulle superfici esposte. L'**evidenza esaminata** comprende la crescita del tempo inbox dei medici di base, +24% tra 2019 e 2023, e l'alert fatigue contestuale: ne deriva l'indicazione di interrompere raramente e personalizzare. I riferimenti inline sono [NHS](https://service-manual.nhs.uk/design-system/index), [VA](https://design.va.gov/), [SAFER](https://healthit.gov/clinical-quality-and-safety/safer-guides/) e [Arndt 2024](https://pubmed.ncbi.nlm.nih.gov/38253499/).

## 2. Cosa entra in Lume (integrazioni normative alla specifica)

Le regole seguenti entrano nella lingua attraverso [01-lingua.md](./01-lingua.md), che le incorpora nella grammatica dell'attenzione e nel filo:

1. **L'agenda è la porta del lavoro.** Selezionare una voce di worklist/agenda deve aprire il contesto già composto nel Quadro, mai un modulo separato. (Doctolib, Elation)
2. **La colonna dell'attenzione è una coda decisionale, non un feed.** Ogni voce dichiara perché sia presente, chi ne sia responsabile, se sia delegabile e quale scadenza abbia. Le voci già valutate non si ripresentano identiche: il consolidamento conserva l'audit. (S3: evidenza inbox; S1: Aidoc/Viz)
3. **Doppio binario clinico e amministrativo.** Rinnovi burocratici, moduli e fatturazione restano accanto al contesto clinico, ma il loro registro è il neutro minerale. Non devono mai usare lo stesso colore dei segnali clinici. (S1: Commure/Oscar)
4. **Un segnale cambia la coda o non è un segnale.** L'urgenza riordina la worklist e propone l'azione; gli avvisi interruttivi sono riservati ai rischi urgenti e azionabili. (Aidoc, Viz, evidenza su alert fatigue)
5. **Evidenza a richiesta, sempre.** Ogni inferenza o sintesi deve aprire con un gesto documento, data e frammento delle proprie fonti: questa possibilità è il contratto del filo di provenienza. (Navina, SmarterDx, Abridge)
6. **Il tratto pieno è il commit.** Nessuna prescrizione, ordine o invio parte prima della firma del medico. Nella resa qui descritta, il passaggio tratteggiato -> pieno del filo rappresenta l'atto esplicito di commit: gli stati intermedi restano visibili e l'errore viene marcato, non cancellato. (Canvas)
7. **Timeline con livelli di sintesi.** Il filo del diario deve filtrare per tipo — visite, esami, prescrizioni, documenti, messaggi — e segnalare i cambiamenti, non soltanto elencare gli eventi. (S2)
8. **Trend come primitive di riga.** Vitali e laboratorio si confrontano nella riga, attraverso delta, banda personale e mini-storia sul filo, senza richiedere un report separato. La ricognizione conferma l'anatomia canonica già prevista da Lume. (Akute)
9. **La testata è anche sicurezza.** Data di nascita, identificativo e foto dove appropriato devono rendere verificabile l'identità; l'incertezza sul contesto paziente blocca le azioni cliniche. Nessun identificativo completo deve apparire sulle superfici esposte, coerentemente con il privacy shield nativo. (ONC SAFER)
10. **Form verticali, errori accanto al dato, mai disabled opachi.** Ogni stato disabilitato deve spiegare il proprio motivo, altrimenti non deve esistere. (USWDS, NHS)
11. **Primitive prima dei dashboard.** Testata, riga di lista, riga di laboratorio, filo, coda e pannello laterale costituiscono gli elementi componibili della libreria Lume; non si costruiscono schermate monolitiche. (Medplum, OpenMRS)
12. **Ogni superficie clinica è un controllo di rischio.** Le viste che toccano allergie, prescrizioni, import documenti e contenuti generati devono mantenere un hazard log leggero ed essere riviste dopo ogni modifica rilevante. (DCB0129/0160, NHS service standard)

## 3. Cosa non entra

- **hGraph radiale come superficie primaria**: può ispirare una vista d'insieme opzionale in analytics, ma non sostituisce valori, unità, date e possibilità di approfondire.
- **Score compositi in prima linea**, come età biologica o indici sintetici: il confronto primario rimane il dato rispetto alla storia personale, non un numero riassuntivo.
- **Inbox separate per tipo**: distinguere referti, messaggi e task in code autonome frammenterebbe il triage. La coda rimane una, articolata in filtri e binari.
- **Dashboard di widget configurabili come home**: la gerarchia del cockpit deriva dal dominio, non dalla composizione libera di un cruscotto.
- **Modali in cascata per operazioni frequenti**: si usano invece pannelli laterali che conservino il contesto, come già richiesto da Lume.

## 4. Lo spazio bianco

Fra i prodotti esaminati, la lane S2 non individua una combinazione di cockpit locale-first, worklist clinico-amministrativa unificata, trend longitudinali leggibili nella cartella e revisione esplicita di documenti e contenuti generati. Nella sua lettura, i prodotti più moderni privilegiano UX SaaS e patient engagement, mentre quelli più profondi, inclusi gli italiani, offrono soprattutto copertura normativa. È da questa lacuna della ricognizione che nasce la direzione proposta per MediFlow: collegare locale-first e review-first alla grammatica di Lume — fuoco, coda decisionale, filo di provenienza e due voci — per costruire una superficie unica, densa ma calma, nella quale emerga ciò che richiede attenzione. Si tratta del posizionamento ricavato dalla ricerca, non di un'attestazione di esclusività sul mercato.
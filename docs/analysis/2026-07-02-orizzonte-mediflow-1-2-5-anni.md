# Orizzonte MediFlow: 1, 2, 5 anni

Data: 2026-07-02
Autore: lettura prospettica di sistema (Claude Fable 5), su richiesta di Leonardo.
Metodo: confronto tra gli intenti dichiarati dal sistema (README, ADR 0065 intended purpose, ROADMAP v0.7, famiglie Linear WUL-384 "Futuro MediFlow" e WUL-411 modelli locali, visione tri-OS a flusso invertito) e lo stato reale a valle delle due ondate esecutive chiuse oggi (UI/UX fase 0-7, stack intelligente S1-S9). Una sezione finale integra l'indagine esplorativa esterna delegata a Codex (web, con citazioni). Gemini CLI resta bloccato da licenza: il prompt equivalente e pronto per Antigravity.

Nota di stile: niente trattino lungo, per convenzione di progetto.

---

## 0. L'invariante: cio che non cambia a nessun orizzonte

Prima delle frontiere, il vincolo. MediFlow ha un intended purpose scritto e presidiato da un guard CI (ADR 0065): cartella clinica e workbench LOCALE, assistivo e review-first; l'AI non e mai motore autonomo, mai prescrittore, mai triage; il cloud non e mai un requisito; i percorsi regionali restano handoff finche non esiste una via qualificata. E il README dichiara la vocazione: progettata da un medico per il lavoro di tutti i giorni, adottabile da chi inizia la pratica senza soldi ne infrastruttura.

Questo e il test di ogni frontiera: se una direzione richiede di violare l'invariante (un server obbligatorio, un claim autonomo, una certificazione che uccide la semplicita), la direzione e sbagliata per QUESTO prodotto, per quanto di moda. La vocazione altruistica non e un vezzo del copy: e il criterio di selezione delle feature.

## 1. Dove siamo (fine 2026-07)

- v0.7 con fondamenta consolidate: SQLite cifrato, API v1 con contract guard, audit append-only, backup con scheduler, AI locale governata da kill-switch e review-first.
- Oggi si sono chiuse le due ondate esecutive: la Scheda e una sinottica a cascata con liste dense espandibili e zero dialoghi nativi; lo stack documentale ha staleness, view model unico, router deterministico con segnale Producer, range di riferimento, autofill dentro i guardrail del decision layer, contratto e migration allineati.
- Apple: fase 0 fatta (artefatto unico, crypto cross-platform), parita reale in costruzione. Windows/Linux: milestone WUL-375 aperta (parita onesta, launcher sottili).
- Strategia gia deliberata: WUL-384 con 3 filoni (stack intelligente, servizi connessi opzionali, app native) e WUL-411 (scouting modelli locali, lane benchmark OCR come prerequisito).

La lettura onesta: il "cuore clinico" per un singolo medico su un Mac e vicino alla maturita. Cio che separa MediFlow dalla sua vocazione dichiarata e la DISTRIBUZIONE (tri-OS, installabilita, documentazione) piu che le feature.

## 2. Orizzonte 1 anno: "lo studio di un medico, senza asterischi" (verso v1.0)

Obiettivo identitario: un prodotto scaricabile che un medico di famiglia, o una collega al primo incarico, installa in mezz'ora su QUALSIASI laptop recente, senza IT e senza cloud, e usa dal primo giorno.

Priorita (in ordine):
1. **Parita tri-OS onesta** (WUL-375): un binario/launcher per macOS, Windows, Linux; install robusto (Node pin, prebuild sqlite), CI a matrice, degradazione dichiarata dove il Mac ha di piu (Vision/MLX -> Ollama). E il veicolo della vocazione: senza Windows/Linux il "chi non ha infrastruttura" resta escluso.
2. **Chiudere il floor di fiducia**: riallineamento zero-knowledge WUL-342/354 (o claim attenuato e dichiarato), cosi il copy pubblico puo essere forte senza asterischi. La sicurezza qui non e compliance: e la promessa al medico che i dati dei SUOI pazienti sono davvero solo suoi.
3. **S3 completo sul corpus reale**: reroute deterministico (saltare l'LLM sul 55-60% classificabile) + parser ricetta SSN e referto lab, validati sul vault (l'harness di benchmark ora esiste). E il momento in cui l'import documentale smette di essere "AI che aiuta" e diventa "segretaria instancabile".
4. **Rifinitura clinica dal vivo**: validazione LOINC_PENDING_VALIDATION (WUL-436), vista Per data usata su casi reali, Foglio sinottico messo alla prova in visita.
5. **Documentazione da prodotto**: manuale utente non-tecnico, guida installazione per OS, FAQ sicurezza. Un prodotto altruistico senza documentazione semplice e un paradosso.

Cosa NON fare nel primo anno: certificazioni (CE/MDR o simili), multi-tenant, cloud sync. Nessuna di queste avvicina la v1.0 identitaria.

## 3. Orizzonte 2 anni: "dallo studio alla rete di prossimita"

Quando la v1.0 esiste, la domanda diventa: come lavora un medico VERO, cioe con una borsa, due sedi, un telefono, e colleghi?

1. **Sync locale-first multi-dispositivo** (flusso invertito gia deliberato): il laptop dello studio e la home-base, il portatile/tablet in visita domiciliare si sincronizza al rientro, offline-first per costruzione. Da valutare con uno spike serio se i CRDT maturi (Automerge/ElectricSQL e simili) battono la coda-replay gia disegnata, o se sono overengineering: la risposta la da l'indagine, non la moda.
2. **Piccola equipe, non ospedale**: 2-4 operatori (collega, infermiere, segretaria) con ruoli e audit, sempre senza server centrale obbligatorio. E l'evoluzione naturale della medicina di prossimita: la microequipe territoriale.
3. **Interoperabilita import/export-first**: FHIR R4 come formato di scambio (WUL-386), non come certificazione: esportare un paziente completo e leggibile, importare da altri sistemi. Per l'Italia: SISS/FSE handoff maturato + spike normativo EHDS/FSE 2.0 (WUL-388) trattato come radar, non come cantiere.
4. **AI locale di seconda generazione**: OCR multimodale on-device come commodity (la traiettoria NPU/small-models lo rende plausibile), riconciliazione farmaci documenti-terapie, proiezioni follow-up complete, sempre nella cornice review-first. La lane redaction (S7) sblocca il fine-tune in-house (S11) sul corpus del vault.
5. **Apple parita clinica completa** (fase 1-3 gia mappate): il telefono in tasca durante la domiciliare e il caso d'uso territoriale per eccellenza.

## 4. Orizzonte 5 anni: "infrastruttura civica open source"

La scommessa altruistica portata alle conseguenze: MediFlow come riferimento open source della cartella local-first per contesti a basse risorse.

1. **Floor hardware esplicito e difeso**: girare bene su macchine vecchie/economiche (il laptop donato, il mini-pc da 200 euro), con un profilo "lite" dichiarato (AI ridotta o assente, core clinico intatto). Il test di realta non e il MacBook di Leonardo: e l'ambulatorio con la corrente a singhiozzo.
2. **Localizzazione come feature di missione**: EN/FR/ES/PT prima (le lingue della cooperazione sanitaria), poi pacchetti locali; terminologie e formati data/unita gia pronti per il multi-locale (il lavoro displayIt di oggi e il seme).
3. **Distribuzione resiliente**: installer offline (USB), mirror, aggiornamenti non obbligatori, nessuna telefonata a casa. In contesti a bassa connettivita la distribuzione E il prodotto.
4. **Governance che sopravvive al fondatore**: oggi il bus factor e 1 medico + agenti AI. A 5 anni serve una forma (foundation leggera, collettivo di manutentori clinici, sponsorship/grant sanitari UE o filantropici) che garantisca continuita senza tradire la licenza MIT e l'assenza di lock-in. E la frontiera meno tecnica e piu decisiva.
5. **Rete di prossimita federata (ipotesi, non promessa)**: ambulatori vicini che scambiano referti cifrati peer-to-peer su reti locali, senza cloud. Da esplorare solo se il sync a 2 anni dimostra le fondamenta.

## 5. Le sei frontiere (mappa dei filoni di sviluppo)

| Frontiera | Cosa e | Aggancio esistente | Orizzonte |
|---|---|---|---|
| F1 Distribuzione tri-OS | binari onesti, install semplice, floor hardware | WUL-375..383, Apple fase 1+ | 1 anno (poi mantenimento) |
| F2 Intelligenza documentale locale | S3 completo, S7 redaction, S11 fine-tune, bench sul vault | WUL-425 residui, WUL-411, WUL-443..447 | 1-2 anni |
| F3 Interoperabilita onesta | FHIR import/export, handoff regionali, radar EHDS | WUL-386, WUL-388, ADR 0045/0046 | 2 anni |
| F4 Sync locale-first | flusso invertito, coda-replay vs CRDT, microequipe | visione tri-OS, WUL-395..400 | 2 anni |
| F5 Fiducia verificabile | zero-knowledge senza asterischi, audit, claims guard | WUL-342/354, ADR 0065 | 1 anno (perpetua) |
| F6 Sostenibilita e comunita | docs, lingue, governance, distribuzione, grant | WUL-405 go-to-market, da espandere | trasversale, decisiva a 5 anni |

## 6. Anti-obiettivi (cosa NON diventare)

- Non un SaaS: il giorno in cui serve un account cloud, la missione e morta.
- Non un motore diagnostico autonomo: l'ADR 0065 e per sempre; l'AI propone, il medico decide, tutto e rivedibile.
- Non un HIS ospedaliero: la nicchia e il medico e la microequipe territoriale, non la corsia; l'ospedale entra come contesto d'uso personale, non come target enterprise.
- Non una rincorsa alle certificazioni: si certifichera cio che serve quando un adottante reale lo richiede, non prima.
- Non un fork-magnet commerciale senza ritorno: la governance (F6) serve anche a questo.

## 7. Confronto con la visione gia deliberata (WUL-384)

Convergenza sostanziale: i 3 filoni deliberati (stack intelligente, servizi connessi, app native) coincidono con F2, F3+F4, F1. Questa lettura aggiunge due cose che nel deliberato erano implicite: la PRIORITA IDENTITARIA della distribuzione tri-OS come veicolo della vocazione (F1 prima di tutto), e la promozione della sostenibilita/comunita (F6) da nota a frontiera di pari rango, perche a 5 anni e quella che decide se il progetto esiste ancora.

---

## 8. Esiti dell'indagine esplorativa esterna (Codex, web con citazioni)

Report completo con fonti: docs/analysis/2026-07-02-indagine-codex-orizzonte.md. Qui la sintesi che conta per le decisioni.

**Standard e normativa.** EHDS e in vigore dal 26 marzo 2025 ma con applicazione graduale: atti attuativi entro il 2027, patient summary ed ePrescription dal 2029, immagini/lab/discharge dal 2031. Quindi: radar, non cantiere. Il punto vero e di POSIZIONAMENTO: EHDS introduce self-certification per i sistemi EHR immessi sul mercato UE; MediFlow deve dichiararsi personal clinical workbench local-first, non piattaforma EHR certificata, finche non sceglie deliberatamente quel percorso. FHIR R4 (stabile) e la base giusta, R5 e ancora STU. FSE 2.0 resta un cantiere tecnico (repo ministeriale it-fse-support: GTW, validazione CDA): la validazione locale dry-run e utile oggi, il writeback no.

**AI locale.** La traiettoria conferma la linea interna: Apple ha un modello on-device ~3B (~30 token/s su iPhone 15 Pro), Gemma 3n porta il multimodale su device consumer, le NPU Windows sono a 40-80 TOPS. A 1 anno OCR, classificazione e sintesi citata su modelli 1-4B sono realistici su hardware da 500-1500 euro; a 2 anni il multimodale locale e pratico; a 5 anni molte capability documentali oggi cloud-only saranno locali. Cio che NON arriva e l'affidabilita della decisione clinica autonoma: l'ADR 0065 resta giusto anche tecnicamente. Implicazione chiave per la vocazione: servono PROFILI DEGRADATI dichiarati (hardware vecchio = OCR+regole+modelli 1-2B; medio = 3-8B; Apple moderno = Foundation Models/MLX opzionali). E la parita Win/Linux non puo dipendere da Apple Vision: serve una provider abstraction OCR con fallback espliciti.

**Panorama OSS.** OpenMRS (8000+ strutture, 70+ paesi), Bahmni (500+ siti low-resource), OpenEMR (completo ma pesante, ONC), GNU Health, DHIS2 (HMIS di popolazione, non cartella individuale): NESSUNO copre il caso "singolo medico, zero infrastruttura, UX moderna, AI locale, installazione desktop". La lacuna che MediFlow riempie e reale e ha un nome: personal clinical workstation. La lezione dei progetti che hanno funzionato nei contesti a basse risorse: community e rete di implementatori contano piu delle feature; vincono adattabilita, offline, ownership del dato, formazione e traduzioni.

**Sync.** I CRDT (Automerge/Yjs) sono maturi per note, draft e annotazioni, NON per l'intero DB clinico; PowerSync/Electric non risolvono da soli E2EE clinico, semantica dei conflitti, audit e responsabilita medico-legale. Verdetto: il flusso invertito home-base-first gia deliberato e la strada giusta (write versionati, conflitti espliciti); CRDT solo come laboratorio su annotazioni e draft visita. "CRDT ovunque" trasformerebbe una cartella affidabile in un sistema distribuito fragile.

**Sostenibilita.** I modelli che funzionano (OpenMRS community+partner, DHIS2 con HISP/Universita di Oslo, OpenEMR foundation) dicono: niente fondazione pesante subito; puntare a "bene pubblico installabile" (Homebrew, winget, release firmate, manuale medico, dataset sintetici, traduzioni, grant UE salute digitale, partner universitari) e a una micro-governance a 2 anni (maintainer clinico, security policy, advisory board leggero, policy su marchio e claim contro la cattura commerciale opaca).

**Verdetto di convergenza.** Tre convergenze forti (interoperabilita/portability, AI locale review-first, ricetta low-resource) confermano che il mondo va dove MediFlow gia punta. Quattro rischi da presidiare: posizionamento EHDS, dipendenza Apple nell'OCR, tentazione CRDT, bus factor.

## 9. Prossime esplorazioni delegate (spike, per rapporto valore/sforzo)

I primi tre sono il punto di partenza consigliato (allineati alla priorita F1+F3 dell'orizzonte a 1 anno); gli altri seguono. Owner tra parentesi.

1. **OSS installer path** (Codex): Homebrew cask + winget manifest + GitHub Release firmata, demo synthetic-only. E il primo mattone di F1.
2. **Low-resource profile** (Codex): modalita "PC vecchio" dichiarata: OCR/testo + regole, niente modello grande, import manuale guidato.
3. **FHIR R4 export v0** (Codex): Patient, Condition, MedicationStatement, Observation, Encounter da fixture sintetiche; base di F3.
4. **Provider AI matrix** (Codex, aggancio WUL-411/412): Ollama, MLX, Apple FM, Gemma 3n su profili 1B/3B/8B, benchmark su documenti sintetici.
5. **FSE GTW dry-run** (Codex): validazione locale CDA/PDF sugli esempi ministeriali, senza pubblicazione.
6. **Terminology manifest** (Codex): registry locale versionato ICD-11, AIC/ATC, LOINC/UCUM, subset SNOMED.
7. **CRDT annotation lab** (Codex+Claude): Automerge/Yjs SOLO su note evidenza e draft visita, mai sul DB clinico.
8. **PowerSync/Electric LAN PoC** (Codex): replica read-only SQLite con home-base locale, misurando conflitti e cifratura.
9. **OpenMRS/Bahmni bridge memo** (Claude): cosa integrare via FHIR/export e cosa non duplicare mai.
10. **Governance lite** (Claude+Leonardo): CODEOWNERS, security advisory, maintainer policy, policy marchio/claim, roadmap pubblica bilingue.

**Gemini (Antigravity)**: seconda opinione adversariale sull'intero orizzonte con prompt gia pronto in docs/analysis/2026-07-02-prompt-gemini-orizzonte.md (falsificazione degli orizzonti, priorita contestate, reality check low-resource dai fallimenti OpenMRS/DHIS2, minimo regolatorio UE vitale, le tre mosse). La CLI gemini standalone resta bloccata da licenza: va eseguito da Leonardo dentro Antigravity.

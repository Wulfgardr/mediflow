<a id="kree8--mediflow-visual-translation"></a>

# Da Kree8 a MediFlow: traduzione visiva

| | |
| --- | --- |
| **Tracking** | WUL-271 (traduzione) · WUL-272 (ingresso live) · WUL-273 (slice con dati reali) · WUL-274 (continuità PIN) |
| **Stato descritto** | Ingresso live su `/`; slice del cockpit su pazienti reali in corso in `WUL-273` |
| **Alias di revisione** | `/mockups/kree8`, con dati sintetici, riservato alla QA di design |
| **Ultimo passaggio visuale** | 2026-06-11: rimozione dei metatesti, ripristino misurato del colore semantico, normalizzazione di tipografia e raggi, completamento dei token dark, apertura della Scheda in un click |
| **Perimetro** | Rinnovamento dell'intera superficie, promosso all'ingresso web locale come direzione dell'interfaccia; collegamento ai dati clinici reali per slice piccole e verificate |
| **Attribuzione** | Kree8 è il riferimento esterno per ispirazione visiva e grammatica; l'implementazione clinica e il modello di interazione specifico di MediFlow rimangono originali. |

<a id="why-this-doc-exists"></a>

## Perché questa pagina

Il percorso WUL-271 nasceva dalla richiesta di sostituire la precedente linea visiva, non di rifinire incrementalmente Graphite: «via il vecchio», secondo il brief. Questa pagina documenta quindi la traduzione indipendente della grammatica dei riferimenti [Kree8](https://www.kree8.studio/) in una superficie reale di gestione clinica.

Kree8 deve rimanere accreditato ovunque questa direzione visiva sia documentata o presentata all'esterno. L'attribuzione deve essere più evidente nell'app e nel design system, nei quali la grammatica visiva è un'influenza primaria; sul sito e nei testi pubblici può essere più leggera, ma deve comunque riconoscerne l'ispirazione quando la pagina richiami questa linea di MediFlow.

Il **passaggio v2** porta il lavoro oltre l'applicazione di etichette mediche a Kree8: il cockpit viene organizzato secondo le sezioni reali di MediFlow, con lista/inbox pazienti autonoma e Quadro paziente composito. La revisione documentale richiede un controllo prima dell'applicazione e rende visibili le scritture SISS bloccate; Governance assume la struttura delle impostazioni effettive, anziché quella di un pannello generico di preferenze.

La pagina permette così a chi rivede il lavoro di:

- confrontare ciascun elemento Kree8 con l'analogo scelto per MediFlow;
- valutarne l'adeguatezza al lavoro clinico in termini di densità, leggibilità a colpo d'occhio e significato degli stati;
- distinguere ciò che è stato portato all'ingresso principale dalle parti che richiedono ancora una migrazione sui dati reali prima di ritirare del tutto le superfici Graphite.

Il seguito della migrazione sui dati reali è tracciato nelle slice WUL-273.

<a id="live-entry-contract"></a>

## Contratto dell’ingresso live

| Aspetto | Come viene garantito |
| --- | --- |
| Ingresso principale | `app/page.tsx` renderizza `Kree8ClinicalCockpit` in modalità `live`: dopo `Start_MediFlow.command`, `http://localhost:3000` presenta direttamente la nuova linea. |
| Sicurezza del runtime | `RootRuntimeShell` tratta `/` come route live a pieno schermo: `SecurityProvider`, PIN/sessione e provider UI/accessibilità/stile/privacy restano attivi, mentre sidebar, chrome mobile e padding principale legacy non vengono montati attorno al cockpit. |
| Continuità del gate PIN | `LockScreen` usa un modulo Kree8 circoscritto ed è l'unica superficie montata durante il blocco; né cockpit né provider di dati protetti vengono montati dietro il gate PIN. |
| Alias di revisione | `/mockups/kree8` presenta lo stesso cockpit in modalità `review` attraverso l'allowlist esatta dei mockup e conserva il pulsante di uscita per la QA di design. |
| Nessun selettore UI persistente | Non sono ammessi toggle Graphite/Kree8, profili di anteprima o modalità visive persistenti, secondo [ADR 0060](../adr/0060-kree8-cockpit-live-root-entry.md). |
| Superficie visuale | `.shell` usa `position: fixed; inset: 0; z-index: 1000;`, assegnando il viewport al cockpit. |
| Movimento ridotto | Il blocco circoscritto `@media (prefers-reduced-motion: reduce)` disabilita transizioni e animazioni keyframe dentro `.shell`. |
| Dati | `/` live legge pazienti e checkup locali reali solo dopo lo sblocco PIN/sessione; `/mockups/kree8` mantiene dati sintetici di revisione. Sono vietati asset remoti e screenshot di pazienti reali nel repository. |
| Dipendenze | Nessun nuovo pacchetto npm; per le icone si usa `lucide-react`, già presente. |

<a id="token-translation"></a>

## Traduzione dei token

I token sono proprietà custom dichiarate **dentro `.shell`**: la loro applicazione rimane circoscritta, senza propagarsi a `:root` o alle altre superfici.

| Riferimento Kree8 | Token MediFlow | Note |
| --- | --- | --- |
| Canvas grigio freddo tenue (~`#eef0f2`) | `--canvas` su `.shell` | Sostituisce il beige Graphite (`#f6f0e7`) senza modificare `:root`. |
| Card bianca piena | `--surface` | Raggio 28px, ombra morbida e bordo interno 1px. |
| Pill bianca di navigazione sollevata | `.navSelected` | Fondo bianco, raggio 13px, ombra morbida e chevron per indicare l'interazione. |
| Toolbar ampia, arrotondata e vitrea | `.toolbar` | Raggio 18px, luce interna, pill di ricerca e chip. |
| Capsula AI a gradiente | `.aiButton` | Gradiente contenuto inchiostro → violetto → plum tramite `--accent-ai`, con varianti chiara e scura, icona sparkle e ombra morbida. **Il gradiente è riservato all'ingresso AI.** |
| Pill di stato gialle/blu/verdi/corallo/attenuate/violette/inchiostro | `--pill-*-bg` / `--pill-*-fg` | Padding compatto 4×10 px e testo tabellare. I colori semantici verde/ambra/blu/violetto/corallo sono presenti ma contenuti, con coppie dark corrispondenti; il tono attenuato resta ardesia. |
| Toggle segmentato | `.segmented` + `.segItem`/`.segSelected` | Commutazione AI / Source nel pannello paziente. |
| Stepper meno/più | `.stepper` + `.stepperBtn` | Disabilitato ai limiti, con numero tabellare. |
| Gradiente verde della riga prezzi | **rimosso in v2** | Sostituito da `.freshness`, controllo bianco con sottile linea semantica sinistra (`--rail-green/blue/yellow/coral`), per evitare che AIFA sembri una card promozionale. |
| Tab di fase/categoria | `.stageBtn`/`.stageBtnActive`/`.stageBtnDone` | Fasi dell'handoff SISS, con un breve sweep keyframe al cambio di fase. |
| Superficie di blocco PIN | `kree8-lock-screen.module.css` | Canvas grigio freddo, card bianca sollevata, marchio MF, focus ring ardesia, pulsante primario inchiostro e footer semantico locale/zero-knowledge. Nessuna esportazione globale dei token. |
| Accento blu sobrio da WUL-232 | `--brand-dot-bg`, `--k8-accent` / `--k8-accent-soft` / `--k8-accent-line`, `--k8-focus` | Il blu contenuto identifica il marchio in cockpit, workspace e lock screen. Nel workspace serve solo per focus ring, tinta del marchio e hairline all'hover; le azioni primarie restano inchiostro e il gradiente resta esclusivo dell'AI. |

<a id="contrast-and-type-rhythm"></a>

### Contrasto e ritmo tipografico

- Il letter-spacing negativo è stato eliminato: titoli, valori statistici e cifre degli stepper mantengono il tracking predefinito per la lettura clinica.
- Il testo corrente e leggibile non usa più `#94a3b8`, ma `--ink-muted` (`#475569`) o `--ink-strong` (`#1e293b`). Il tono ardesia più chiaro, `--ink-faint`, rimane riservato a date tabellari e metadati numerici minuti.
- Tipografia, spaziature e ombre riprendono il ritmo Inter-Regular / SF Pro delle schermate Kree8, con interlinea più stretta per conservare la densità delle tabelle cliniche.

<a id="motion-lab"></a>

### Laboratorio del movimento

Lo sprite sheet di lavoro rimane fuori da Git in `tmp/wul-271-kree8-motion-study/kree8-mockup-motion-sprite.png`:

| Movimento | Superficie CSS | Funzione |
| --- | --- | --- |
| Ingresso della superficie | `.areaShell` + keyframe `areaEnter` | Ogni area entra al montaggio con dissolvenza e salita di 6px, evitando uno scambio brusco. |
| Scorrimento Case Lens | `.caseLens` + keyframe `lensSlide` | L'anteprima del paziente selezionato entra da destra. |
| Pressione fisica | `:active { transform: scale(0.97) }` su ogni superficie azionabile | Feedback su pulsanti, chip e riquadri delle fasi. |
| Pulsazione di conferma della decisione | `.pillCommit` + keyframe `commitPulse` | Quando cambia la decisione su un campo documentale, la pill di stato ripete una breve pulsazione attraverso una `key` React. |
| Sweep di progressione | `.stageRowSweep` + keyframe `sweep` | Un gradiente attraversa la riga SISS in 720ms a ogni cambio di fase attiva. |
| Sollevamento all'hover | `transform: translateY(-1px)` su chip, riquadri e pulsanti | Risposta Kree8 contenuta, senza aumentare l'ombra. |

Tutti i movimenti sono subordinati al blocco circoscritto `@media (prefers-reduced-motion: reduce)`.

<a id="surface-map-root-entry-seven-areas"></a>

## Mappa delle superfici (ingresso principale, sette aree)

Il mockup colloca nel telaio Kree8 tutte le principali superfici MediFlow, perché la revisione riguardi l'intero percorso clinico e non soltanto la schermata iniziale. Il passaggio v2 separa la precedente area "Paziente" nella lista autonoma `Pazienti in carico` e nel dettaglio composito `Quadro paziente`; le altre aree vengono rinominate secondo il lessico che MediFlow presenta al clinico.

| Area | Che cosa mostra |
| --- | --- |
| Oggi | Fascia statistica, agenda del giorno filtrabile per `urgent`/`AI`/`manual`, card della coda AI e anteprima del ponte Zimbra/iCloud `WUL-275` per candidati clinici/FBF da rivedere. |
| Pazienti in carico | Lista con chip di ambito Ambulatorio locale / Rete locale / Tutti, toggle attivi/archivio e righe selezionabili con azione diretta `Apri scheda`. L'`Anteprima caso` persistente offre la primaria `Apri scheda paziente`, `Quadro` interno al cockpit, `Nuova voce`, `Documenti` e `Prepara SISS`. |
| Quadro paziente | Identità e azioni `Nuova voce diario`, `Allega documento`, `Pianifica visita`, `Smart Import`, con primaria `Prepara SISS`; chip con badge `MediFlow Insight`, `Contesto SISS pronto` e `Protesica-RL`; sintesi AI ⇄ Source, Timeline del caso, Terapia attiva, Evidenze recenti, anteprima Smart Import con conteggi di scritture/note/blocchi e Prossimi passaggi. |
| Documenti | Pannello di revisione con conteggi `campi aggiornabili`, `note da riconciliare`, `ignorati` e `non integrabile ora`, frammenti di evidenza per campo e card delle capacità di scrittura SISS bloccate. Le decisioni sono `Applica` / `Come nota` / `Ignora`; la primaria diventa `Porta nella scheda`, non più "timbra". |
| Cataloghi | Stato di aggiornamento su pannello bianco con sottile linea semantica sinistra fresh/ok/stale/broken, elenco dei cataloghi con pill di stato e importazione indirizzata alle impostazioni. |
| Trasmissioni SISS | Matrice di avvio Modulo Prescrittivo, Protesica-RL, FSE · OpeFseIE, Anagrafe · Gaia e Menu SISS, più selettore di 4 passi Identità → Consenso → Portale ufficiale → Esito. La capsula di esito dichiara il risultato **annotato manualmente**, senza artefatto certificato di ritorno. Restano non integrabili ora `Prescrittivo nativo`, `FSE embedded`, `SGDT / PAI` e `Certificati di malattia`. |
| Sistema | Account & PIN; controlli AI locali `AI Patient Insight`, `Smart Import documento`, `Comparatore cloud` e chip delle lane; Modalità di rete con `locale di default` e `Mac principale` opzionale; Backup & cataloghi con launchd notturno e retention keep-last-N; Diagnostica locale con Audit append-only, Riduci animazioni e **nessuna telemetria esterna**; Aggiornamento & stato con `v0.6.4` e AI locale. |

<a id="interactivity-demonstrated"></a>

## Interazioni dimostrate

Nel quadro documentato, i pannelli non ancora migrati usano prevalentemente stato React locale. Da `WUL-273`, dopo lo sblocco, l'ingresso live effettua letture protette dalla sessione su `/api/patients` e `/api/checkups`, portandole nell'inbox pazienti Kree8, nella fascia statistica, nell'agenda locale e nella prima vista Quadro paziente. Se la lettura non riesce o non restituisce dati, mostra esplicitamente errore o vuoto: non ripiega sui pazienti di revisione. Da `WUL-275` legge anche `/api/clinical-agenda/candidates` per i candidati della cache eventi Zimbra/iCloud. L'alias di revisione rimane sintetico e non acquisisce dati esterni o clinici.

`/patients/[id]/modules` viene trattata come **Scheda paziente**, il workspace Kree8 a pieno schermo che ospita l'insieme degli `strumenti clinici`. L'ingresso principale serve a navigare; la Scheda permette di decidere, sintetizzare e svolgere il lavoro più esteso su terapie, osservazioni, protesica, scale, caricamento documenti e revisione del diario. Gli strumenti interni continuano a usare i componenti reali esistenti finché ciascuno non riceva la propria revisione interna Kree8.

`/patients/[id]/entries/new` applica la stessa regola a pieno schermo all'azione primaria di scrittura avviata dalla Scheda paziente. Editor rich-text, upload allegati, OCR/sintesi documentale e salvataggio restano quelli esistenti; cambia il linguaggio della route, con `Diario clinico`, `Nuova
voce clinica`, `Luogo`, `Tipo di voce`, `Resoconto` e `Allegati`.

Anche `/patients/[id]/scales` e `/patients/[id]/scales/[scaleId]` usano il workspace per le valutazioni riferite al paziente e avviate dalla Scheda. Il selettore legge il registro locale reale `SCALES`; il runner conserva scoring e salvataggio esistenti, presentando contesto, domande e registrazione nel diario come un solo flusso clinico.

`/patients/[id]/edit` applica il workspace alla manutenzione dell'anagrafica. Restano invariati `PatientForm`, validazione dell'export FSE/FHIR, archiviazione, ripristino ed eliminazione; la cornice della route adotta Kree8 e ritorna alla Scheda paziente.

`/patients/new` adotta la stessa struttura per creare una scheda dal cockpit live. Importazione PDF/immagini, gate di revisione documentale, controllo del codice fiscale duplicato, `PatientForm` e persistenza di checkup e terapie rimangono i flussi reali esistenti. La traduzione Kree8 riguarda soltanto la cornice della route e i testi rivolti al clinico.

`/scales` usa il workspace per il catalogo globale delle scale, derivando l'elenco visibile dal registro locale reale `SCALES` anziché mostrare card fittizie o di prossima disponibilità. Prima di avviare il runner riferito al paziente, ne richiede la scelta inline.

`/analytics` applica il workspace al cruscotto della popolazione locale. Legge conteggi reali dei pazienti, flag ADI, diagnosi strutturate e sintesi di `/api/system/audit`; non mostra più card legacy a zero come `Presa in Carico`, `Estemporanei` o `Top Patologia`, né usa espressioni da mockup come `Cruscotto Clinico`.

`/settings` e `/settings/ambulatories` adottano la shell Kree8 come superfici di sistema, al posto della cornice legacy con sidebar. Le impostazioni mantengono disponibili nella pagina i controlli di tema e privacy; gli ambulatori usano la stessa shell per gestire i contesti clinici locali, senza la precedente dicitura "root/test zone".

- Le aree si selezionano nel rail tramite `navItem`/`navSelected`; nelle larghezze ridotte il rail diventa una striscia orizzontale scroll-snap, utilizzabile anche su tablet.
- Lo sblocco PIN appartiene alla stessa linea visiva: superficie circoscritta, input numerico, azione inchiostro, chip di errore con breve commit pulse e didascalie locale/zero-knowledge. La semantica dell'autenticazione resta in `SecurityProvider`.
- I chip della toolbar hanno selezione singola e filtrano l'agenda Oggi.
- L'anteprima del ponte Zimbra/iCloud distingue i candidati clinici/FBF esterni dalle righe confermate dell'agenda, mantenendoli in revisione manuale.
- L'azione AI a gradiente nella toolbar è decorativa e riprende il riferimento Kree8.
- Ambito dell'inbox (`Ambulatorio locale` / `Rete locale` / `Tutti`) e modalità (`Attivi` / `Archivio`) determinano le righe visibili, lette da `/api/patients` in live. La selezione apre con un'animazione l'`Anteprima caso`. `Scheda paziente` è l'unica destinazione di route, `/patients/[id]/modules`, ed è la primaria sia nella riga sia nell'anteprima, con `Apri scheda paziente`; `Quadro` resta invece l'overview interna al cockpit, senza cambio di route. L'anteprima offre anche `Nuova voce` e `Documenti`, mantenendo le tre attività più frequenti entro due click. `/patients/[id]` rimane il deep-link al Quadro per la navigazione di ritorno.
- Il Quadro paziente alterna `Sintesi AI` ⇄ `Fonti grezze`.
- Ogni campo documentale presenta frammento di evidenza, tipo (`campo aggiornabile` / `solo nota` / `non integrabile ora`), decisione a tre stati e conteggi aggiornati. La pill risultante ripete il commit-pulse; `Porta nella scheda` si abilita solo dopo l'elaborazione di tutte le righe revisionabili.
- Elenco e card dei Cataloghi mostrano lo stato del pacchetto locale e rinviano alle impostazioni per l'importazione.
- Il selettore Trasmissioni SISS percorre 4 passi, ciascuno con il proprio contenuto; lo sweep della riga si ripete al cambio di fase.
- I toggle Governance aggiornano `aria-pressed` nelle sezioni account/PIN, AI locale, rete, backup, audit e aggiornamento.

<a id="clinical-readability-guardrails"></a>

## Vincoli di leggibilità clinica

- Il canvas resta neutro e chiaro, mai beige: i toni caldi Graphite non sono presenti.
- Il colore di stato è riservato al significato, non alla decorazione.
- Il gradiente compare soltanto nel pulsante AI. Pannello di aggiornamento e card AIFA usano invece una superficie bianca con sottile linea semantica colorata a sinistra.
- Non sono ammessi elementi sferici decorativi. `FlowFieldBackground` continua a essere renderizzato sullo sfondo, ma l'overlay fisso lo copre.
- Le tabelle di agenda, cataloghi e pazienti mantengono righe dense, caratteri 11-13px e spazi 4-12px.
- Ogni testo leggibile usa token con contrasto almeno pari a `--ink-muted`; il tono ardesia molto chiaro è riservato a date tabellari e metadati minuti.

<a id="what-this-live-entry-slice-explicitly-does-not-do"></a>

## Che cosa questa slice dell’ingresso live **non** fa

- La slice non migra tutte le route cliniche reali alla grammatica Kree8.
- Non completa ancora la migrazione interna di documenti, terapie, diario e osservazioni, che continuano a usare i componenti paziente esistenti fino alle rispettive slice. Sono già in cornice Kree8 creazione paziente, nuova voce diario, catalogo globale delle scale, analytics, impostazioni, ambulatori, selettore/runner delle scale paziente, modifica anagrafica e workspace Scheda paziente.
- Non cambia semantica di PIN, autenticazione e sessione, né monta dati del cockpit dietro la schermata di blocco.
- Non introduce una nuova chiave di stile in `UIStyleProvider`.
- Non aggiunge un selettore Graphite/Kree8.
- Non carica dati paziente prima dello sblocco PIN/sessione.
- Non attesta un artefatto certificato di ritorno SISS: il passo Esito conserva il risultato del portale come **annotazione manuale**, con etichetta `non
  certificato`.

<a id="review-checklist"></a>

## Checklist di revisione

- [ ] Aprire `/` ed esercitare tutte le sette aree.
- [ ] Caricare `/` in stato bloccato e verificare che sia montata soltanto la superficie PIN Kree8, senza testi del cockpit o richieste ripetute di dati protetti prima dello sblocco.
- [ ] Sbloccare con un PIN valido e verificare che la superficie di blocco lasci direttamente posto al cockpit Kree8.
- [ ] Su `/` live, verificare che `/api/patients` e `/api/checkups` restituiscano dati locali dopo lo sblocco, che il conteggio pazienti sia reale, che la fascia Oggi non mostri i conteggi sintetici `312` / `24` / `7 casi` e che la pagina non contenga token paziente riservati alla revisione, come `AB-2026-014`.
- [ ] Aprire `/mockups/kree8` e verificare che rimanga soltanto un alias di revisione.
- [ ] In `Pazienti in carico`, alternare `Ambulatorio locale`, `Rete locale` e `Tutti`, poi `Attivi` ⇄ `Archivio`. Selezionare un paziente e verificare l'ingresso animato di `Anteprima caso`; `Apri quadro` deve raggiungere `Quadro paziente`, mentre `Apri scheda` deve aprire `/patients/[id]/modules`.
- [ ] In `Quadro paziente`, esercitare le azioni dell'identità e il toggle Sintesi AI ⇄ Fonti grezze; controllare Evidenze recenti, conteggi dell'anteprima Smart Import e Prossimi passaggi.
- [ ] In `Documenti`, assegnare decisioni diverse e verificare l'aggiornamento dei conteggi e il commit-pulse di ogni pill. La primaria `Porta nella scheda` deve abilitarsi solo dopo l'elaborazione di tutte le righe revisionabili; la riga SISS bloccata non deve poter essere applicata.
- [ ] In `Cataloghi`, verificare leggibilità di stato del pacchetto locale, importazione e pill semantiche. Il pannello deve restare bianco, senza gradienti a pieno fondo.
- [ ] In `Trasmissioni SISS`, attraversare i 4 passi e verificare sweep della riga, 5 webapp nella matrice di avvio e 4 capacità bloccate nelle card non integrabili. L'Esito deve dichiarare esplicitamente che il risultato è annotato manualmente.
- [ ] In `Sistema`, verificare che Account & PIN, AI locale, Modalità di rete, Backup & cataloghi, Diagnostica locale e Aggiornamento & stato corrispondano a sezioni reali delle impostazioni e che nessun testo suggerisca telemetria esterna.
- [ ] Su `/analytics`, verificare l'assenza della sidebar legacy e l'uso esclusivo di conteggi locali reali per schede, ADI, diagnosi e audit. Non devono comparire `Cruscotto Clinico`, `Presa in Carico`, `Estemporanei`, `Top Patologia` o `Prevalenza Patologie`.
- [ ] Attivare la preferenza di sistema per il movimento ridotto e verificare che si arrestino ingresso delle aree, scorrimento Case Lens, sweep, commit-pulse e stati di pressione.
- [ ] Ridurre il viewport sotto 1024px e verificare che il rail diventi una striscia orizzontale scroll-snap.
- [ ] Verificare che `/` non esponga testi da mockup né il pulsante di uscita.
- [ ] Verificare che l'alias di revisione mostri "Esci dalla review" in basso a destra.
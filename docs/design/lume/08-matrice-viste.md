---
summary: "Matrice Lume vista-per-vista, criteri golden e ordine vincolante di rifacimento."
read_when:
  - "Pianificando una slice Lume su una vista web o macOS reale."
  - "Definendo screenshot golden, contratti AX o budget di motion per una superficie Lume."
---

# Matrice delle viste Lume

Per decidere quale parte di una vista debba essere rifatta, occorre distinguere il canone Lume da ciò che è stato osservato nelle superfici del repository. Questa matrice ne registra il divario, senza dichiarare completa la migrazione né sostituire la verifica di ciascuna slice. Gli screenshot golden devono contenere esclusivamente dati clinici sintetici.

## Fonti e perimetro

Il riferimento visuale immediato, `docs/design/lume/mockups/lume-cockpit-vivo.html`, dispone il rail operativo, la worklist in penombra e il Quadro paziente in fuoco, lasciando alla coda dell'attenzione un ruolo che non generi una seconda superficie concorrente. La specifica vincolante rimane `docs/design/lume/01-lingua.md`, corretta per gesto, fuoco e Filo da `docs/design/lume/07-gesto-e-movimento.md`; i contratti nativi sono in `docs/design/lume/05-app-native.md` e `docs/design/lume/06-macos-apple-contract.md`.

Il canone definitivo ha come sorgente `docs/design/lume/canon/lume-cockpit.template.html`. Per costruirne la versione completa e confrontarla localmente si usa `node scripts/build-lume-canon.mjs /tmp/lume-cockpit.html`: ottenere quel riferimento non equivale però a verificare la vista reale.

Legenda stato:

- `fedele`: la struttura osservata applica il contratto Lume della vista e la matrice non registra un divario noto rilevante.
- `parziale`: esistono fondazioni Lume verificabili, ma rimane aperta la composizione o almeno uno dei contratti della vista.
- `legacy`: la vista è presente, ma conserva prevalentemente la struttura precedente.
- `assente`: manca una controparte della vista sulla piattaforma indicata.

## Matrice vista per vista

| Vista | Riferimento nel canone o mock | Route web reale | Vista macOS | Componenti proprietari reali | Gap concreto | Stato |
| --- | --- | --- | --- | --- | --- | --- |
| Worklist e carico pazienti | Mock vivo: rail `Ambulatorio`, `Lista di lavoro` in penombra e `Quadro paziente` in fuoco. Spec: modello focale, par. 1 e grammatica dell'attenzione, par. 6 di `docs/design/lume/01-lingua.md`. | `/` con `?area=incarico`, `app/page.tsx` | `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorklistView.swift` | `components/kree8/kree8-clinical-cockpit.tsx`; `components/kree8/areas/incarico-area.tsx`; `components/kree8/kree8-clinical-cockpit-shell.module.css` | Slice 2 consegnata: lista in penombra, selezione per superficie, stato in sotto-riga e lente paziente unica in fuoco. | `fedele` |
| Quadro paziente | Mock vivo: pannello `Quadro paziente` e coda dell'attenzione; spec, par. 1 e 6 di `docs/design/lume/01-lingua.md`. | `/patients/[id]`, `app/patients/[id]/page.tsx` | `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceView.swift` | `components/kree8/kree8-clinical-cockpit.tsx`; `components/kree8/areas/scheda-area.tsx`; `components/kree8/areas/real-patient-area.tsx` | Slice 2b consegnata: un solo fuoco, metriche interne non elevate, sezioni a hairline, Registro per codici e valori, azione primaria unica e stati onesti. | `fedele` |
| Scheda clinica | Spec: testata invariabile, densità a strati e decisioni prima dei dati, par. 6 di `docs/design/lume/01-lingua.md`. | `/patients/[id]/modules`, `app/patients/[id]/modules/page.tsx` | `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceView.swift` | `components/kree8/kree8-workspace-shell.tsx`; `components/kree8/kree8-workspace-shell.module.css`; `components/patient-synoptic-sheet.tsx`; `components/clinical-river-timeline.tsx` | Slice 3 consegnata: testata persistente, attenzione prima dei dati, una sola superficie focale e sezioni collassabili a hairline in ordine clinico. | `fedele` |
| Nuova voce clinica | Spec gesto: campo, bozza, firma e allegato, par. 3 di `docs/design/lume/07-gesto-e-movimento.md`. | `/patients/[id]/entries/new`, `app/patients/[id]/entries/new/page.tsx` | `assente` | `components/kree8/kree8-workspace-shell.tsx`; `components/clinical-rich-text-editor.tsx` | Slice 5 consegnata: dati, sessione, resoconto, allegati, contesto e azione primaria seguono un solo flusso focale; le sezioni interne usano label e hairline senza superfici elevate concorrenti. | `fedele` |
| Editor clinico | Spec gesto: editor, campo codificato e conferma esplicita, par. 3 e 6 di `docs/design/lume/07-gesto-e-movimento.md`. | `/patients/[id]/entries/new`, `app/patients/[id]/entries/new/page.tsx` | `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/ClinicalRichTextEditorView.swift` | `components/clinical-rich-text-editor.tsx`; `components/kree8/kree8-workspace-shell.module.css` | Slice 5 consegnata: toolbar e canvas sono contigui nella stessa superficie, la bozza è dichiarata a inchiostro attenuato e una sola primaria registra la voce. | `fedele` |
| Diario globale | Mock vivo: sezione `Diario`; spec Filo, par. 3 di `docs/design/lume/01-lingua.md` e par. 1-2 di `docs/design/lume/07-gesto-e-movimento.md`. | `/diary`, `app/diary/page.tsx` | `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientDiarySection.swift` | `components/kree8/areas/diario-area.tsx`; `components/ui/lume-filo.tsx`; `components/timeline.tsx`; `components/timeline-entry-card.tsx`; `components/clinical-river-timeline.tsx` | Slice 4 consegnata sul web: un solo Filo SVG compare per sequenze di almeno due voci, con un nodo per voce, fuoco via luce, stato via inchiostro e provenienza visibile. Lo stato firmato/bozza e visuale; il flusso di firma resta fuori perimetro. | `fedele` |
| Review documentale e handoff | Mock vivo: `Coda dell attenzione` e azioni che dichiarano proprietario, motivo e passo successivo. Spec: fiducia ispezionabile, par. 6 di `docs/design/lume/01-lingua.md`. | `/` con `?area=revisione` oppure `?area=handoff`, `app/page.tsx` | `assente` | `components/kree8/areas/live-document-review-area.tsx`; `components/kree8/areas/live-handoff-area.tsx`; `components/kree8/kree8-clinical-cockpit-document-review.module.css`; `components/kree8/kree8-clinical-cockpit-handoff.module.css` | Slice 5 consegnata: ogni caso espone evidenza, decisione e prossimo passo con proprietario e motivo, una sola primaria e provenienza in Registro; nessuna dashboard di pannelli equivalenti. | `fedele` |
| Analytics | Spec: il layout presenta decisioni, non un dashboard di card, par. 6 di `docs/design/lume/01-lingua.md`. | `/analytics`, `app/analytics/page.tsx` | `assente` | `app/analytics/page.tsx`; `app/analytics/analytics.module.css`; `components/kree8/kree8-workspace-shell.tsx`; `components/kree8/kree8-workspace-shell.module.css` | Slice 6 consegnata: una domanda operativa in fuoco, filtri quieti, sezioni stratificate e una tabella che possiede esplicitamente il proprio overflow; niente griglia di metriche concorrenti. | `fedele` |
| Impostazioni | Spec gesto: impostazione con anteprima immediata, reversibile e spiegabile, par. 3-4 di `docs/design/lume/07-gesto-e-movimento.md`. | `/settings`, `app/settings/page.tsx` | `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/SettingsWorkspaceView.swift` | `app/settings/page.tsx`; `components/settings/settings-lume.module.css`; `components/settings/settings-nav-sidebar.tsx`; `components/settings/settings-ui.tsx` | Slice 6 consegnata: navigazione separata dal lavoro clinico, configurazione di rete reale e reversibile, anteprima tema immediata e azione primaria unica per sezione. | `fedele` |
| Lock e sicurezza | Spec: buio operativo sobrio, focus sempre visibile e stati onesti, par. 1 e 9 di `docs/design/lume/01-lingua.md`. | Globale, `app/layout.tsx` | `assente` | `components/security-provider.tsx`; `components/lock-screen.tsx` | Nessuno dei gap 1-8 è confermato come predominante nella rilevazione: la lock screen è una prima superficie Lume già sottoposta a smoke. Ogni modifica deve comunque mantenere il contrasto e il contratto PIN. | `fedele` |
| macOS: worklist paired | Contratto Apple: penombra per lista, `RigaLista`, Registro e selezione con luce, sezioni 1-2 di `docs/design/lume/05-app-native.md`. | `assente` | `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorklistView.swift` | `native/MediFlowMac/Sources/MediFlowAppleShared/Lume.swift`; `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorklistView.swift` | Gap 8: primitive Lume e `.registro()` sono presenti, ma la derivazione visuale completa dal canone è incompleta; credenziali e carico pazienti richiedono una separazione più netta. | `parziale` |
| macOS: workspace paziente | Contratto macOS: workbench, inspector e legge dei materiali, sezioni 3-6 di `docs/design/lume/06-macos-apple-contract.md`. | `assente` | `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceView.swift` | `native/MediFlowMac/Sources/MediFlowAppleShared/Lume.swift`; `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceView.swift`; `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientDetailSection.swift` | Gap 8: superfici Lume opache esistono, ma il workspace conserva HStack a colonna fissa e non completa la derivazione strutturale prevista da split, testata persistente e inspector. Liquid Glass resta confinato a sidebar, toolbar, sheet, popover e menu di sistema. | `parziale` |

## Criteri golden per vista

Ogni golden usa fixture sintetiche e i due registri attivi, Giorno e Grafite, nelle geometrie wide 1440 x 960 e narrow 390 x 844. La prima serve a verificare la gerarchia delle aree visibili insieme; la seconda deve mostrare come la struttura si ricomponga, non come si riduca la stessa griglia. Guardia non è un tema utente e resta fuori dalla coppia minima di screenshot web.

| Vista | Giorno e Grafite, wide | Giorno e Grafite, narrow |
| --- | --- | --- |
| Worklist e carico pazienti | Rail come buio operativo, lista in penombra e un solo caso in fuoco; il colore compare solo per semantica clinica. | La lista resta leggibile e raggiungibile; ricerca, selezione e metadati non causano overflow orizzontale. |
| Quadro paziente | Testata, caso focale e coda decisionale mostrano una gerarchia unica, senza griglia di metriche equivalente al fuoco. | Testata e azioni critiche restano visibili; la coda si dispone sotto il caso senza duplicarne la priorità. |
| Scheda clinica | Testata invariabile, contenuto denso e una sola area focale; prosa in Inter, dosi, codici, date e valori in IBM Plex Mono. | Le sezioni collassano in ordine clinico senza card annidate, perdita di contesto o scorrimento orizzontale. |
| Nuova voce clinica | Contesto, form ed errore sono opachi, senza blur strutturale; la bozza è leggibile come tale e il salvataggio è sobrio. | Barra delle sezioni, form e contesto non si tagliano; i controlli mantengono un ordine di tabulazione utile. |
| Editor clinico | Toolbar, campo e superficie canvas leggono come un solo lavoro in corso, non tre card; i controlli restano visibili a focus. | Il testo va a capo, toolbar e allegati non escono dal viewport e il campo mantiene una destinazione di focus chiara. |
| Diario globale | Un Filo continuo connette solo voci temporalmente correlate; nessuna striscia colorata simula la selezione. | La timeline resta sequenziale, le date nel Registro non collidono e ciascuna voce conserva fonte e stato. |
| Review documentale e handoff | Evidenza, decisione e prossimo passo hanno relazione leggibile; l'handoff non sembra una dashboard di azioni equivalenti. | I dettagli si impilano senza perdere motivo, proprietario e stato della revisione. |
| Analytics | Una domanda operativa guida il fuoco; grafici e filtri non competono come card equivalenti. | Filtri e risultato principale si sequenziano; tabelle o grafici non richiedono scroll orizzontale non dichiarato. |
| Impostazioni | Sidebar, contenuto e feedback distinguono chrome, penombra e azione prominente; l'effetto di una scelta è ispezionabile. | La navigazione mobile apre e chiude senza nascondere la sezione attiva o il focus. |
| Lock e sicurezza | PIN, stato di lockout e call to action mantengono contrasto e una sola lettura primaria. | Input PIN, messaggio e azione restano entro viewport, con focus immediatamente osservabile. |
| macOS: worklist paired | Lista SwiftUI in field, riga selezionata in focal e Registro su identificativi e date; nessun `glassEffect` su righe cliniche. | Con Dynamic Type accessibility la riga passa in verticale, mantiene target e non tronca informazione essenziale. |
| macOS: workspace paziente | Field per lista, focal per dettaglio, chrome lasciato al sistema; nessun pannello clinico Liquid Glass. | Al resize non spariscono dati o azioni essenziali dietro una colonna fissa; il dettaglio resta il solo fuoco. |

### Interazione e selezione

- Il focus deve avere un indicatore visibile non affidato al solo colore, secondo il pattern coperto da `e2e/lume-new-entry.spec.ts` e il rail di navigazione osservabile in `e2e/web-smoke.spec.ts`.
- La selezione usa luce, elevazione corta e stato ARIA osservabile. Non si usano strisce laterali colorate, `border-left` con semantica impropria o pill colorate come unico indicatore; il Filo collega solo continuità temporale o provenienza reale.
- Editor, gruppi toggle e form devono conservare nome accessibile, descrizione, errore e ordine da tastiera. I riferimenti sono snapshot ARIA e test di tabulazione in `e2e/lume-new-entry.spec.ts`; per testata e diagnosi vale la regressione osservabile in `e2e/patient-header.spec.ts`.
- Lock e sicurezza mantengono osservabili heading, label del PIN e stato di sessione, come in `e2e/web-smoke.spec.ts`.
- Su macOS si conservano gli `accessibilityIdentifier` delle viste Swift. Prima di dichiarare fedele una vista deve essere aggiunta la prova VoiceOver lungo worklist, paziente, sezione e inspector.

### Motion, reduce motion e contrasto

- Il fuoco usa un cross-fade di luminanza e temperatura di 150-200 ms, ease-out; il Filo si disegna come SVG o `Path`, non come bordo animato. La pressione diretta applica una scala 0,97 per circa 100 ms. Portatori e tempi sono definiti in `docs/design/lume/07-gesto-e-movimento.md`.
- Non sono ammessi loop ambientali e, fuori da un gesto diretto, può muoversi al massimo un elemento nel viewport. `e2e/motion-budget.spec.ts` verifica già entrambi i vincoli su cockpit, scheda e impostazioni.
- Con Reduce Motion il Filo appare completo, bozza e firmato rimangono riconoscibili da tono ed etichetta e il fuoco dalla superficie. Le durate si dimezzano oppure il passaggio diventa istantaneo, senza morphing.
- Testo normale e controlli testuali devono raggiungere almeno 4,5:1 sulle superfici dichiarate. Il controllo di riferimento è `scripts/check-lume-tokens.mjs`, che alla rilevazione misura 42 coppie tutte sopra soglia. Il risultato non verifica da solo contrasto di focus, segnali, componenti o viste native.

## Ordine di rifacimento

La sequenza seguente è vincolante: ciascuna slice deve precedere la successiva e non può estendere il proprio perimetro ai dati o ai contratti clinici.

1. **Frame del cockpit.** Stabilizzare chrome, canvas, rail e una singola
   grammatica del fuoco. Perimetro previsto:
   `app/page.tsx`, `components/kree8/kree8-clinical-cockpit.tsx` e
   `components/kree8/kree8-clinical-cockpit.module.css`.
2. **Worklist e lente paziente.** Portare lista, selezione e caso focale al
   modello penombra-fuoco prima di aggiungere dettagli. Perimetro previsto:
   `components/kree8/areas/incarico-area.tsx`,
   `components/kree8/areas/scheda-area.tsx` e
   `components/kree8/areas/real-patient-area.tsx`.
3. **Workspace clinico.** Sostituire il workbench di hero e card con testata,
   decisione e densità a strati. Perimetro previsto:
   `app/patients/[id]/modules/page.tsx`,
   `components/kree8/kree8-workspace-shell.tsx` e
   `components/kree8/kree8-workspace-shell.module.css`.
4. **Diario e Filo.** Rendere la continuità clinica con un connettore unico e
   semantico, senza strisce laterali. Perimetro previsto:
   `app/diary/page.tsx`, `components/kree8/areas/diario-area.tsx` e
   `components/clinical-river-timeline.tsx`.
5. **Editor, review e handoff.** Comporre le fondazioni esistenti in superfici
   di lavoro focali, reviewabili e accessibili. Perimetro previsto:
   `app/patients/[id]/entries/new/page.tsx`,
   `components/clinical-rich-text-editor.tsx`,
   `components/kree8/areas/live-document-review-area.tsx` e
   `components/kree8/areas/live-handoff-area.tsx`.
6. **Analytics e settings.** Solo dopo i flussi clinici, ridurre la struttura
   legacy e chiarire le decisioni supportate. Perimetro previsto:
   `app/analytics/page.tsx`, `app/settings/page.tsx`,
   `components/settings/settings-nav-sidebar.tsx` e
   `components/settings/settings-ui.tsx`.

Dopo il frame web, macOS segue lo stesso ordine concettuale: prima le primitive in `native/MediFlowMac/Sources/MediFlowAppleShared/Lume.swift`, poi worklist e workspace in `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorklistView.swift` e `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceView.swift`. Il materiale delle superfici di sistema resta nativo; le superfici cliniche costruite dall'app restano opache.

## Verifica della matrice

Il controllo seguente attraversa tutti i percorsi locali con estensione citati nella pagina e deve fallire alla prima assenza:

```zsh
rg -o '`(app|components|native|docs|scripts|e2e)/[^` ]+\.(tsx|swift|md|html|json|mjs)`' docs/design/lume/08-matrice-viste.md \
  | tr -d '`' \
  | sort -u \
  | while IFS= read -r file_path; do
      test -e "$file_path" || { print -u2 "manca: $file_path"; exit 1; }
    done
```

Al commit va registrato l'esito effettivo del controllo dei percorsi, con le eventuali correzioni verificate. È inoltre obbligatorio il controllo editoriale sul carattere em dash: la ricerca non deve restituire righe.

<a id="ambiguita-che-richiedono-giudizio-umano"></a>

## Ambiguità che richiedono giudizio umano

- Il template canonico è disponibile e costruibile localmente, ma il confronto con Worklist, Quadro e Scheda richiede di esaminare struttura e comportamento; non è un'equivalenza visuale automatica.
- Worklist e carico pazienti, Quadro paziente, Scheda clinica, Diario globale e Lock e sicurezza sono classificati `fedele` in base a struttura osservata e smoke disponibili. In nessuno dei cinque casi questo stato sostituisce la prova visuale manuale Giorno e Grafite su display reale.
- Per Nuova voce clinica, Editor clinico e Review documentale e handoff, la slice 5 assegna `fedele` sulla base del contratto strutturale, delle prove E2E nei due registri e delle catture wide e narrow. Densità e ritmo richiedono comunque una verifica manuale sul display reale.
- Per Analytics e Impostazioni, la slice 6 assegna `fedele` in base alla domanda operativa unica, alla configurazione reversibile e alle prove E2E Giorno e Grafite, wide e narrow. Le catture automatizzate documentano la struttura, senza sostituire la verifica visuale manuale sul display reale.
- L'assenza macOS indicata per review, handoff e analytics riguarda quelle specifiche viste, non l'intera funzionalità dell'app Apple. La QA VoiceOver end-to-end macOS rimane una verifica da decidere ed eseguire manualmente.
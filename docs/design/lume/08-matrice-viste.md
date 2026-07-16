---
summary: "Matrice Lume vista-per-vista, criteri golden e ordine vincolante di rifacimento."
read_when:
  - "Pianificando una slice Lume su una vista web o macOS reale."
  - "Definendo screenshot golden, contratti AX o budget di motion per una superficie Lume."
---

# Matrice delle viste Lume

Questa matrice rileva il divario tra il canone Lume e le superfici realmente
presenti nel repository. Non dichiara una migrazione completa e non sostituisce
la verifica della singola slice. I dati clinici negli screenshot golden devono
essere sempre sintetici.

## Fonti e perimetro

Il riferimento visuale immediato è
`docs/design/lume/mockups/lume-cockpit-vivo.html`: rail operativo, worklist in
penombra, Quadro paziente in fuoco e coda dell'attenzione senza una seconda
superficie concorrente. La specifica vincolante resta `docs/design/lume/01-lingua.md`,
con la correzione di gesto, fuoco e Filo in
`docs/design/lume/07-gesto-e-movimento.md`. I contratti nativi sono in
`docs/design/lume/05-app-native.md` e
`docs/design/lume/06-macos-apple-contract.md`.

Il sorgente definitivo del canone, atteso dalla dipendenza #87, è
`docs/design/lume/canon/lume-cockpit.template.html`. Al momento della rilevazione
questo percorso non è presente nel worktree #88 e quindi non viene contato nella
verifica di massa seguente. Va riallineato prima di unire questa matrice: non è
una prova di implementazione locale.

Legenda stato:

- `fedele`: la struttura osservata applica il contratto Lume della vista, senza
  un gap noto rilevante in questa matrice.
- `parziale`: sono presenti fondazioni Lume verificabili, ma la composizione o
  uno dei contratti della vista resta aperto.
- `legacy`: la vista esiste, ma la sua struttura principale conserva il modello
  precedente.
- `assente`: non esiste una controparte nella piattaforma indicata.

## Matrice vista per vista

| Vista | Riferimento nel canone o mock | Route web reale | Vista macOS | Componenti proprietari reali | Gap concreto | Stato |
| --- | --- | --- | --- | --- | --- | --- |
| Worklist e carico pazienti | Mock vivo: rail `Ambulatorio`, `Lista di lavoro` in penombra e `Quadro paziente` in fuoco. Spec: modello focale, par. 1 e grammatica dell'attenzione, par. 6 di `docs/design/lume/01-lingua.md`. | `/` con `?area=incarico`, `app/page.tsx` | `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorklistView.swift` | `components/kree8/kree8-clinical-cockpit.tsx`; `components/kree8/areas/incarico-area.tsx`; `components/kree8/kree8-clinical-cockpit-shell.module.css` | Slice 2 consegnata: lista in penombra, selezione per superficie, stato in sotto-riga e lente paziente unica in fuoco. | `fedele` |
| Quadro paziente | Mock vivo: pannello `Quadro paziente` e coda dell'attenzione; spec, par. 1 e 6 di `docs/design/lume/01-lingua.md`. | `/patients/[id]`, `app/patients/[id]/page.tsx` | `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceView.swift` | `components/kree8/kree8-clinical-cockpit.tsx`; `components/kree8/areas/scheda-area.tsx`; `components/kree8/areas/real-patient-area.tsx` | La lente focale della worklist è consegnata; il Quadro completo conserva metric-card grid e più focalità in competizione. | `parziale` |
| Scheda clinica | Spec: testata invariabile, densità a strati e decisioni prima dei dati, par. 6 di `docs/design/lume/01-lingua.md`. | `/patients/[id]/modules`, `app/patients/[id]/modules/page.tsx` | `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceView.swift` | `components/kree8/kree8-workspace-shell.tsx`; `components/kree8/kree8-workspace-shell.module.css`; `components/patient-synoptic-sheet.tsx`; `components/clinical-river-timeline.tsx` | Gap 4: workbench Kree8 con hero e card annidate; serve un workspace clinico organizzato per decisione e una sola superficie focale. | `legacy` |
| Nuova voce clinica | Spec gesto: campo, bozza, firma e allegato, par. 3 di `docs/design/lume/07-gesto-e-movimento.md`. | `/patients/[id]/entries/new`, `app/patients/[id]/entries/new/page.tsx` | `assente` | `components/kree8/kree8-workspace-shell.tsx`; `components/clinical-rich-text-editor.tsx` | Gap 6: le fondazioni opache sono presenti, ma form, contesto e azioni restano composti come pannelli autonomi anziché come un unico flusso focale. | `parziale` |
| Editor clinico | Spec gesto: editor, campo codificato e conferma esplicita, par. 3 e 6 di `docs/design/lume/07-gesto-e-movimento.md`. | `/patients/[id]/entries/new`, `app/patients/[id]/entries/new/page.tsx` | `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/ClinicalRichTextEditorView.swift` | `components/clinical-rich-text-editor.tsx`; `components/kree8/kree8-workspace-shell.module.css` | Gap 6: toolbar, campo e contorno hanno fondazioni Lume, ma il loro insieme è ancora pannellizzato; la firma e il rapporto bozza-firmato vanno verificati nella composizione. | `parziale` |
| Diario globale | Mock vivo: sezione `Diario`; spec Filo, par. 3 di `docs/design/lume/01-lingua.md` e par. 1-2 di `docs/design/lume/07-gesto-e-movimento.md`. | `/diary`, `app/diary/page.tsx` | `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientDiarySection.swift` | `components/kree8/kree8-clinical-cockpit.tsx`; `components/kree8/areas/diario-area.tsx`; `components/clinical-river-timeline.tsx` | Gap 5: le voci sono ancora card isolate; il diario deve usare un solo Filo continuo quando la relazione temporale è reale. | `legacy` |
| Review documentale e handoff | Mock vivo: `Coda dell attenzione` e azioni che dichiarano proprietario, motivo e passo successivo. Spec: fiducia ispezionabile, par. 6 di `docs/design/lume/01-lingua.md`. | `/` con `?area=revisione` oppure `?area=handoff`, `app/page.tsx` | `assente` | `components/kree8/areas/live-document-review-area.tsx`; `components/kree8/areas/live-handoff-area.tsx`; `components/kree8/kree8-clinical-cockpit.module.css` | Gap 6: review e handoff possiedono fondazioni Lume, ma restano una successione di pannelli; provenienza e stato di revisione devono avere una gerarchia unica. | `parziale` |
| Analytics | Spec: il layout presenta decisioni, non un dashboard di card, par. 6 di `docs/design/lume/01-lingua.md`. | `/analytics`, `app/analytics/page.tsx` | `assente` | `components/kree8/kree8-workspace-shell.tsx`; `components/kree8/kree8-workspace-shell.module.css` | Gap 7: struttura analytics legacy; prima di rifinirla serve fissare la domanda decisionale e ridurre card e metriche concorrenti. | `legacy` |
| Impostazioni | Spec gesto: impostazione con anteprima immediata, reversibile e spiegabile, par. 3-4 di `docs/design/lume/07-gesto-e-movimento.md`. | `/settings`, `app/settings/page.tsx` | `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/SettingsWorkspaceView.swift` | `components/settings/settings-nav-sidebar.tsx`; `components/settings/settings-ui.tsx` | Gap 7: navigation e contenuto settings sono legacy strutturale; la configurazione deve restare separata dal lavoro clinico e non diventare una griglia di pannelli. | `legacy` |
| Lock e sicurezza | Spec: buio operativo sobrio, focus sempre visibile e stati onesti, par. 1 e 9 di `docs/design/lume/01-lingua.md`. | Globale, `app/layout.tsx` | `assente` | `components/security-provider.tsx`; `components/lock-screen.tsx` | Nessuno dei gap 1-8 è confermato come predominante nella rilevazione: la lock screen è una prima superficie Lume già sottoposta a smoke. Ogni modifica deve comunque mantenere il contrasto e il contratto PIN. | `fedele` |
| macOS: worklist paired | Contratto Apple: penombra per lista, `RigaLista`, Registro e selezione con luce, sezioni 1-2 di `docs/design/lume/05-app-native.md`. | `assente` | `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorklistView.swift` | `native/MediFlowMac/Sources/MediFlowAppleShared/Lume.swift`; `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorklistView.swift` | Gap 8: primitive Lume e `.registro()` sono presenti, ma la derivazione visuale completa dal canone è incompleta; credenziali e carico pazienti richiedono una separazione più netta. | `parziale` |
| macOS: workspace paziente | Contratto macOS: workbench, inspector e legge dei materiali, sezioni 3-6 di `docs/design/lume/06-macos-apple-contract.md`. | `assente` | `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceView.swift` | `native/MediFlowMac/Sources/MediFlowAppleShared/Lume.swift`; `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceView.swift`; `native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientDetailSection.swift` | Gap 8: superfici Lume opache esistono, ma il workspace conserva HStack a colonna fissa e non completa la derivazione strutturale prevista da split, testata persistente e inspector. Liquid Glass resta confinato a sidebar, toolbar, sheet, popover e menu di sistema. | `parziale` |

## Criteri golden per vista

Ogni golden usa fixture sintetiche, due registri attivi, Giorno e Grafite, e due
geometrie di riferimento: wide 1440 x 960 e narrow 390 x 844. La cattura wide
prova la gerarchia simultanea; la narrow prova il collasso strutturale, non una
versione ridotta della stessa griglia. Guardia non è un tema utente e non fa
parte della coppia minima di screenshot web.

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

- Il focus è visibile con indicatore non affidato al solo colore, rispettando il
  pattern già coperto da `e2e/lume-new-entry.spec.ts` e il rail di navigazione
  osservabile in `e2e/web-smoke.spec.ts`.
- La selezione usa luce, elevazione corta e stato ARIA osservabile. Non usa una
  striscia laterale colorata, un `border-left` semantico improprio o una pill
  colorata come unico indicatore. Il Filo collega solo continuità temporale o
  provenienza reale.
- Editor, gruppi toggle e form devono conservare nome accessibile, descrizione,
  errore e ordine tastiera. Il contratto di riferimento è la snapshot ARIA e il
  test di tabulazione in `e2e/lume-new-entry.spec.ts`; testata e diagnosi hanno
  la regressione osservabile in `e2e/patient-header.spec.ts`.
- Lock e sicurezza mantengono heading, label del PIN e stato di sessione
  osservabili come in `e2e/web-smoke.spec.ts`.
- Per macOS si preservano gli `accessibilityIdentifier` già presenti nelle viste
  Swift e si aggiunge la prova VoiceOver del percorso worklist, paziente,
  sezione e inspector prima di dichiarare la vista fedele.

### Motion, reduce motion e contrasto

- Fuoco: cross-fade di luminanza e temperatura in 150-200 ms, ease-out. Filo:
  disegno SVG o `Path`, non bordo animato. Pressione diretta: scala 0,97 circa
  100 ms. I tempi e i portatori sono definiti in
  `docs/design/lume/07-gesto-e-movimento.md`.
- Non sono ammessi loop ambientali. Fuori da un gesto diretto, al massimo un
  elemento è in moto nel viewport. `e2e/motion-budget.spec.ts` già verifica
  assenza di loop e questo limite su cockpit, scheda e impostazioni.
- Con Reduce Motion il contenuto resta già leggibile: Filo completo, stato
  bozza o firmato espresso da tono ed etichetta, fuoco espresso da superficie.
  Le durate si dimezzano o la transizione diventa istantanea senza morphing.
- Le soglie misurate sono almeno 4,5:1 per testo normale e controlli testuali
  sulle superfici dichiarate. `scripts/check-lume-tokens.mjs` è il controllo
  autorevole: alla rilevazione misura 42 coppie, tutte sopra soglia. Non prova
  da solo contrasto di focus, segnali, componenti o viste native.

## Ordine di rifacimento

La sequenza è vincolante. Una slice non anticipa la successiva e non amplia il
perimetro ai dati o ai contratti clinici.

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

Il macOS segue questo ordine concettuale dopo il frame web: prima le primitive
in `native/MediFlowMac/Sources/MediFlowAppleShared/Lume.swift`, poi worklist e
workspace in
`native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorklistView.swift`
e
`native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceView.swift`.
Le superfici di sistema conservano il materiale nativo; Lume resta opaco nelle
superfici cliniche costruite dall'app.

## Verifica della matrice

La verifica di massa considera tutti i percorsi locali con estensione citati in
questo documento, esclude soltanto il sorgente canonico #87 dichiarato assente
all'inizio e fallisce alla prima mancanza:

```zsh
rg -o '`(app|components|native|docs|scripts|e2e)/[^` ]+\.(tsx|swift|md|html|json|mjs)`' docs/design/lume/08-matrice-viste.md \
  | tr -d '`' \
  | sort -u \
  | while IFS= read -r file_path; do
      [[ "$file_path" == "docs/design/lume/canon/lume-cockpit.template.html" ]] && continue
      test -e "$file_path" || { print -u2 "manca: $file_path"; exit 1; }
    done
```

Esito da registrare al commit: percorsi locali verificati e corretti dopo
verifica; sorgente #87 separato come dipendenza nota. Controllo editoriale
obbligatorio: la ricerca del carattere em dash non produce righe.

## Ambiguita che richiedono giudizio umano

- Il template #87 non era disponibile in questo worktree. La corrispondenza
  puntuale fra le sue sezioni e il mock vivo va verificata al suo arrivo, senza
  riscrivere retroattivamente i gap come successi.
- La matrice usa `fedele` soltanto per lock e sicurezza, sulla base della
  superficie e dei smoke disponibili. Non sostituisce una prova visuale
  manuale Giorno e Grafite su display reale.
- La controparte macOS di review, handoff e analytics è segnata assente per la
  vista specifica, non come affermazione di assenza funzionale dell'intera app
  Apple. La QA VoiceOver end-to-end macOS è ancora una decisione manuale.

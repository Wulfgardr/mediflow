# MediFlow 0.8.6: proposta macOS con una sola lista laterale

Stato: candidato locale del 6 settembre 2026, successivo a `f1b023964`.
La precedente rifinitura Apple era stata giudicata dall'utente ancora troppo
vicina all'interfaccia originaria; questa proposta cambia quindi la disposizione
della finestra. Compilazione e test ne verificano aspetti tecnici,
non sostituiscono l'accettazione estetica.

## Disposizione e funzioni

- Pazienti, Agenda, Diario, Analytics e Scale occupano la barra superiore.
  Repertori, Impostazioni, Host, Runtime, Panoramica e Tappe restano nel menu
  delle altre aree e nei comandi esistenti.
- Una sola lista laterale permette di selezionare il paziente con un clic
  nativo, filtrare lo stato, ordinare e leggere il conteggio dei risultati
  caricati. Nuovo paziente rimane nella toolbar, soggetto al proprio
  controllo di disponibilità.
- Nome, riferimenti e sette sezioni restano sopra il contenuto scorrevole;
  i titoli brevi conservano le etichette accessibili complete.
- La lettura avviene su una superficie continua: identità, contatti e presa
  in carico usano colonne adattive, mentre esenzioni e valori possono andare
  a capo. Sono rimossi i sei riquadri numerici iniziali e l'indice duplicato
  prima dei dati. Filtro e significato del prossimo follow-up non cambiano.
- Campi di sistema e titoli di sezione rendono riconoscibile il lavoro sul
  Mac senza aggiungere vetro ai filtri della worklist. Il codice diagnostico
  segue la riga nativa, perché il precedente riquadro chiaro diventava
  illeggibile quando selezionato nel tema scuro.

Orientamento, vicinanza e approfondimento progressivo derivano dalla
[raccolta Breccia](./2026-09-06-breccia-apple-reference.md) e dal
[contratto macOS](./lume/06-macos-apple-contract.md). Il loro uso è una
traduzione per MediFlow, non una disposizione prescritta dal designer.
L'atlante degli otto fotogrammi resta nella raccolta locale e non rappresenta
la visione dell'intero canale.

Il cambiamento di disposizione conserva modello per finestra, selezioni,
bozze, writer, capability e ciclo di vita della registrazione. Il dettaglio
dell'allegato resta nel proprio sheet: non viene introdotta una consultazione
affiancata. Anche l'inspector resta di sola lettura, con sheet compatibile
limitato alla major macOS 27; il percorso iOS/iPadOS non cambia.

## Verifica locale

La verifica usa il worktree `mediflow-086-macos-redesign` e il branch
`codex/WUL-676-086-macos-redesign`, con Xcode 26.6, SDK 26.5 e host macOS 27.0.
Il volume Xcode è montato, senza modificare il selettore globale.

| Prova | Esito e limite |
| --- | --- |
| Xcode Debug macOS arm64 | PASS finale, firma disabilitata. |
| Xcode Debug iOS Simulator | PASS; l'ultima correzione successiva riguarda soltanto il ramo Mac del codice diagnostico. Nessun nuovo run UI mobile attribuito a questa lane. |
| SwiftPM mirato | 87 test PASS, zero fallimenti/skip: selezione, filtri, layout, bozze, registrazione, comandi per finestra, inspector, rendering e contrasto. |
| Guard e documentazione | Never-regress, claims, Lume, `git diff --check`, inventario Markdown e link locali PASS. Il guard Lume conserva il debito storico già in allowlist. |
| Finestra reale | Consultazione a 1100×760 e 1440×900; nome, sezioni, testo e controlli leggibili nelle viste osservate. |
| Bozza sintetica | Apertura, titolo digitato, passaggio alle terapie, ritorno al diario e ripresa con titolo conservato. Nessun salvataggio clinico. |
| Tema scuro e accessibilità | Cattura con override locale `accessibility1` e riduzione del movimento; gruppi su una colonna. Non equivale a una sessione VoiceOver completa o a tutte le preferenze assistive. |
| Navigazione e inspector | Menu delle altre aree, apertura Impostazioni, ritorno alla cartella; apertura dello sheet compatibile e chiusura da tastiera. |
| Revisione indipendente Astra | Nessun P1/P2 concreto nel diff finale esaminato; review statica, non prova visiva indipendente. |

Le prime build hanno mostrato che il materiale della toolbar si sovrapponeva
alla testata nel `NavigationSplitView` annidato. La disposizione finale usa
quindi un solo `HSplitView` sotto la navigazione principale e mantiene
la testata fuori dal piano scorrevole; la correzione è stata osservata
nella finestra reale. È stato rimosso il vecchio test che confrontava due
campioni fittizi dello stesso sfondo, perché non provava la composizione
della finestra. Gli altri test dei colori mantengono un perimetro esplicito
e non sostituiscono gli screenshot.

Log, screenshot sintetici e ricevuta con hash restano fuori Git in
`tmp-086-macos-redesign/`. Nel perimetro di questa verifica rimangono aperte
la valutazione estetica delle viste e la qualifica di dispositivi fisici,
pairing, installazione, firma e distribuzione. Le prove non autorizzano
pubblicazione, PR o release.
# MediFlow 0.8.6: proposta macOS con una sola lista laterale

Stato: candidato locale del 6 settembre 2026, successivo a `f1b023964`.
L'utente ha giudicato la precedente rifinitura Apple ancora troppo simile
all'interfaccia originaria. Questo intervento cambia la disposizione della
finestra; l'accettazione estetica resta distinta da compilazione e test.

## Disposizione e funzioni

- Pazienti, Agenda, Diario, Analytics e Scale sono nella barra superiore.
  Repertori, Impostazioni, Host, Runtime, Panoramica e Tappe rimangono nel
  menu delle altre aree e nei comandi esistenti.
- La cartella ha una sola lista laterale, con selezione nativa a un clic,
  filtri di stato, ordine e conteggio dei risultati nell'elenco caricato.
  Nuovo paziente rimane nella toolbar con il suo controllo di disponibilità.
- Nome, riferimenti e sette sezioni restano sopra il contenuto scorrevole.
  I titoli brevi della navigazione conservano etichette accessibili complete.
- La superficie di lettura è continua. Identità, contatti e presa in carico
  usano colonne adattive; esenzioni e valori possono andare a capo. Non ci
  sono più sei riquadri numerici iniziali né l'indice duplicato prima dei dati.
  Il prossimo follow-up conserva il filtro e il significato precedenti.
- Il Mac usa campi di sistema e titoli di sezione più riconoscibili. I filtri
  della worklist non hanno un ulteriore involucro in vetro. Il codice diagnostico
  segue la riga nativa: il vecchio riquadro chiaro risultava illeggibile quando
  selezionato nel tema scuro.

La proposta applica orientamento, vicinanza e profondità progressiva della
[raccolta Breccia](./2026-09-06-breccia-apple-reference.md) e del
[contratto macOS](./lume/06-macos-apple-contract.md). È una traduzione per
MediFlow, non un layout prescritto dal designer. L'atlante con gli otto
fotogrammi rimane nella raccolta locale; non si dichiara la visione di tutto
il canale.

Il modello per finestra, le selezioni, le bozze, i writer, le capability e
il ciclo di vita della registrazione restano invariati. Il dettaglio allegato
rimane nel suo sheet: non è stata implementata una nuova consultazione
affiancata. L'inspector resta sola lettura, con lo sheet compatibile della
sola major macOS 27. Non cambia il percorso iOS/iPadOS.

## Verifica locale

Worktree `mediflow-086-macos-redesign`, branch `codex/WUL-676-086-macos-redesign`.
Toolchain Xcode 26.6, SDK 26.5, host macOS 27.0. Il volume Xcode è montato;
il selettore globale non è stato modificato.

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

Le prime build hanno esposto una sovrapposizione del materiale della toolbar
alla testata nel `NavigationSplitView` annidato. La disposizione finale usa
un solo `HSplitView` sotto la navigazione principale, con la testata fuori
dal piano scorrevole. La correzione è stata osservata nella finestra reale.
È stato rimosso un vecchio test che confrontava due campioni fittizi dello
stesso sfondo: non provava la composizione della finestra. I restanti test
dei colori conservano un perimetro esplicito e non sostituiscono gli screenshot.

Log, screenshot sintetici e ricevuta con hash sono in `tmp-086-macos-redesign/`,
escluso da Git. Restano da valutare esteticamente le viste e da qualificare
dispositivi fisici, pairing, installazione, firma e distribuzione. Nessuna
pubblicazione, PR o release è autorizzata da queste prove.

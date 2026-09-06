# MediFlow 0.8.6: verifica della cartella Apple

6 settembre 2026, lane `codex/WUL-676-086-apple-refinement`, base funzionale
`07725c7ebd73524ef081a7b6b94f85b5de5627ce`. Candidato locale, senza firma,
pubblicazione o installazione su dispositivi fisici.

## Cambiamento

La cartella mostra una sezione clinica alla volta e mantiene una navigazione
esplicita. Un tocco apre il dettaglio su iPhone; iPad ampio e Mac conservano
lista e cartella affiancate. La scheda iniziale rimanda ai contenuti caricati,
mentre il menu rende raggiungibili tutti i sette gruppi. Non caricato, errore
e archivio vuoto restano stati distinti.

Nuova voce, allegati e trascrizione hanno aperture progressive. Titolo, tipo,
testo e bozza di trascrizione restano nel modello durante la consultazione
dei Documenti. Il binding dell'editor legge il documento corrente a ogni
modifica: la precedente cattura del valore di rendering poteva perdere
caratteri digitati rapidamente. Il dettaglio dell'allegato è presentato dal
workspace, anche quando viene aperto dal Diario.

Il Mac conserva la larghezza delle colonne cambiando sezione. La cattura
audio si ferma uscendo dal Diario; il testo finalizzato e rivisto rimane in
memoria per lo stesso paziente e la stessa sessione. Sostituire testo manuale
richiede una conferma riferita a entrambi i testi correnti. Cambi di owner o
sessione invalidano la revisione; nessun salvataggio o trasferimento è implicito.

[Criteri e fonti Breccia](../design/2026-09-06-breccia-apple-reference.md)
spiegano le scelte e rimandano all'atlante illustrato locale. Il redesign
implementato riguarda questa cartella, non tutte le superfici delle app.

## Ambiente e prove

Il volume `/Volumes/Xcode Development` è stato montato dal bundle già presente
sul disco collegato. Toolchain selezionata per i comandi tramite
`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`: Xcode 26.6
(`17F113`), SDK simulatore 26.5. Nessuna modifica globale di `xcode-select`.
Creati due simulatori dedicati, iPhone 17 Pro e iPad Pro 11 M5; gli altri
dispositivi sono stati preservati. I deployment target esistenti non cambiano.

Le build usano `MediFlowAppleApp.xcodeproj`, configurazione Debug e
`CODE_SIGNING_ALLOWED=NO`. Log e risultati `.xcresult` sono fuori Git in
`tmp-086-apple/`; l'ambiente è registrato in `environment-receipt.json`.

| Verifica eseguita | Esito e confine |
| --- | --- |
| Build iOS Simulator e macOS | PASS con la toolchain montata. Sono build locali, senza distribuzione. |
| SwiftPM: selezione, documenti, S7, layout, binding e famiglie VisitRecording | 124 eseguiti, 123 PASS, uno skip previsto, zero fallimenti; `native-final-tests.log`. Il benchmark sintetico richiede un manifest esplicito. |
| iPad: Dynamic Type accessibile, rotazione e colonne, selezione delle sezioni | Quattro scenari PASS nel lotto `ipad-ui`; il quinto aveva rilevato il difetto del binding, poi corretto. |
| iPad: bozza completa dopo Documenti | PASS finale senza diagnostica temporanea in `ipad-diary-final-no-probe`, 73,001 s; titolo, tipo, blocco, trascrizione e assenza di salvataggi impliciti. |
| iPhone: bozza completa dopo Documenti | PASS senza diagnostica temporanea in `iphone-diary-final-no-probe`, 94,503 s; stesse asserzioni di contenuto. |
| Mac: esecuzione della build demo | Un clic, sezioni, Documenti, nuova voce e trascrizione osservati. Divisore stabile al cambio sezione; contenuto riportato in cima. Root accessibile e consenso microfono hanno identificatori distinti. |
| `check-apple-structure.sh`, `check-apple-network-entitlements.sh`, `git diff --check` | PASS. |

Le prove UI usano esclusivamente le fixture Debug sintetiche. Non salvano
visite, non importano documenti, non eseguono inferenza e non richiedono il
microfono. I test del coordinatore sostituiscono la cattura: non sono prove
di registrazione reale. Le prove di navigazione non sostituiscono pairing,
trasporto TLS, scritture su Homebase o condivisione esterna.

## Diagnosi dei tentativi falliti

Le prime prove hanno corretto sia asserzioni obsolete sul menu Tipo e sui
contenitori accessibili, sia il difetto reale di aggiornamento del testo.
Il successivo fallimento su iPhone dipendeva dal gesto veloce unidirezionale
del test: con la tastiera aperta saltava oltre Allegati. La cattura testuale
mostrava un contenitore e un pulsante esistenti, fuori dalla finestra visibile.
Il test ora scorre lentamente nella cartella, scegliendo il verso dalle
posizioni osservate, e richiede comunque il pulsante raggiungibile.

La precedente ipotesi di perdita dell'albero accessibile non è confermata:
gli export binari abbreviati non erano una prova sufficiente. Nessuna
asserzione su contenuto, duplicazioni, salvataggio o ritorno alla bozza è
stata rimossa. Un processo Xcode di diagnostica rimasto fermo dopo un errore
è stato arrestato; i tentativi seguenti usano `-collect-test-diagnostics never`.

Non è stata eseguita l'intera suite UI di 40 test. VoiceOver manuale, tutti
i dispositivi, tutte le versioni supportate e tutte le combinazioni di
aspetto rimangono fuori da questa verifica. Le prove del candidato integrato
successivo sono riportate nel suo verbale, senza riscrivere questi risultati.

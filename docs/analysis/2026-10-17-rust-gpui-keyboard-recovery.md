---
summary: "Parità tastiera GPUI ricostruita dopo il reset del workspace: canoni, prove aggiornate, ridimensionamento e provenienza sintetica."
read_when:
  - "Verifying keyboard parity or resize behavior in the connected GPUI client."
  - "Reviewing the recovered Rust sources and their new execution evidence."
---

# GPUI: parità tastiera e prove dopo il ripristino

Data: 17 ottobre 2026.

Il delta aggiunge ricerca nella vista, navigazione della worklist, nuova voce
e blocco secondo il contratto condiviso. Corregge inoltre lo stato del menu
moduli e il focus quando una finestra compatta torna al desktop. Il codice
è stato ricostruito sul commit `db98dcf0993d1cae69508186a6e3f7a8d3f2c984`
dopo un reset del workspace: le prove qui allegate sono esecuzioni nuove,
con hash propri. Le precedenti immagini non recuperabili non sono state
ricreate né riattribuite.

La [ricevuta dei controlli](../../experiments/gpui-patient-pilot/evidence/connected/keyboard-recovery/checks.json)
identifica i tre sorgenti modificati e il binario effettivamente usato.
Test dell'app: **45 superati, zero falliti**. `cargo fmt --all --check`,
clippy con `-D warnings` e build sono conclusi con esito positivo su Linux,
Rust 1.98.1 e GPUI fissato alla revisione
`56934ec0560bce8929025497411de7f5322fb6ca`.

## Contratto e comportamento

Riferimenti: [DESIGN.md](../../DESIGN.md),
[tastiera Punto d'inchiostro](../design/punto-inchiostro/01-specifica.md#tastiera),
[worklist Web](../../components/kree8/areas/incarico-area.tsx),
[regole di navigazione Web](../../lib/kree8-keyboard-navigation.ts) e
[menu macOS corrente](../../native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/MacWorkspaceRootView.swift).

| Comando | Comportamento GPUI |
| --- | --- |
| `/` | Focalizza e seleziona la ricerca della vista attiva: elenco Pazienti, Agenda, Diario o Repertori. Non esce dalla scheda paziente. |
| `j` / `k` | Nella worklist passa alla riga visibile successiva o precedente. Usa prima la riga focalizzata, poi la selezione visibile; senza un riferimento parte dalla prima riga. Non torna dall'ultimo al primo elemento. |
| `↓` / `↑` | Stessa navigazione, limitata al focus nell'elenco. Filtri e ordine visibile restano applicati. |
| Invio o Spazio sulla riga | Apre la scheda anche sul desktop ampio. Il click del puntatore sul desktop mantiene l'anteprima corrente. |
| Cmd/Ctrl+N | Apre «Nuova voce» per il paziente corrente ammesso, tramite lo stesso percorso del pulsante. Non sostituisce una bozza e non usa l'anteprima di un altro paziente rispetto alla riga focalizzata. |
| Cmd/Ctrl+L | Blocca immediatamente, anche da un campo di testo. Cmd/Ctrl+Shift+L resta un alias. |
| Cmd/Ctrl+Invio | Conserva il percorso esistente di revisione. Ripetere la scorciatoia nella revisione non registra: serve il comando esplicito «Conferma e registra». |

Le scorciatoie a carattere, le frecce di elenco e la nuova voce escludono
ogni contesto `MediFlowTextInput`, compresi gli antenati nel percorso del
focus. La navigazione e la nuova voce verificano inoltre sessione, ambulatorio,
bozza, conferma di scarto, caricamenti di modifica, upload e menu attivi.
Il percorso di creazione riusa i controlli esistenti su autorizzazioni,
scheda archiviata o eliminata e dati caricati.

Il modificatore `secondary` di GPUI significa Cmd su macOS e Ctrl su
Windows/Linux. Questa ricevuta esegue il ramo Linux; il test della keymap
sceglie il modificatore della piattaforma su cui viene compilato.

### Differenze intenzionali

Il menu Swift macOS corrente assegna Cmd+N a «Nuovo paziente». La worklist
Web usa `n` senza modificatore e deve convivere con i comandi del browser.
Per GPUI è stato adottato il significato «Nuova voce» della specifica
condivisa, senza cambiare quelle shell. La scorciatoia di revisione conserva
il comportamento prudente del client collegato: la ripetizione non diventa
una conferma implicita. Non sono introdotti una palette comandi o nuovi
comandi di ascolto.

## Ridimensionamento e stato del form

Il menu moduli compatto impedisce Cmd/Ctrl+N solo quando è effettivamente
visibile, in base alla larghezza e alla scala del testo. Se il selettore
focalizzato scompare al ritorno sul desktop, il focus passa alla radice
dello spazio di lavoro; un editor che resta visibile non viene rifocalizzato.

La creazione riuscita di un form chiude lo stato del menu moduli in tutti
e tre i punti che assegnano il nuovo form: `open_form`, `stage_fields` e
callback del documento caricato. Il reset segue l'assegnazione riuscita;
un rifiuto o un caricamento fallito non cambia quel menu. Il suo stato
latente non può così sottrarre spazio al corpo della bozza quando si torna
alla geometria compatta.

I cinque test aggiunti verificano l'ordine filtrato, i limiti della lista,
la precedenza del focus rispetto all'anteprima e il vero motore
`gpui::Keymap` con contesti annidati. Controllano inoltre che nuova voce,
blocco e revisione restino azioni distinte. Le due ulteriori assegnazioni
del menu nei percorsi modifica/upload sono state riesaminate nei sorgenti;
non sono presentate come percorsi grafici rieseguiti in questa QA mirata.

## Prova nativa e provenienza

La [ricevuta nativa](../../experiments/gpui-patient-pilot/evidence/connected/keyboard-recovery/native-qa.json)
contiene provenienza, sequenze, hash delle PNG originali, focus e posizione
di scorrimento. Tutte le immagini sono catture della sola finestra GPUI,
ottenute con `import -window`, senza ritagli, ritocchi o composizioni.
Il binario è:

`1803dd7f91f9cd796d6dd9f1136b23456a2dcf3e07beae330dbaaa5d11ea481d`

### Stato di pubblicazione delle catture

La QA ha osservato **nove PNG originali**. La selezione per il commit
comprende **otto immagini, dalla 01 alla 08**: root ha completato la
creazione dei relativi blob GitHub. La nona cattura,
`09-locked-from-editor.png`, resta conservata localmente e non è inclusa
nel commit.

Il controllo automatico di approvazione di `github_create_blob` ha
rifiutato la pubblicazione della nona immagine, indicando contenuti
visivi potenzialmente clinici o riferiti a pazienti e la necessità di
un'autorizzazione esplicita per quel preciso payload. Il controllo ha
specificato che l'autorizzazione generale «Autorizzo tutto» e le prove
di provenienza o privacy non stabiliscono tale autorizzazione puntuale.
L'immagine non è stata ritentata, ricodificata o sostituita in questa
revisione editoriale. L'autorizzazione puntuale resta in attesa.

L'esito osservato del blocco da editor rimane nella ricevuta nativa;
non è stata ripetuta la QA. I metadati della cattura trattenuta sono in
`withheldArtifacts`, senza immagine incorporata né collegamento pubblico:
SHA-256 `ea66b781081ea7020f5775c4aa34ac4a93597e2681dd61e117b315ae227ca730`,
45.405 byte. La [nota di pubblicazione](../../experiments/gpui-patient-pilot/evidence/connected/keyboard-recovery/publication-note.json)
registra il diniego, l'azione e gli otto originali selezionati per il commit.
Il manifesto aggiornato elenca soltanto i file inclusi nella pubblicazione;
il digest del manifesto originale delle nove catture era
`0a09ef6a8bf070f3db2a86d024b9afc437eb9254e49d46ed0a00ed3bf144cdfd`.
Le ricevute originali dei controlli, dei seed, degli snapshot e della
scansione privacy restano invariate e riferite alla loro esecuzione.

Il banco usa soltanto il
[corpus pubblico sintetico](../../experiments/gpui-patient-pilot/comparison/corpus.json),
preparato con il
[preparatore esistente](../../experiments/gpui-patient-pilot/comparison/prepare-runtime.mjs).
Le due nuove ricevute di seed confermano il digest canonico:

`856df9e282cc803e63d81c45064b2d564fc685381affbba08f4c2d4f65e73b36`

Entrambi gli archivi sono nuovi, in directory private dedicate sotto
`/tmp/mediflow-transition-keyboard-recovery-*`, con
`MEDIFLOW_E2E_DISABLE_LEGACY_COPY=1`, provider disabilitati e origine
letterale `http://127.0.0.1:43183`. I processi sono stati ritirati e la porta
verificata chiusa fra i due usi. Il campo `authCredential` nelle ricevute
di seed contiene l'etichetta pubblica di protocollo `passphrase-v3`, non
una credenziale. I file privati di configurazione non sono allegati.

| Sequenza osservata | Esito |
| --- | --- |
| Ricerca Pazienti e caratteri `ajk/` | Il testo resta nel campo. |
| Filtro `a`, `j`, freccia giù, freccia su, `k` e Invio | Navigazione tra le sole righe visibili e apertura di Elena dalla riga evidenziata. |
| Focus su Carlo, anteprima caricata di Amina, Ctrl+N | Nessuna bozza aperta; PNG prima e dopo identiche. |
| `/` nella scheda, Agenda, Diario, Repertori | Scheda invariata; negli altri casi focus nella ricerca dell'area attiva. Il testo precedente viene selezionato. |
| Menu moduli focalizzato a 390×844, poi 1440×960 e un solo Ctrl+N | Bozza aperta senza click o tasti di navigazione intermedi. |
| Bozza non vuota, Ctrl+N nel corpo | Form e contenuto invariati; PNG identiche. |
| Bozza 1440→390, suffisso incollato senza rifocalizzare, ritorno 1440 | Menu chiuso; accenti, testo, caret e suffisso conservati. |
| Ctrl+Invio due volte | Stessa revisione visibile, PNG identiche. |
| Esc, poi Ctrl+L dal titolo focalizzato | Sessione bloccata; nome utente sintetico svuotato nel controllo nativo prima della cattura. |

Le immagini della bozza conservano lo scorrimento associato al focus del
campo. A 390 pixel l'inizio del titolo del form è parzialmente sopra il
viewport: **non sono catture a scorrimento zero**. Il testo del corpo e il
caret sono visibili. Il repertorio sintetico è vuoto, quindi la prova
qualifica focus e permanenza nell'area, non la correttezza dei risultati
di una ricerca catalografica.

### Tentativo interrotto e ripetizione valida

Il primo tentativo della sequenza di bozza è
[registrato separatamente](../../experiments/gpui-patient-pilot/evidence/connected/keyboard-recovery/interrupted-attempt.json).
È stato reinserito testo prima di verificare che la sequenza di input e il
frame si fossero stabilizzati. Il focus aveva già raggiunto altri controlli:
Tab, Invio e Spazio hanno attivato i normali comandi del form. Una voce
**sintetica** è stata creata con HTTP 201 e riletta con HTTP 200. Quel
tentativo non è accettato come prova di assenza di scritture o come prova
completa del ridimensionamento. Le osservazioni di worklist e ricerca,
precedenti all'evento, restano identificate nel proprio banco.

La sequenza finale è stata ripetuta su un nuovo seed, con un'azione per
frame osservato e inserimento del testo tramite clipboard soltanto dopo
aver verificato il focus dell'editor. Non è stato necessario modificare
il binario. Il
[confronto finale](../../experiments/gpui-patient-pilot/evidence/connected/keyboard-recovery/snapshot-comparison.json)
conferma snapshot identici prima e dopo, **zero richieste cliniche di
scrittura paired**, quattro pazienti attivi, uno archiviato, due voci e
scheda versione 1. Il digest dello snapshot è in entrambi i casi:

`f29750364416db67b7eaee5180712fb482c245a3194943dde45bef21c00e1e43`

Il [cleanup](../../experiments/gpui-patient-pilot/evidence/connected/keyboard-recovery/cleanup.json)
conferma chiusura di app, host e Xvfb alle 20:44:27 UTC, porta 43183 chiusa
e socket del display privato assente. La scansione dei file destinati
all'integrazione confronta i byte con i valori privati generati per
entrambi i runtime, senza riportare tali valori nel verbale.

## Ripetibilità e limiti

I comandi esatti dei quattro controlli Rust sono nella ricevuta `checks.json`.
La sequenza nativa usa un nuovo archivio secondo il protocollo di
`comparison/prepare-runtime.mjs`, uno snapshot iniziale tramite
`comparison/js-client.mjs`, il client collegato al solo host loopback e
uno snapshot finale dopo il blocco. Il manifest separa ogni cattura e
ogni tentativo per binario, archivio e stato del focus.

Questa è una prova nativa Linux/X11 di tastiera e ridimensionamento. Non
qualifica esecuzioni macOS, Windows, iPhone/iPad o tecnologie assistive.
L'esclusione IME è verificata dal motore di keymap e dai test dell'editor;
non è stata ripetuta una sessione IME reale del sistema operativo. Non
dimostra il completamento della migrazione dell'intero prodotto: resta
complementare al
[verbale del client collegato e confronto old/new](./2026-10-17-rust-gpui-connected-client.md).

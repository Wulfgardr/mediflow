---
summary: "Punto d'inchiostro per piattaforma: che cosa resta identico, che cosa segue web, macOS, Windows, Linux, iPhone, iPad e iPhone Duo, e la mappa di ogni schermata."
read_when:
  - "Portando una schermata MediFlow su una piattaforma specifica."
  - "Decidendo se una differenza fra piattaforme è voluta o è una deriva."
---

# Piattaforme e schermate

## Che cosa non cambia mai

Su ogni piattaforma, senza eccezioni:

- il punto e i tre inchiostri, con le stesse parole;
- Newsreader per nomi dei pazienti, prosa clinica e titoli; IBM Plex Mono per
  dosi, codici, date;
- i colori dei token, Giorno e Grafite;
- l'ordine delle informazioni: identità e allergia, quadro, diario, soglia;
- i testi dei comandi e della soglia;
- i cinque stati della scrittura e i loro esiti;
- il movimento: nessuno nei gesti ripetuti, il punto che si posa,
  l'inchiostro che asciuga.

## Che cosa segue la piattaforma

Il carattere dei controlli, finestre e barre, menu, raggi, materiali,
posizione del comando principale, gesti, scorciatoie con il modificatore
locale. Una differenza oltre queste va scritta con la sua ragione, come chiede
`DESIGN.md`.

| | Web localhost | macOS | Windows | Linux | iPad | iPhone | iPhone Duo |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Carattere dei controlli | `system-ui` | San Francisco | Segoe UI Variable | Carattere del desktop | San Francisco | San Francisco | San Francisco |
| Corpo del registro | 13,5 px | 13 pt | 14 px | 14 px | 15 pt in tabella, 17 pt nel testo | 15 e 17 pt | 15 e 17 pt |
| Riga | 36 px | 36 pt | 36 px, 44 al tocco | 36 px | 44 pt | 44 pt | 44 pt |
| Raggio controlli e piano | 10 e 16 | 8 e 12 | 4 e 8 | 6 e 10 | 12 e 18 | 12 e 18 | 12 e 18 |
| Navigazione | Colonna a sinistra | Barra laterale | Navigazione a sinistra con tacca di selezione | Barra laterale | Barra laterale | Schede in basso | Chiuso: schede. Aperto: schede, due pagine |
| Cornice | Nessuna | Barra unificata, semafori | Barra del titolo, comandi a destra | Barra d'intestazione, titolo al centro | Nessuna | Barra di stato | Barra di stato |
| Comando principale | In alto a destra del piano | Barra degli strumenti | In alto a destra del piano | Barra d'intestazione o in alto a destra | In alto a destra | Nella soglia, sopra le schede | Sulla pagina destra |
| Anteprima dell'elenco | Colonna a destra | Ispettore | Colonna a destra | Colonna a destra | Colonna a destra | Assente: la riga apre la scheda | Pagina destra |
| Trasparenza | Nessuna | Solo barra laterale e barra degli strumenti | Solo titolo e navigazione | Nessuna | Solo barre | Solo barre | Solo barre |

Il banco mostra ognuna di queste colonne: menu "Piattaforma".

### Web localhost

- HTML semantico; il piano è `main`, la navigazione `nav`, la soglia una
  regione di stato.
- Le classi di larghezza si misurano sul contenitore dell'applicazione
  (container query), così valgono anche dentro una finestra incorporata.
- Caratteri locali: Newsreader va aggiunto in `app/fonts` accanto a
  IBM Plex Mono. Inter esce dall'interfaccia.
- Token: quando WUL-765 li porta nel runtime, entrano in
  `docs/design/lume/tokens/lume.tokens.json` e nello specchio
  `app/lume-tokens.css`, con il controllo di deriva esistente.
- Niente controlli nativi del browser lasciati senza stile accanto a controlli
  disegnati: menu a tendina e campo data seguono la regola dei campi.

### macOS

- Finestra con barra unificata; barra laterale per le aree; ispettore per
  l'anteprima; menu completi con le scorciatoie della specifica.
- Il piano resta opaco. I materiali di sistema stanno su barra laterale e
  barra degli strumenti e seguono "Riduci trasparenza".
- Il target resta macOS 14: i materiali più recenti si usano solo dove il
  sistema li offre, senza cambiare disposizione.
- Newsreader e IBM Plex Mono inclusi nell'app; i corpi seguono la dimensione
  del testo del sistema.
- L'ascolto della visita esiste solo qui, da macOS 26
  ([03-ascolto-della-visita.md](./03-ascolto-della-visita.md)).

### Windows e Linux

La shell non è ancora scelta
([WUL-714](https://linear.app/wulfgardr/issue/WUL-714)): le regole qui sotto
valgono qualunque essa sia.

- Windows: barra del titolo con i comandi di finestra a destra; navigazione a
  sinistra con la tacca di selezione della piattaforma; raggi 4 e 8; Segoe UI
  Variable; con un tema a contrasto elevato i token cedono ai colori di
  sistema e restano forma e parola.
- Linux: prima riga dichiarata GNOME, con barra d'intestazione e titolo al
  centro; raggi 6 e 10; carattere del desktop. Altri ambienti quando la 0.9.6
  li dichiara.
- Su entrambe: modificatore Ctrl, bersagli da 44 px quando l'ingresso è il
  tocco.

### iPad

- Larghezza regolare: barra laterale e piano, con le due colonne della scheda
  affiancate in orizzontale e ravvicinate in verticale.
- Larghezza compatta (finestra stretta o affiancata): come iPhone.
- Tastiera e puntatore: stesse scorciatoie del Mac, riga evidenziata al
  passaggio.
- Con il testo alle dimensioni di accessibilità le colonne diventano una.

### iPhone

- Una colonna. Quattro schede: Pazienti, Agenda, Diario, Altro.
- Scheda: testata, sezioni a segmenti che scorrono, quadro, diario.
- Scrittura: il diario sale sopra il quadro, la voce viva è la prima cosa
  sotto la testata; la soglia sta sopra la barra delle schede e non scorre.
- Il comando di ascolto è nella riga di stato della voce, non nella soglia.

### iPhone Duo

Misure usate nel banco, in punti: schermo esterno 466 × 678, schermo interno
aperto 890 × 626. Sono ricavate dividendo per 3 i pixel riportati dalla stampa
al lancio (esterno 1398 × 2034, interno 2670 × 1878); la densità effettiva e
le API di postura vanno lette nella documentazione Apple prima di
implementare. Non le ho verificate su un dispositivo.

- **Chiuso:** come iPhone. Lo schermo è più largo e più basso: nell'elenco
  entrano meno righe, la disposizione non cambia.
- **Aperto:** due pagine ai lati della piega. Nessun testo, comando o riga
  attraversa il centro.
  - Pazienti: elenco a sinistra, anteprima a destra.
  - Scheda: quadro a sinistra, diario a destra.
  - Scrittura: quadro a sinistra, voce viva a destra; nella soglia il
    messaggio sta sulla pagina sinistra e i comandi sulla destra.
  - Testate e barre di strumenti si dividono in due metà, con una distanza al
    centro di 40 pt.
  - Le schede in basso restano quattro, due per pagina.
- **Passaggio da chiuso ad aperto:** la vista e la bozza restano le stesse.
  Aprire o chiudere il dispositivo non perde testo, selezione o stato della
  soglia.
- **Semiaperto, appoggiato:** non progettato. Vale la disposizione aperta
  finché non c'è una ragione d'uso.

### Mini e Headless

Stessi tre stati con gli stessi nomi: `○ matita`, `● fresco`, `● asciutto`.
Stessa domanda di conferma con nome, età e conteggio. Dopo la scrittura una
riga dice che cosa è rimasto fuori. Vedi la schermata "Mini" del banco.

### Sito

Titolo in serif chiuso dal punto, una scheda vera del prodotto in grande con
dati sintetici, i tre inchiostri in tre colonne. Lo realizza il modello che
Leonardo sceglierà; il sito non ha sorgente in questa repository
([WUL-769](https://linear.app/wulfgardr/issue/WUL-769)). Il riferimento visivo
è la schermata "Home del sito" dei prototipi di confronto.

## Mappa delle schermate

Le 17 schermate del banco, con l'origine nel prodotto di oggi e la
disposizione per classe di larghezza.

| Schermata del banco | Web oggi | Apple oggi | Estesa | Compatta |
| --- | --- | --- | --- | --- |
| Sblocco | `components/lock-screen.tsx` | accesso nativo | Scheda centrata, nome con il punto | uguale |
| Primo avvio | `components/work-profile-onboarding.tsx`, `onboarding-wizard.tsx` | n.d. | Scheda centrata, una domanda per volta | uguale |
| Pazienti | `app/page.tsx` (area incarico) | `PairedPatientsWorklistView` | Tabella e anteprima | Due colonne, la riga apre la scheda |
| Scheda paziente | `app/patients/[id]/modules`, `patient-synoptic-sheet.tsx` | `PairedPatientsWorkspaceView`, `MacPatientContextInspector` | Quadro e diario affiancati | Testata, segmenti, una colonna |
| Scrittura con conferma | `app/patients/[id]/entries/new` | `PairedDiaryComposerView` | Voce viva nel diario, soglia in fondo | Voce viva in cima, soglia sopra le schede |
| Ascolto della visita | assente | `VisitRecordingLumeShell` | Pannello dentro la voce viva | uguale |
| Terapie | `therapy-manager.tsx`, `treatment-reasoning-panel.tsx` | `PairedPatientTherapiesSection` | Tabella con comandi di riga, concluse, proposte | Nome e posologia, comandi nel dettaglio |
| Misure | `observation-manager.tsx` | `PairedPatientClinicalSections` | Tabella e andamento della misura scelta | Tabella, poi andamento |
| Documenti e proposte | `document-viewer.tsx`, `patient-smart-import-panel.tsx`, `document-insights-panel.tsx` | `PairedPatientDocumentsSection`, `PairedAttachmentDetailView` | Elenco e proposte a sinistra, originale a destra | Elenco, poi originale |
| Agenda | `app/page.tsx` (area turno) | n.d. | Gruppi per urgenza: scaduti, da prenotare, prossimi | uguale, una colonna |
| Diario | `app/diary` | `PairedPatientDiarySection` | Voci di tutti i pazienti, ricerca e filtri | uguale |
| Repertori | `app/page.tsx` (area repertori), `icd-autocomplete.tsx`, `drug-autocomplete.tsx` | `RepertoriWorkspaceView` | Segmenti per catalogo, risultati, fonte e data | uguale |
| Analisi | `app/analytics` | n.d. | Numeri chiave, tabella, un grafico per domanda | una colonna |
| Scale | `app/scales`, `app/patients/[id]/scales/[scaleId]` | `ClinicalScaleFormView`, `PairedScalesSection` | Voci a sinistra, risultato in bozza a destra, soglia | una colonna, soglia in fondo |
| Impostazioni | `app/settings/*` | `SettingsWorkspaceView`, `NativeAIConfigurationView` | Sezioni a sinistra, righe con interruttore ed effetto pratico | Sezioni in una riga che scorre |
| Stati | sparsi | sparsi | Testo, causa, azione | uguale |
| Mini | CLI | CLI | Testo a larghezza fissa | uguale |

### Superfici non disegnate una per una

Seguono la schermata indicata, con gli stessi componenti.

| Superficie | Segue | Nota |
| --- | --- | --- |
| Nuova scheda, modifica anagrafica (`app/patients/new`, `edit`) | Scale | Modulo a sinistra, riepilogo in bozza a destra, soglia |
| Importazione di pazienti (`app/patients/import`) | Documenti e proposte | Ogni riga importata è una proposta a matita finché non è accettata |
| Prescrizioni di prestazioni e protesica | Terapie | Stessa tabella, stessi comandi di riga |
| Ragionamento terapeutico, riepilogo assistito | Terapie, sezione Proposte | Risultato sempre a matita, con fonti |
| Revisione di una proposta di un agente (`headless-soap-approval-dialog.tsx`) | Scrittura con conferma | La proposta è la voce a matita; accettarla la rende bozza |
| Spazio di lavoro SISS | Documenti e proposte | Fuori dal perimetro di questa direzione finché il filone SISS non lo richiede |
| Sezioni delle impostazioni (Profilo, Accesso, Ambulatori, Aspetto, Backup, Repertori, Funzioni AI, Modelli, Governo dei dati, Diagnostica, Zona pericolo) | Impostazioni | Zona pericolo usa la soglia in due tempi |
| Backup e ripristino | Impostazioni, con soglia | Il ripristino è una scrittura: conferma con ciò che verrà sostituito |
| Modalità riservata (`privacy-mode-toggle.tsx`) | tutte | Nasconde i contenuti, non il motivo né il comando per tornare |

"n.d." significa che non ho trovato una vista corrispondente nell'app Apple di
oggi: all'ingresso della issue l'owner verifica sul codice corrente.

## Prove per piattaforma

Per dichiarare una schermata pronta su una piattaforma:

1. confronto affiancato con il banco, in Giorno e Grafite;
2. percorso completo da tastiera dove c'è una tastiera;
3. bersagli da 44 px dove c'è il tocco;
4. riduzione del movimento, riduzione della trasparenza, aumento del
   contrasto, testo ingrandito;
5. per le scritture: una riuscita con rilettura e un caso che fallisce, su
   dati sintetici.

---
summary: "Regole compositive di Punto d'inchiostro: comandi, sezioni, navigazione, proposte e stati del Web."
read_when:
  - "Applicando le decisioni compositive D1–D16 alla vista paziente o alle altre viste Web."
  - "Verificando form aperti, stati vuoti, proposte e menu aggiuntivi."
---

# Addendum compositivo

Decisioni del 22 ottobre 2026, per WUL-787. Questo addendum completa la
[specifica](./01-specifica.md) nei rapporti fra elementi della stessa vista.
Colori, caratteri, misure, inchiostri, soglia e livelli di conferma restano
quelli della specifica. Le regole descrivono la composizione da ottenere;
non attestano che il Web la realizzi già.

I riferimenti `file:riga` indicano i punti da allineare nella base
`e076ea44af9db4352211496c7d2db9e054068529`. I sorgenti citati non sono cambiati
rispetto alla ricognizione su `7939f9f34a1d8dca57f202b604afed5102ecb768`.
I nomi delle catture rimandano all'indice della ricognizione Web del
22 ottobre, conservato fuori dalla repository in `mf-shots-web-audit/index.html`.
Sono immagini del prima, con dati inventati. Non sono esempi già conformi.

Due precisazioni modificano la formulazione generale della specifica:
D1 rende temporaneo il ruolo principale di «Nuova voce» quando si apre un
form; D5 introduce la variante testuale del secondario per creare nella
sezione. D11 mantiene un perimetro più ristretto del banco Repertori.
Queste differenze sono esplicite; non cambiano le decisioni approvate.

## D1. Il principale segue il form aperto

A form aperto, il comando di invio del form è l'unico principale della vista.
«Nuova voce» diventa secondario e torna principale quando il form si chiude.
La gerarchia riguarda tutto il piano: separare due comandi in sezioni diverse
non permette due principali. Si conservano bozza, destinatario, soglia e
passaggi di conferma già previsti.

In Terapie, aprire «Nuova terapia» dà il ruolo principale all'invio del form
in `components/therapy-manager.tsx:665`; il comando della testata in
`components/kree8/kree8-workspace-shell.tsx:346` scende a secondario.
La cattura `054-dialogo-nuova-terapia-giorno-1440.png` mostra la concorrenza
da eliminare.

Vietato lasciare «Nuova voce» pieno insieme all'invio, perdere la bozza nel
cambio di enfasi o usare questa regola per saltare la conferma. Nella
conferma distruttiva resta evidenziato per primo il ritorno indietro, come
prescrive la specifica.

## D2. La testata ha due ingressi

La testata paziente mostra «Nuova voce» e «Azioni». Il primo è principale,
salvo D1; il secondo apre il menu. «Accesso assistente», «Gestisci checkup»,
esportazioni e archiviazione stanno nel menu, con ordine fisso. Altrove,
accanto al principale, è visibile al massimo un secondario. Il menu conserva
nomi, autorizzazioni e conferme delle operazioni.

Nella vista paziente, i comandi passati dalla pagina alla shell
(`app/patients/[id]/modules/page.tsx:664`,
`components/kree8/kree8-workspace-shell.tsx:347`) non formano più una fila
di quattro accessi. La cattura `011-paziente-pieno-riepilogo-giorno-1440.png`
mostra il caso di partenza.

Vietato promuovere azioni dal menu secondo larghezza o frequenza d'uso,
aggiungere un'altra fila di secondari o rendere disponibile un'operazione
prima non autorizzata. L'ordine non cambia passando da paziente vuoto a pieno.

## D3. Due soli modi di aprire

Una disclosure apre contenuti nel flusso: un componente comune, un chevron,
nessuna cornice, stato espresso con `aria-expanded`. Un menu apre azioni o
destinazioni: un altro componente comune. La distinzione dipende da ciò che
si apre, non dalla vista che lo contiene. Il controllo ha un nome accessibile;
il contenuto aperto conserva un ordine di lettura e di fuoco riconoscibile.

In Terapie, «Guida alla prescrizione» usa la disclosure e compare solo lì.
La chiamata oggi precede il Quadro in
`app/patients/[id]/modules/page.tsx:740`; il controllo di sezione da
uniformare è in `components/kree8/collapsible-section.tsx:81`.
La cattura `054-dialogo-nuova-terapia-giorno-1440.png` mostra la guida
incorniciata; `095-paziente-pieno-altre-sezioni-menu-giorno-768.png` mostra
invece un menu di navigazione.

Vietati triangoli nativi di `details` con dimensioni diverse, disclosure
incorniciate e un terzo idioma locale. Chiudere dettagli non deve smontare
involontariamente un form o scartare ciò che si sta scrivendo.

## D4. Il campo dipende dalla scelta

Per una scelta finita si usa un select nativo dentro una shell comune.
La combobox serve soltanto ai cataloghi con ricerca. Per i filtri, i segmenti
sono ammessi fino a quattro opzioni. Etichetta, fuoco, altezza e stato del
campo seguono la specifica; il menu nativo conserva il comportamento del
sistema operativo. La navigazione della cartella segue D8.

Il modello per una proposta in
`components/function-models/function-model-picker.tsx:37` è una scelta finita:
quando si apre «Cambia» usa il select comune. La ricerca del farmaco nel
form Terapie resta una ricerca di catalogo. La cattura
`104-paziente-pieno-proposte-modello-chiuso-giorno-1440.png` documenta il campo
chiuso; il popup nativo non è incluso nel corpus fotografico.

Vietato sostituire ogni select con una combobox, usare segmenti per un elenco
lungo o confondere la scelta del modello con la disponibilità del servizio.
L'uniformità del campo non autorizza nuove opzioni o un diverso instradamento.

## D5. La creazione appartiene al titolo di sezione

Il comando di creazione è secondario testuale, stabile accanto al titolo
della sezione. Resta in quel posto anche quando la sezione è vuota, se
l'utente può creare. Non ha fondo pieno. Il testo del vuoto nomina ciò che
manca e non ripete il comando in un secondo punto. Dopo l'apertura del form
il ruolo dell'invio segue D1.

In Terapie, «Nuova terapia» in `components/therapy-manager.tsx:408` va
accanto al titolo della sezione in
`app/patients/[id]/modules/page.tsx:794`. Nella cattura
`042-paziente-vuoto-terapie-grafite-768.png` è invece un pulsante pieno
isolato sopra il vuoto. Misure adotta lo stesso rapporto fra titolo e creazione.

Vietato un secondo pulsante blu, spostare la creazione dentro la riga vuota
solo quando il conteggio è zero o unificare flussi clinici diversi sotto
«Nuova voce». Testuale non significa bersaglio più piccolo.

## D6. Le proposte stanno sotto la propria sezione

Sotto il contenuto della sezione c'è una disclosure «Proposte», inizialmente
chiusa. Ogni proposta AI conserva matita, tratteggio, parola «Proposta» e
fonte. Il Riepilogo mostra una sola riga «N proposte da rivedere», con
collegamenti alle sezioni interessate: non ripete i pannelli locali.
Il conteggio viene dalle proposte effettive, non dal numero di funzioni attive.

In Terapie il pannello di
`components/treatment-reasoning-panel.tsx:227` segue il registro, dentro
«Proposte». Nel Riepilogo, la composizione di Patient Insight e Smart Import
in `app/patients/[id]/modules/page.tsx:742` va ricondotta ai collegamenti,
eliminando la doppia presenza visibile nella cattura
`011-paziente-pieno-riepilogo-giorno-1440.png`.

Vietato trattare una proposta come cartella registrata, duplicarla per
renderla più visibile o generarla aprendo la disclosure. Un testo conservato
di origine ignota segue «Provenienza di un documento» della specifica: non
diventa matita per il solo fatto di stare in questa area. La proposta già
portata nella voce conserva il rapporto con bozza e soglia previsto dalla
specifica; non viene nascosta per applicare la disclosure delle sezioni.

## D7. Il modello occupa una riga

Nel lavoro clinico la scelta si riassume in una riga:
«Modello: predefinito · Cambia», oppure il nome della scelta effettiva.
«Cambia» apre il campo comune; i dettagli si leggono a richiesta.
Consenso, provenienza e condizioni necessarie alla decisione restano visibili
quando servono. Una riga riassuntiva non attesta che il modello sia pronto.

Il selettore e i dettagli di
`components/function-models/function-model-picker.tsx:35` diventano questa
composizione nel pannello terapeutico. La cattura
`104-paziente-pieno-proposte-modello-chiuso-giorno-1440.png` è il riferimento
per la superficie occupata oggi. A funzione spenta prevale D14.

Vietato nascondere il consenso nei dettagli, omettere la fonte della proposta,
presentare un predefinito non disponibile come pronto o cambiare la durata
della scelta, le opzioni e i controlli già governati dall'host.

## D8. Le destinazioni non si muovono con i conteggi

I segmenti della cartella sono sempre, in quest'ordine, Riepilogo, Terapie,
Misure, Documenti. «Altro» raccoglie le altre destinazioni in ordine fisso e
rende riconoscibile quella corrente. Con zero, uno o molti record restano
gli stessi ingressi. I conteggi descrivono il contenuto; non scelgono quali
destinazioni mostrare. Restano accessibili tutte le quindici destinazioni.

La selezione dipendente dai conteggi in
`components/runtime-twin-workspace.tsx:165` va sostituita rispettando gli
href di `app/patients/[id]/modules/page.tsx:524`: Riepilogo usa `#quadro`,
Misure usa `#parametri`. Le altre voci mantengono l'ordine relativo della
lista, senza promozioni. La cattura
`095-paziente-pieno-altre-sezioni-menu-giorno-768.png` mostra anche il menu
tagliato a sinistra, da correggere nell'unità di navigazione.

Vietato nascondere una sezione vuota, cambiare l'ordine secondo i dati o
perdere bozza, selezione e fuoco nel passaggio. Il menu resta entro il
viewport; selezionare una voce lo chiude, Esc restituisce il fuoco al suo
controllo. «Altro» della cartella non sostituisce la navigazione generale.

## D9. Il Quadro contiene le quattro tabelle

Si applica il Quadro della specifica, senza variante selettiva:

| Tabella | Colonne |
| --- | --- |
| Problemi | Codice, descrizione, da quando |
| Terapie attive | Nome e dose, posologia, ATC |
| Misure recenti | Nome, valore e unità a destra, data, variazione |
| Controlli aperti | Nome, scadenza |

Ogni tabella ha filetti, intestazione di sezione e conteggio secondario a
destra. In larghezza media si nascondono da quando, ATC e variazione; non
si rimpiccioliscono. In estesa Quadro e Diario restano leggibili insieme.

Il ramo ordinario di `components/patient-synoptic-sheet.tsx:110`, visibile
in `011-paziente-pieno-riepilogo-giorno-1440.png`, mostra una sintesi
selettiva da riportare alle quattro tabelle. Se non ci sono controlli letti,
la relativa sezione dice «Nessun controllo aperto»; un errore segue D12.

Vietato ridurre il Quadro a una diagnosi, una misura e un controllo,
sostituire le tabelle con card o inventare un valore assente. Una lettura
fallita non diventa una tabella vuota.

## D10. Una sezione ha un titolo

Il titolo di sezione è unico, in maiuscoletto a 12 px secondo la scala della
specifica. Il contatore esplicita che cosa conta: «1 attiva», non soltanto
«1». I sottogruppi sono sobri e compaiono solo quando hanno righe. Il titolo
della destinazione e quello del registro non si ripetono nello stesso piano.

In Terapie, il titolo e il conteggio di
`app/patients/[id]/modules/page.tsx:794` identificano la sezione; il registro
in `components/therapy-manager.tsx:681` non aggiunge una seconda testata
equivalente. Le righe possono restare in gruppi attive, sospese e concluse;
«1 attiva» non va presentato come totale di tutti i gruppi. Il caso con form
è visibile in `054-dialogo-nuova-terapia-giorno-1440.png`.

Vietato eliminare il maiuscoletto prescritto, lasciare sottogruppi vuoti,
mostrare un numero senza significato o moltiplicare icone e titoli per
costruire una gerarchia già espressa dalla sezione.

## D11. Repertori resta la panoramica esistente

In WUL-787 si uniformano comandi, righe, dettagli e stati della panoramica
Repertori già disponibile. Il banco mostra una ricerca a segmenti con
risultati: questa divergenza resta dichiarata. Non è un requisito funzionale
da realizzare con il riordino visivo.

La panoramica in `components/kree8/areas/repertori-area.tsx:202` conserva
«Gestisci repertori», conteggi locali e operazioni esistenti. Il confronto
è con `docs/design/punto-inchiostro/banco/index.html:345`; la cattura di
partenza è `073-repertori-giorno-1440.png`.

Vietato aggiungere una ricerca di cataloghi, simulare risultati o ampliare
i servizi per imitare il banco. Un conteggio non letto conserva il suo stato,
senza diventare zero.

## D12. Lo stato appartiene a chi legge i dati

`ViewState` è un componente di sola presentazione per caricamento, vuoto,
errore e non disponibile. Riceve lo stato da chi possiede la lettura; non
lo deduce dall'assenza di righe. Usa la stessa colonna, nessuna cornice,
testo che nomina il contenuto e al massimo un comando secondario reale.
Non cancella le distinzioni della specifica fra negato, illeggibile,
non attuale e gli altri stati attestati dalla fonte.

Follow-up, in `app/patients/[id]/modules/page.tsx:949`, oggi mette insieme
assenza della risposta e lista vuota: è la prima adozione prevista.
La cattura `011-paziente-pieno-riepilogo-giorno-1440.png` mostra inoltre
«Lettura delle note in corso…»; il ramo è in
`components/patient-profile-notes.tsx:21`. Il fotogramma attesta il messaggio,
non la durata né la causa. Nell'unità sugli stati va verificato se la lettura
termina e se il risultato viene mostrato; non basta sostituire il testo.

Vietato simulare offline, copia locale, interruzione o retry. Un'azione compare
solo se il proprietario la offre davvero. Se manca un contratto di lettura
adeguato, il suo cambiamento è un'unità distinta; il componente visivo non
introduce accessi ai dati né nasconde errori come vuoti.

## D13. Le azioni di riga restano quiete

Una riga mostra una sola azione testuale quieta, la più frequente, e un menu
«⋯» con le altre. L'azione distruttiva è l'ultima nel menu. Ogni icona usata
come comando ha un nome accessibile; nel menu e nella conferma l'azione è
scritta per esteso. Il tono distruttivo pieno compare soltanto nella conferma.

Nella terapia attiva di `components/therapy-manager.tsx:695`, «Modifica»
resta visibile; «Sospendi», «Concludi» ed «Elimina» passano nel menu,
con «Elimina» per ultima. La cattura
`054-dialogo-nuova-terapia-giorno-1440.png` mostra la fila da ridurre.

Vietato un rosso pieno permanente nella tabella, un'icona senza nome,
un menu che riordina le azioni fra righe equivalenti o un livello di conferma
ridotto. La conferma distruttiva mantiene la priorità del ritorno indietro.

## D14. Spento e temporaneamente bloccato sono diversi

Se la funzione è spenta, si mostra solo il prerequisito con il collegamento
pertinente: «Ragionamento terapeutico spento · Apri le funzioni cliniche».
Non compaiono il comando disabilitato né il selettore del modello.
Se manca un prerequisito transitorio, come consenso o conferma del paziente,
il comando resta disabilitato con una spiegazione adiacente sempre visibile.
Non assume l'aspetto di un principale pieno in concorrenza.

Il ramo spento di `components/treatment-reasoning-panel.tsx:240` e il comando
in `components/treatment-reasoning-panel.tsx:281` vanno composti in modo
distinto. La cattura `042-paziente-vuoto-terapie-grafite-768.png` mostra
oggi prerequisito, select e «Prepara proposta» disabilitato insieme.

Vietato affidare la causa al solo hover, usare «spento» per qualsiasi errore
del servizio, chiedere di riattivare una funzione già attiva o dedurre un
consenso dal gesto che apre i dettagli.

## D15. Il titolo pagina appartiene alla shell

La shell possiede il titolo della pagina. Il contenuto comincia dalle
sezioni, con i ruoli tipografici già definiti. Il titolo della destinazione
rimane riconoscibile anche nelle sottoviste; non viene ripetuto nel contenuto.

In Impostazioni, OpenAI · ChatGPT, l'`h1` locale di
`app/settings/ai/chatgpt/page.tsx:13` va ricondotto alla shell. Le intestazioni
del contenuto, come quelle di `components/settings/settings-ui.tsx:32`,
restano sezioni. Il caso è documentato da
`084-impostazioni-ai-chatgpt-giorno-1440.png`.

Vietato risolvere la duplicazione con un altro corpo libero, lasciare due
titoli pagina o eliminare il nome della sottovista. Le informazioni su account,
consenso e disponibilità mantengono il proprio significato.

## D16. Il Diario è la vista principale

Il Diario è la lettura principale della storia del paziente. Gli eventi
tecnici e di sistema si raggiungono con un filtro. Restano conservati e
consultabili storico, autore, fonte e provenienza; il filtro cambia ciò che
si vede, non ciò che esiste. La ricetta del Diario mantiene margine, prosa,
stato e filetto.

La voce in `components/timeline-entry-card.tsx:152` è il riferimento da
allineare; la Timeline in `components/clinical-river-timeline.tsx:139` va
ricomposta secondo questa priorità. La sua lista contiene anche voci,
controlli e documenti: non è tutta un registro tecnico. Le catture
`016-paziente-pieno-diario-giorno-1440.png` e
`025-paziente-pieno-timeline-giorno-1440.png` documentano le due viste iniziali.

Vietato cancellare eventi, perdere gli accessi esistenti durante la
migrazione o classificare come tecnico ogni elemento della Timeline.
Filtrare non promuove una sintesi o una proposta a fatto clinico registrato.

## Stati compositivi

Questa tabella completa gli stati di lettura della specifica. I casi possono
coesistere: una proposta aperta o un menu non danno un secondo principale
alla vista che contiene un form.

| Stato | Composizione | Comandi e uscita | Da conservare |
| --- | --- | --- | --- |
| Form aperto | Titolo di sezione stabile, form nel proprio contesto, bozza riconoscibile | Invio unico principale; «Nuova voce» secondario fino alla chiusura. L'annullamento segue le protezioni della bozza | Destinatario, contenuto, soglia, conferme e recupero esistenti |
| Vuoto | Solo dopo lettura riuscita. Una riga nomina ciò che manca, per esempio «Nessuna terapia in corso» | Creazione secondaria testuale accanto al titolo, se consentita; nessun duplicato nel messaggio | Segmenti stabili, conteggio esplicito, distinzione da caricamento ed errore |
| Proposta | Sotto la propria sezione, in «Proposte» inizialmente chiusa; risultato a matita con tratteggio, parola e fonte | Apertura senza generazione né scrittura; comandi di revisione esistenti, senza principali concorrenti. Nel Riepilogo una sola riga di rimando | Consenso quando necessario, provenienza e gesto esplicito di accettazione; nessuna applicazione implicita |
| Overflow | «Azioni», «Altro» o «⋯» secondo il contesto; menu comune, ordine fisso, entro il viewport | Nome accessibile; scelta chiude il menu; Esc chiude e riporta il fuoco al controllo. Distruttiva per ultima | Autorizzazioni, accesso a tutte le destinazioni e livelli di conferma |

## Sequenza delle unità

Una unità per PR. Le righe che nominano più sottoviste si dividono nelle
unità indicate, senza una PR cumulativa. L'ordine applica le decisioni sopra;
non lascia aperte le alternative del censimento iniziale.

| Ordine | Unità | Accettazione |
| --- | --- | --- |
| 1 | Addendum compositivo | D1–D16, esempi e stati espliciti; collegamento dalla specifica. Solo documentazione |
| 2 | Ruoli dei comandi | Principale, secondario, testuale, distruttivo e icona; stessa geometria per ruolo, stati disabled/fuoco/tocco, nessun alias senza stile |
| 3 | Testata paziente | Dati previsti dalla specifica e allergia, se presente, leggibili; «Nuova voce» e «Azioni», con D1 a form aperto |
| 4 | Navigazione paziente | Quattro segmenti stabili con zero, uno e molti record; tutte le quindici destinazioni accessibili; menu senza tagli, bozza e fuoco conservati |
| 5 | Disclosure comune | Un gesto e una forma, stato espanso annunciato, distinzione dal menu; nessun form smontato involontariamente |
| 6 | Campo di scelta comune | Primo caso: modello della funzione. Nome lungo, errore, disabilitazione e consenso; nessun taglio o cambiamento della scelta |
| 7 | Terapie | Zero, una e molte terapie, attive/sospese/concluse; creazione, form, conteggi, azioni di riga e conferma secondo D1, D5, D10 e D13 |
| 8 | Proposta terapeutica | Funzione spenta, pronta, in corso, proposta ed errore; D6, D7 e D14, con matita, fonti e consenso |
| 9 | Quadro | Le quattro tabelle di D9; vuoti e stati per sezione, conteggi coerenti e Diario simultaneo in estesa |
| 10 | Stato di lettura comune, prima adozione Follow-up | Caricamento, vuoto, errore e non disponibile distinti; verifica della lettura note della cattura 011. Eventuali cambiamenti del contratto dati in unità separata |
| 11 | Misure | Creazione come Terapie, tabella e dettaglio con zero, una e molte righe; caricamento ed errore separati |
| 12 | Documenti e sintesi | Fonte selezionata, assente o illeggibile; proposta nuova e contenuto storico, senza confondere originale ed elaborato |
| 13 | Patient Insight, poi Smart Import: due unità | Una per percorso; collocazione D6, matita e fonti attestate, nessuna doppia presenza nel Riepilogo |
| 14 | Prestazioni, poi Protesica, poi SISS: tre unità | Vuoto, form, righe, dettagli e azioni con le ricette accettate; esportazione e passaggio regionale distinti |
| 15 | Diario paziente, poi Timeline: due unità | Margine, prosa, stato e autore; Diario principale ed eventi tecnici nel filtro, senza perdita di storico o accessi |
| 16 | Nuova voce | Bozza in rapporto al Quadro secondo la specifica; apertura, abbandono e ripresa, testo, fonti, consenso, salvataggio e soglia conservati |
| 17 | Impostazioni, indice | Un principale, righe e introduzione uniformi; dettagli senza duplicazione della gerarchia |
| 18 | Impostazioni Backup, Modelli, Repertori: una unità per sottovista | Ruoli dei comandi, dettagli e stati esistenti; sicurezza e consenso invariati |
| 19 | Altre Impostazioni: una unità per sottovista | Titoli, righe, stati e controlli comuni; eccezioni diagnostiche deliberate e localizzate |
| 20 | Agenda, Diario globale, Repertori: tre unità | Filtri, errori distinti dai vuoti, azioni quiete; per Repertori vale D11 |
| 21 | Analisi, Scale, residui dell'elenco pazienti: tre unità | Numeri nella frase, stati completi, nomi leggibili e un principale; non replicare gli scarti residui dell'elenco |

Per le unità di prodotto servono catture sintetiche prima e dopo dello stesso
stato, in Giorno e Grafite a 1440 e 768 px. Ogni serie riporta lo SHA realmente
eseguito: il prima appartiene alla base, il dopo alla revisione modificata;
i confronti fra temi e larghezze della stessa serie usano lo stesso SHA.
Quando si toccano adattamento o fuoco si aggiungono 320 e 390 px e zoom al
200% e 400%, come richiesto da `DESIGN.md`. La guardia dei token non prova
composizione, accessibilità o comportamento. Questa unità documentale non
produce nuove catture né dichiara corretti gli stati fotografati.

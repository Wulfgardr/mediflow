# Riferimenti Breccia per le interfacce Apple

Raccolta del 6 settembre 2026, richiesta dall'utente per orientare sviluppo,
riprogettazione e rifinitura delle app iOS, iPadOS e macOS. Gli esempi e le
critiche suggeriscono criteri da confrontare con il compito concreto e con
le convenzioni Apple: non sono test sugli utenti di MediFlow.

## Come usare questa raccolta

Prima di cambiare una schermata, chiarire che cosa vi si debba fare,
quale sia la selezione attiva e quale il prossimo passo. Elencare poi le
funzioni esistenti, distinguendo navigazione, modifica e informazione:
solo così il criterio scelto può essere applicato a una porzione verificabile
e confrontato prima e dopo su dati sintetici. La raccolta integra
[DESIGN.md](../../DESIGN.md) e il
[contratto Apple](./lume/06-macos-apple-contract.md), senza modificare accesso,
cifratura, contratti clinici o disponibilità dei servizi.

## Criteri con fonti

| Criterio | Evidenza nel video | Applicazione alle app |
| --- | --- | --- |
| Dare un nome al compito e al gruppo | [UX, 6:35](https://www.youtube.com/watch?v=bRBIDHxiCO4&t=395s): annullamento presentato insieme ai metodi di pagamento; [8:16](https://www.youtube.com/watch?v=bRBIDHxiCO4&t=496s): azione secondaria riconoscibile. | Un titolo descrive tutte le opzioni sottostanti. Un comando secondario resta distinguibile dal testo e da un comando disabilitato. Separare Annulla da Salva e dalle opzioni del contenuto. |
| Accostare valore, significato e azione | [App telefoniche, 3:59](https://www.youtube.com/watch?v=QtFe4HZhspE&t=239s): offerta, credito e ricarica riuniti; [12:06](https://www.youtube.com/watch?v=QtFe4HZhspE&t=726s): stato e interruttori distinti. | Dato, unità, data e filtro appartengono allo stesso gruppo. Un conteggio non deve sembrare un pulsante. Una modifica deve avere un esito leggibile, non solo un'animazione. |
| Conservare orientamento e riferimento | [App telefoniche, 13:17](https://www.youtube.com/watch?v=QtFe4HZhspE&t=797s): critica alla perdita della navigazione; [YouTube, 17:14](https://www.youtube.com/watch?v=X-xF0LbEpoY&t=1034s): video e commenti affiancati. | Tenere riconoscibili paziente, sezione e ritorno. Su iPad e Mac, lista e dettaglio possono convivere. Su iPhone, dare un percorso esplicito per consultare e tornare alla bozza. |
| Far seguire le azioni alla selezione | [PS5, 6:03](https://www.youtube.com/watch?v=u9JmGzIiYtE&t=363s): selezione, descrizione e comandi dello stesso oggetto; [9:03](https://www.youtube.com/watch?v=u9JmGzIiYtE&t=543s): comandi rapidi raggruppati. | Apri cartella appartiene alla riga del paziente o al suo dettaglio. Evitare azioni globali che agiscono su una selezione invisibile. Cambiare selezione non equivale a salvare o applicare. |
| Rendere scopribili le opzioni secondarie | [Fotocamera iOS 26, 12:30](https://www.youtube.com/watch?v=8aqr13ush9w&t=750s): accesso visibile alle altre modalità; [Control Center, 18:49](https://www.youtube.com/watch?v=8aqr13ush9w&t=1129s): indicatori di pagina. | Un menu o una disclosure hanno etichetta e invito visibile. Le funzioni poco frequenti non richiedono un gesto segreto. Ridurre il numero di controlli iniziali mantenendo raggiungibili quelli pertinenti. |
| Far emergere il contenuto, limitare la decorazione | [BPER, 4:33](https://www.youtube.com/watch?v=6rU4_TdpFOY&t=273s): saldo dominante e gruppi distinti; [iOS 26, 7:36](https://www.youtube.com/watch?v=8aqr13ush9w&t=456s): barre sopra sfondi diversi. | Usare titoli semantici, spazi interni e separatori. Il contenitore e il materiale non sostituiscono la gerarchia. Controllare contrasto e leggibilità sul contenuto effettivo anche durante lo scroll. |
| Dare profondità quando serve | [Trenitalia, 13:21](https://www.youtube.com/watch?v=7e4GKcDmukU&t=801s): confronto tra offerta compatta e dettaglio dei servizi; [YouTube mobile, 22:49](https://www.youtube.com/watch?v=X-xF0LbEpoY&t=1369s): conversazione e compositore distinti. | Mostrare prima i dati presenti e utili; aprire dettagli e strumenti nel contesto del compito. Una sezione vuota non deve occupare lo stesso spazio di una sezione popolata. Stato non caricato o errore restano espliciti. |
| Nominare oggetto ed effetto | [iOS 14, 6:34](https://www.youtube.com/watch?v=z0U8mJfcFdk&t=394s): proposta con identità dell'app e azioni distinte per eliminazione e occultamento. | Il testo breve deve ancora distinguere nascondere, annullare e cancellare. Conseguenze e destinatario restano comprensibili. |

I passaggi riportati sono parafrasi. BPER è presentato come collaborazione
promozionale, quindi la discussione sul design non è una misura indipendente.
Raggiungibilità, riduzione dello scorrimento e comprensione restano ipotesi
da verificare: un fotogramma non dimostra durata della transizione,
comportamento da tastiera o esito dell'azione.

## Traduzione per piattaforma

| Aspetto | iPhone | iPadOS | macOS |
| --- | --- | --- | --- |
| Navigazione | Poche destinazioni stabili nella tab bar; stack per il dettaglio. | Lista e dettaglio su spazio ampio; riduzione ordinata delle colonne nella finestra stretta. | Sidebar e dettaglio, toolbar contestuale, comandi da tastiera. |
| Consultazione durante la scrittura | Percorso secondario esplicito con ritorno alla bozza. | Pannello di consultazione vicino all'editor quando la larghezza lo consente. | Inspector o colonna di contesto senza duplicare il documento aperto. |
| Gerarchia | Titolo leggibile, contenuto prioritario, opzioni progressive. | Densità media, titoli allineati tra colonne, niente spazi vuoti creati da altezze fisse. | Pianta informativa compatta ma leggibile; intestazioni e righe condividono lo stesso asse. |
| Controlli | Target touch di almeno 44 pt e Dynamic Type. | Touch, puntatore e tastiera; evitare gesti obbligatori non visibili. | Focus, etichette, scorciatoie e menu di sistema; nessun controllo deformato al resize. |

La tabella è una traduzione progettuale per MediFlow, non una prescrizione
di Breccia. Le indicazioni Apple raccomandano di adattare barre laterali
e viste affiancate allo spazio disponibile, comprese le finestre iPad
ridimensionabili: [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars),
[Split views](https://developer.apple.com/design/human-interface-guidelines/split-views).
L'opzione `sidebarAdaptable` va valutata rispetto ai deployment target
reali, non impone di sostituire la navigazione esistente:
[tab navigation](https://developer.apple.com/documentation/swiftui/enhancing-your-app-content-with-tab-navigation).

Titoli, corpo e testi di supporto devono usare gli stili SwiftUI semantici,
conservando il registro numerico del contratto nativo. La gerarchia deve
reggere Dynamic Type e testo su più righe, perché dati e comandi clinici
mantengano nome, unità, provenienza e stato necessari a interpretarli.

Su Windows e Linux serve un adattamento ai rispettivi paradigmi. Vicinanza,
chiarezza e approfondimento progressivo sono trasferibili; tab bar, sidebar,
materiali e scorciatoie Apple non lo sono automaticamente.

## Verifica di una modifica

- Verificare che oggetto corrente, sezione, data e prossimo passo siano
  riconoscibili subito.
- Raggiungere una funzione secondaria senza dover conoscere gesti nascosti.
- Cambiare selezione, aprire un dettaglio e tornare senza perdere una
  compilazione pendente né confondere il destinatario delle azioni.
- Provare finestre strette e ampie, testo grande, light/dark, focus e riduzione
  del movimento, rilevando tagli, sovrapposizioni e margini interni.
- Separare ciò che è stato osservato dai controlli ancora necessari:
  compilazione, interazione nel simulatore, esecuzione macOS e verifica
  assistiva sono evidenze diverse.

## Copertura e conservazione

La ricognizione pubblica ha contato 116 schede nella tab Video, fino
all'ultimo elemento restituito dalla pagina, mentre l'intestazione indicava
123 video. La differenza non è stata risolta: l'inventario non equivale
alla visione dell'intero canale.

Il primo lotto comprende 22 video pertinenti; il secondo aggiunge nove
trascrizioni lette per intero con relativi campioni visivi. Per trackpad iPad
ed errori iPhone X, due casi del secondo lotto, i fotogrammi non permettono
di verificare utilmente i dettagli della UI e i criteri restano testuali.
L'export indica la trascrizione di `LOI9bedJ-wo` come autoriale o non
specificata, le altre del secondo lotto come automatiche. Per `xA2VLyQgEDA`
il testo esportato arriva a 1:41 su una durata player di 1:56: è stato letto
tutto il testo disponibile, non coperto l'intero audio. Le fonti in tabella
sono il sottoinsieme usato direttamente per i criteri.

Satispay `cM6us-EgdEk` resta escluso: l'export della trascrizione non era
disponibile neppure dopo il controllo ordinario dei sottotitoli. La cattura
del blocco documenta quel limite e non vale come riferimento di design.

### Atlante illustrato locale

L'atlante riutilizzabile si trova in
`~/Documents/Codex/Design References/2026-09-06-Breccia-Apple/`.
`README.md` e `index.html` raccolgono otto screenshot con osservazione,
applicazione a MediFlow, autore, URL e timecode. I fotogrammi originali sono
in `images/`, mentre `sources.json` ne registra dimensioni e SHA-256:
conservare l'intera cartella per mantenere insieme immagini e provenienza.

Gli esempi riguardano sveglie, telefonia, tastiera, due varianti di Salute,
Fotocamera, profilo e discografia. Le immagini restano fuori Git.
Il concept Salute è un riferimento di disposizione: i giudizi sanitari
che contiene non diventano criteri clinici dell'applicazione.

Anche trascrizioni, immagini della fonte pubblica, inventario e note
rimangono fuori Git in `tmp-086-twin/breccia-reference/`, nel worktree
`mediflow-086-runtime-twin`. La guida conserva criteri, URL e timecode
per essere utile anche senza il corpus locale; nei materiali non figurano
dati di pazienti o sessioni autenticate.

## Applicazione a MediFlow 0.8.6

Alla prima applicazione descritta qui segue la
[proposta strutturale macOS](./2026-09-06-086-macos-redesign.md), che introduce
una sola lista laterale e una cartella documentale. Il relativo verbale
separa ciò che è implementato, ciò che è stato osservato e ciò che resta
soggetto all'accettazione dell'utente.

La prima applicazione riguarda la cartella paziente condivisa dalle app
Apple, nel candidato locale della lane
`codex/WUL-676-086-apple-refinement`, derivata dal candidato funzionale
`07725c7`:

- Su iPhone un tocco apre una destinazione dedicata al dettaglio; su iPad
  ampio e Mac restano affiancati lista e dettaglio.
- Sezione clinica rende raggiungibili sette gruppi. La scheda collega i
  contenuti caricati e il dettaglio mostra una sezione alla volta; selezione
  e bozze rimangono nel modello dello spazio di lavoro, senza nuova
  persistenza o nuovi contratti API.
- Il Diario distingue data, titolo, contenuto e azioni. Si comincia da Nuova
  voce, aprendo allegati e trascrizione quando servono. A ogni modifica,
  il testo dell'editor legge il documento corrente.
- Sul Mac, il cambio di sezione conserva la larghezza delle colonne e riporta
  il contenuto in cima. La trascrizione finalizzata resta separata in memoria
  per lo stesso paziente e la stessa sessione, mentre la cattura si ferma
  quando si esce dalla sezione. Sostituire testo manuale richiede una conferma
  riferita ai testi correnti: non c'è approvazione implicita.
- Documenti distingue lettura in corso, errore e archivio letto ma vuoto.
  Caricamento, sintesi e verifica FSE si aprono esplicitamente; il dettaglio
  dell'allegato viene presentato dallo spazio di lavoro anche quando proviene
  dal Diario.

È una parte implementata del redesign, non una revisione di tutte le app.
Modalità demo e fixture di test verificano la presentazione, ma non
sostituiscono pairing, scritture cliniche, condivisione esterna o installazione
su dispositivi reali. Il
[verbale Apple](../analysis/2026-09-06-086-apple-ui-verification.md) distingue
compilazione, test, osservazione UI e limiti; i log restano nella ricevuta
locale della lane.
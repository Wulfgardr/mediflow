# Riferimenti Breccia per le interfacce Apple

Raccolta del 6 settembre 2026, richiesta dall'utente per guidare sviluppo,
redesign e rifinitura delle app iOS, iPadOS e macOS. Sono criteri di progetto
ricavati da esempi e critiche, da confrontare con il compito concreto e con
le convenzioni Apple. Non sono risultati di test sugli utenti di MediFlow.

## Come usare questa raccolta

Prima di intervenire su una schermata, identificare il compito, la selezione
attiva e il prossimo passo. Elencare le funzioni esistenti e distinguere
navigazione, modifica e informazione. Scegliere il criterio pertinente qui
sotto, applicarlo a una porzione verificabile e confrontare il prima/dopo
su dati sintetici. La raccolta integra [DESIGN.md](../../DESIGN.md) e il
[contratto Apple](./lume/06-macos-apple-contract.md); non modifica accesso,
cifratura, contratti clinici o disponibilita dei servizi.

## Criteri con fonti

| Criterio | Evidenza nel video | Applicazione alle app |
| --- | --- | --- |
| Dare un nome al compito e al gruppo | [UX, 6:35](https://www.youtube.com/watch?v=bRBIDHxiCO4&t=395s): annullamento presentato insieme ai metodi di pagamento; [8:16](https://www.youtube.com/watch?v=bRBIDHxiCO4&t=496s): azione secondaria riconoscibile. | Un titolo descrive tutte le opzioni sottostanti. Un comando secondario resta distinguibile dal testo e da un comando disabilitato. Separare Annulla da Salva e dalle opzioni del contenuto. |
| Accostare valore, significato e azione | [App telefoniche, 3:59](https://www.youtube.com/watch?v=QtFe4HZhspE&t=239s): offerta, credito e ricarica riuniti; [12:06](https://www.youtube.com/watch?v=QtFe4HZhspE&t=726s): stato e interruttori distinti. | Dato, unita, data e filtro appartengono allo stesso gruppo. Un conteggio non deve sembrare un pulsante. Una modifica deve avere un esito leggibile, non solo un'animazione. |
| Conservare orientamento e riferimento | [App telefoniche, 13:17](https://www.youtube.com/watch?v=QtFe4HZhspE&t=797s): critica alla perdita della navigazione; [YouTube, 17:14](https://www.youtube.com/watch?v=X-xF0LbEpoY&t=1034s): video e commenti affiancati. | Tenere riconoscibili paziente, sezione e ritorno. Su iPad e Mac, lista e dettaglio possono convivere. Su iPhone, dare un percorso esplicito per consultare e tornare alla bozza. |
| Far seguire le azioni alla selezione | [PS5, 6:03](https://www.youtube.com/watch?v=u9JmGzIiYtE&t=363s): selezione, descrizione e comandi dello stesso oggetto; [9:03](https://www.youtube.com/watch?v=u9JmGzIiYtE&t=543s): comandi rapidi raggruppati. | Apri cartella appartiene alla riga del paziente o al suo dettaglio. Evitare azioni globali che agiscono su una selezione invisibile. Cambiare selezione non equivale a salvare o applicare. |
| Rendere scopribili le opzioni secondarie | [Fotocamera iOS 26, 12:30](https://www.youtube.com/watch?v=8aqr13ush9w&t=750s): accesso visibile alle altre modalita; [Control Center, 18:49](https://www.youtube.com/watch?v=8aqr13ush9w&t=1129s): indicatori di pagina. | Un menu o una disclosure hanno etichetta e invito visibile. Le funzioni poco frequenti non richiedono un gesto segreto. Ridurre il numero di controlli iniziali mantenendo raggiungibili quelli pertinenti. |
| Far emergere il contenuto, limitare la decorazione | [BPER, 4:33](https://www.youtube.com/watch?v=6rU4_TdpFOY&t=273s): saldo dominante e gruppi distinti; [iOS 26, 7:36](https://www.youtube.com/watch?v=8aqr13ush9w&t=456s): barre sopra sfondi diversi. | Usare titoli semantici, spazi interni e separatori. Il contenitore e il materiale non sostituiscono la gerarchia. Controllare contrasto e leggibilita sul contenuto effettivo anche durante lo scroll. |
| Dare profondita quando serve | [Trenitalia, 13:21](https://www.youtube.com/watch?v=7e4GKcDmukU&t=801s): confronto tra offerta compatta e dettaglio dei servizi; [YouTube mobile, 22:49](https://www.youtube.com/watch?v=X-xF0LbEpoY&t=1369s): conversazione e compositore distinti. | Mostrare prima i dati presenti e utili; aprire dettagli e strumenti nel contesto del compito. Una sezione vuota non deve occupare lo stesso spazio di una sezione popolata. Stato non caricato o errore restano espliciti. |
| Nominare oggetto ed effetto | [iOS 14, 6:34](https://www.youtube.com/watch?v=z0U8mJfcFdk&t=394s): proposta con identita dell'app e azioni distinte per eliminazione e occultamento. | Il testo breve deve ancora distinguere nascondere, annullare e cancellare. Conseguenze e destinatario restano comprensibili. |

I passaggi sono parafrasi. BPER e presentato come collaborazione promozionale;
la sua discussione sul design non costituisce una misura indipendente.
Raggiungibilita, riduzione dello scroll e comprensione sono ipotesi da
verificare: un fotogramma non prova durata di una transizione, comportamento
da tastiera o risultato di un'azione.

## Traduzione per piattaforma

| Aspetto | iPhone | iPadOS | macOS |
| --- | --- | --- | --- |
| Navigazione | Poche destinazioni stabili nella tab bar; stack per il dettaglio. | Lista e dettaglio su spazio ampio; riduzione ordinata delle colonne nella finestra stretta. | Sidebar e dettaglio, toolbar contestuale, comandi da tastiera. |
| Consultazione durante la scrittura | Percorso secondario esplicito con ritorno alla bozza. | Pannello di consultazione vicino all'editor quando la larghezza lo consente. | Inspector o colonna di contesto senza duplicare il documento aperto. |
| Gerarchia | Titolo leggibile, contenuto prioritario, opzioni progressive. | Densita media, titoli allineati tra colonne, niente spazi vuoti creati da altezze fisse. | Pianta informativa compatta ma leggibile; intestazioni e righe condividono lo stesso asse. |
| Controlli | Target touch di almeno 44 pt e Dynamic Type. | Touch, puntatore e tastiera; evitare gesti obbligatori non visibili. | Focus, etichette, scorciatoie e menu di sistema; nessun controllo deformato al resize. |

Questa e una nostra traduzione progettuale, non una prescrizione di Breccia.
Apple raccomanda di adattare sidebar e split view allo spazio disponibile,
anche nelle finestre iPad ridimensionabili: [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars),
[Split views](https://developer.apple.com/design/human-interface-guidelines/split-views).
`sidebarAdaptable` e un'opzione da valutare con i deployment target effettivi,
non un obbligo di sostituzione della navigazione esistente:
[tab navigation](https://developer.apple.com/documentation/swiftui/enhancing-your-app-content-with-tab-navigation).

Usare stili SwiftUI semantici per titoli, corpo e supporto, conservando il
registro numerico previsto dal contratto nativo. La gerarchia deve reggere
Dynamic Type e multilinea. Dati e comandi clinici mantengono nome, unita,
provenienza e stato necessari a interpretarli.

Windows e Linux richiedono un adattamento separato ai rispettivi paradigmi.
Da questa raccolta si trasferiscono vicinanza, chiarezza e profondita
progressiva; non si trasferiscono automaticamente tab bar, sidebar,
materiali o scorciatoie Apple.

## Verifica di una modifica

- Identificare subito oggetto corrente, sezione, data e prossimo passo.
- Raggiungere una funzione secondaria senza conoscere gesti nascosti.
- Cambiare selezione, aprire un dettaglio e tornare senza confondere il
  destinatario delle azioni o perdere una compilazione pendente.
- Provare finestra stretta e ampia, testo grande, light/dark, focus e
  riduzione del movimento. Rilevare tagli, sovrapposizioni e margini interni.
- Distinguere il risultato visibile dai controlli ancora da eseguire:
  compilazione, interazione nel simulatore, run macOS e verifica assistiva
  sono evidenze diverse.

## Copertura e conservazione

La ricognizione pubblica ha enumerato 116 schede nella tab Video del canale,
fino all'ultimo elemento reso dalla pagina. L'intestazione mostrava 123 video:
la differenza non e stata risolta. Questo inventario non equivale alla
visione dell'intero canale.

Il primo lotto comprende 22 video pertinenti; il secondo aggiunge nove
trascrizioni lette integralmente e relativi campioni visivi. Per due casi
del secondo lotto (trackpad iPad ed errori iPhone X) i fotogrammi non permettono
una verifica utile dei dettagli dell'interfaccia: i criteri restano testuali.
La trascrizione di `LOI9bedJ-wo` e marcata dall'export come autoriale o non
specificata; le altre del secondo lotto sono automatiche. Per `xA2VLyQgEDA`
l’export arriva a 1:41 contro una durata player di 1:56: si dichiara la lettura
del testo disponibile, non la copertura integrale dell’audio. Le fonti della
tabella sono il sottoinsieme usato direttamente per questi criteri.

Il video Satispay `cM6us-EgdEk` resta escluso dall'analisi: export della
trascrizione non disponibile anche dopo il controllo ordinario dei
sottotitoli. La cattura del blocco non e un riferimento di design.

### Atlante illustrato locale

La raccolta riutilizzabile e conservata in
`~/Documents/Codex/Design References/2026-09-06-Breccia-Apple/`.
Contiene `README.md` e `index.html` con otto screenshot delle interfacce,
nota di osservazione e applicazione a MediFlow, autore, URL e timecode.
La cartella `images/` conserva i fotogrammi originali; `sources.json`
registra dimensioni e SHA-256. Conservare la cartella intera.

Gli esempi riguardano sveglie, telefonia, tastiera, due varianti di Salute,
Fotocamera, profilo e discografia. Le immagini della fonte restano fuori Git.
Il concept Salute documenta una disposizione: i suoi giudizi sanitari non
sono criteri clinici da trasferire all'applicazione.

Le trascrizioni e le immagini della fonte pubblica restano fuori Git,
insieme all'inventario e alle note, in
`tmp-086-twin/breccia-reference/` nel worktree `mediflow-086-runtime-twin`.
La guida conserva criteri, URL e timecode per essere riutilizzabile anche
senza quel corpus locale. Nessun dato di paziente o sessione autenticata
fa parte dei materiali.

## Applicazione a MediFlow 0.8.6

La prima applicazione descritta sotto è seguita dalla
[proposta strutturale macOS](./2026-09-06-086-macos-redesign.md), con una sola
lista laterale e una cartella documentale. Il relativo verbale distingue
implementazione, osservazione visiva e accettazione ancora da parte dell'utente.

Candidato locale nella lane `codex/WUL-676-086-apple-refinement`, derivata
dal candidato funzionale `07725c7`. La prima applicazione riguarda la
cartella paziente condivisa dalle app Apple:

- Su iPhone, un tocco apre il dettaglio in una destinazione dedicata;
  su iPad ampio e Mac rimangono lista e dettaglio affiancati.
- Il menu Sezione clinica rende raggiungibili sette gruppi. La scheda
  presenta collegamenti ai contenuti caricati; il dettaglio mostra una
  sezione alla volta. Selezione e bozze rimangono nel modello dello spazio
  di lavoro, senza nuova persistenza o nuovi contratti API.
- Il Diario separa data, titolo, contenuto e azioni. La creazione parte
  da Nuova voce; allegati e trascrizione sono strumenti progressivi.
  Il testo dell’editor legge il documento corrente a ogni modifica.
- Sul Mac le colonne mantengono la larghezza cambiando sezione, mentre
  il contenuto torna in cima. La trascrizione finalizzata resta separata
  in memoria per lo stesso paziente e la stessa sessione; la cattura
  si ferma uscendo dalla sezione. Sostituire testo manuale richiede una
  conferma riferita ai testi correnti, senza approvazione implicita.
- Documenti distingue lettura in corso, errore e archivio letto ma vuoto.
  Caricamento, sintesi e verifica FSE hanno aperture esplicite. Il dettaglio
  allegato e presentato dallo spazio di lavoro, anche quando arriva dal Diario.

Questa e una porzione implementata del redesign, non una revisione completa
di tutte le app. La modalita demo e le fixture dei test provano la
presentazione; non sostituiscono pairing, scritture cliniche, condivisione
esterna o installazione su dispositivi reali. Il [verbale Apple](../analysis/2026-09-06-086-apple-ui-verification.md)
riporta compilazione, test, osservazione UI e limiti; i log restano nella
ricevuta locale della lane.

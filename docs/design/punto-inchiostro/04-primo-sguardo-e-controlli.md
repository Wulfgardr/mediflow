---
summary: "Criteri visivi del redesign 0.9.1: primo sguardo sulla scheda, gerarchia delle righe, controlli riconoscibili e copertura di Web e GPUI."
read_when:
  - "Applicando le decisioni D17-D25 alla scheda paziente o alle altre viste Web e GPUI."
  - "Verificando che cosa del redesign 0.9.1 è già fatto e che cosa manca su ciascuna superficie."
---

# Primo sguardo e controlli riconoscibili

Decisioni del 18 novembre 2026, per WUL-894. Nascono dalla seduta Q7: la scheda
è ricca, ma ha troppo annidamento, campi poco visibili, informazioni che
competono sullo schermo e selettori squadrati. Questo documento completa la
[specifica](./01-specifica.md) e l'[addendum compositivo](./02-addendum-composizione.md).
Dove modifica una loro regola lo dice. Vale per il Web locale e per GPUI sul
Mac, con le misure di piattaforma già previste.

Le regole descrivono il risultato da ottenere. La tabella in fondo dice che
cosa è già realizzato e su quale superficie.

## D17. La scheda si apre su fatti registrati

Aprendo un paziente, senza scorrere e senza generare nulla, si leggono:

- nome, età e nascita, anche quando l'anno è stimato
- l'identificativo con il suo nome (CF, STP, ENI, Documento), oppure la frase
  «Nessun identificativo per ora» quando manca (ADR 0179)
- le allergie, o la loro assenza registrata
- i problemi documentati, con codice e data, nell'ordine in cui sono registrati
- le ultime modifiche di terapia, con la data
- le ultime voci del diario, con autore e data di registrazione.

Ogni riga porta la propria data: è quella la fonte del recap. L'ordine dei
problemi è quello della cartella e non esprime una priorità clinica.

Vietato ordinare i problemi per importanza presunta, riassumere con testo
generato ciò che la cartella contiene già, o mostrare un'età ricavata da un
codice che non la attesta.

## D18. Stato attuale ed eventi sono cose diverse

«Terapie attive» dice che cosa il paziente assume oggi. «Ultime modifiche di
terapia» dice che cosa è cambiato: per ogni terapia l'ultimo evento che la
scheda attesta (Avviata, Aggiornata, Sospesa, Conclusa) con la sua data, dal
più recente. Le due liste non si fondono e non usano lo stesso titolo.

La scheda non conserva una storia per terapia. Per una sospensione la data è
quella dell'ultima modifica registrata, ed il recap non ricostruisce passaggi
che la cartella non ha.

Questa sezione è la quinta tabella del Riepilogo e modifica D9, che ne
prevedeva quattro.

## D19. Il Quadro paziente si raggiunge dalla scheda e resta una proposta

La riga unica delle proposte prevista da D6 sta in cima al Riepilogo, non in
fondo. Conserva la matita ed il conteggio delle proposte effettive. L'ingresso
«Quadro paziente» ha la forma di un comando secondario, con icona e nome, e
porta all'area delle proposte: non genera nulla e non cambia la cartella.

Resta una riga sola. Fatti e proposta si distinguono per posto e per
inchiostro: i fatti sono nelle tabelle a inchiostro asciutto, la proposta è a
matita, con modello, fonti e data dentro la propria area.

Vietato generare all'apertura della scheda, ripetere il pannello nel
Riepilogo o dare al comando il fondo pieno del principale.

## D20. La riga dice ciò che serve

Una riga di registro mostra senza aprire ciò che serve a leggerla: per una
terapia farmaco, posologia, indicazione o nota, diagnosi collegata e periodo.
I codici stanno nella riga con peso minore, in carattere da codice. Una
disclosure dentro la riga è ammessa solo per contenuto che la riga non può
ospitare, come referti e allegati. Non ripete mai ciò che è già in colonna.

In larghezza ridotta la riga impila gli stessi dati. Non nasconde colonne
dietro un controllo.

Vale per Terapie, Prestazioni, Protesica e Documenti. Per un documento:
nome, identità, data e dimensione su una riga, stato sotto, azioni accanto
al nome. L'originale aperto occupa l'altezza della finestra.

## D21. Le superfici flottanti hanno il raggio dei controlli

Menu, pannelli di azioni, risultati di ricerca e avvisi temporanei sono
superfici flottanti: prendono il raggio dei controlli (Web 10, GPUI sul Mac
12), non quello dei record, che resta 0. Le righe al loro interno hanno un
raggio concentrico, cioè il raggio esterno meno il rientro. Ogni voce ha
margine, stato al passaggio e fuoco visibile, e l'azione distruttiva resta
l'ultima.

Vietata una cornice squadrata attorno a righe arrotondate, come già chiede
`DESIGN.md` per le cornici annidate.

## D22. Segmenti e indice hanno segni diversi

I segmenti della cartella cambiano il contenuto: sottolineatura sotto la voce
attiva, e restano in vista mentre si legge una sezione. Un indice elenca le
sezioni di una pagina unica, come in Analisi e nella libreria delle Scale:
porta la dicitura «In questa pagina», segna la sezione scelta con il solo
peso del testo, senza sottolineatura, e scorre fino a mostrarla.

In entrambi i casi la voce segnata è quella scelta, finché è visibile. Dopo
uno scorrimento l'indice torna a segnare la sezione che si sta leggendo.

## D23. Il contorno dei campi si vede

Un campo che riceve testo o una scelta ha un contorno che si distingue dal
fondo almeno 3:1 a riposo, nei due temi. Il filetto forte resta per le
intestazioni e per i comandi secondari. Ogni campo ha un'etichetta visibile
associata al controllo, e i gruppi di scelte hanno un nome.

Aperto: il valore del contorno. Oggi nella cartella Web vale l'inchiostro
secondario (6,56:1 in Giorno). La scelta fra questo e una tinta intermedia è
di Leonardo (WUL-893) e modifica la riga «Campo» della specifica.

## D24. I titoli di sezione si leggono

Il titolo di una sezione si trova a colpo d'occhio e pesa più
dell'intestazione di colonna che lo segue.

Aperto: la misura. La specifica fissa 12 px in maiuscolo per entrambi. La
scelta fra questa e un titolo di 14 px, peso 600, senza maiuscolo è di
Leonardo (WUL-892) e modifica la tabella tipografica della specifica.

## D25. Scrivere, rivedere, registrare: l'esito si riconosce

Per una nota, una voce o una modifica di terapia, su Web e su GPUI:

1. il comando che apre la scrittura ha il nome di ciò che si scrive
2. durante la scrittura il punto dice «Bozza non registrata»
3. la revisione mostra che cosa verrà scritto e su quale paziente, e ha un
   solo comando principale con il nome dell'azione, per esempio «Conferma e
   registra»
4. dopo la registrazione il testo si rilegge nello stesso posto, ed il punto
   dice «Registrata» solo dopo la rilettura dello stato salvato
5. un rifiuto o un conflitto compare dove si stava scrivendo, con la bozza
   conservata e un solo modo per rileggere
6. dalla stessa vista si arriva al registro delle operazioni.

Vietato un comando di revisione senza nome, un esito affidato al solo
colore, o una conferma che sparisce senza lasciare il testo registrato.

## Copertura

Stato al 18 novembre 2026. «Fatto» indica una PR aperta o unita con prove
sulla superficie. Le voci GPUI sono da verificare a schermo sul candidato.

| Criterio | Web locale | GPUI sul Mac |
| --- | --- | --- |
| D17 Primo sguardo | Fatto nella scheda (PR 1044) | Da fare: testata con identificativo assente e anno stimato, recap nel Riepilogo |
| D18 Stato ed eventi | Fatto nel Riepilogo (PR 1044) | Da fare |
| D19 Quadro paziente | Fatto: riga in cima e comando (PR 1044) | Da fare: ingresso dal Riepilogo, oggi dentro la sezione |
| D20 Righe | Fatto per Terapie e Documenti (PR 1044). Da fare: Prestazioni, Protesica, Parametri | Da fare: Terapie, Documenti, Prestazioni |
| D21 Superfici flottanti | Fatto per menu e ricerche (PR 1044). Da fare: avvisi temporanei, pannelli della testata, altri usi del raggio dei record | Da verificare: menu e selettori |
| D22 Segmenti e indice | Fatto: segmenti in vista (PR 1044), indice che segue la scelta (PR 1042). Da fare: segno dell'indice e dicitura | Da fare: Analisi e Scale |
| D23 Campi | Fatto nella cartella (PR 1044). Da fare, dopo la scelta: Impostazioni, primo avvio, nuova scheda, scale, importazione | Da fare, dopo la scelta: campi e scelte di modulo |
| D24 Titoli di sezione | Da fare, dopo la scelta | Da fare, dopo la scelta |
| D25 Scrivere e registrare | Da verificare su Nuova voce, note di scheda, terapia. Conflitto terapia già leggibile | Da fare: «Modifica note», «Registra», «Conferma e registra», rilettura e registro delle operazioni |

Le viste fuori dalla scheda seguono gli stessi criteri: Pazienti, Agenda,
Diario, Repertori, Analisi, Scale, Impostazioni, sblocco e primo avvio. Per
ciascuna la prova è la stessa: dati sintetici, i due temi, larghezza normale
e ridotta, tastiera, e i gesti di Q7 che la attraversano.

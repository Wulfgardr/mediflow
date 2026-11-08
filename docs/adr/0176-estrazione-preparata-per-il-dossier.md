# ADR 0176: estrazione preparata per il dossier

Stato: proposta. Data: 2026-11-03.
Estende [ADR 0175](./0175-dossier-import-da-cartella.md). Non cambia [ADR 0084](./0084-document-diagnoses-review-only.md):
nessun percorso AI scrive record clinici; le scritture restano quelle del dossier, su decisione del medico.

## Problema

Con ADR 0175 il dossier propone soltanto ciò che i parser deterministici riconoscono:
righe di laboratorio, codici ICD etichettati, esenzioni del catalogo, sezioni con
un'etichetta esplicita. In un referto vero molto resta nel residuo: farmaci senza la
riga «Terapia:», diagnosi e copatologie dentro un paragrafo, eventi clinici descritti in
prosa. Il medico deve leggere e trascrivere a mano, documento per documento.

Il medico lavora spesso fuori sede, senza MediFlow, e accumula per giorni documenti di
più pazienti in una sola cartella. ADR 0175 raggruppa per sottocartella: una cartella
mista con codici fiscali diversi resta bloccata.

## Decisione

MediFlow accetta un file **estrazione preparata** (`mediflow.dossier_prepared_extraction.v1`),
prodotto fuori dall'app dalla skill `mediflow-dossier-import`, e lo tratta come proposta
non fidata. L'app non chiama modelli: legge un file scelto dal medico.

1. **Abbinamento per byte.** Ogni voce porta lo sha256 dell'originale; il nome del file
   non conta. Una fonte assente dall'estrazione lo dichiara nell'inventario.
2. **Citazione verificata sul testo di MediFlow.** Ogni fatto porta una citazione di
   almeno tre parole e dodici caratteri. MediFlow la cerca per parole nel testo che ha
   estratto lei stessa, unità per unità: esatta, oppure approssimata, dove ogni parola
   coincide o differisce al più di una lettera, solo in parole di almeno cinque lettere
   senza cifre e non più di una parola ogni sei. Numeri e parole brevi («non») non si
   approssimano mai. Le parole si confrontano senza maiuscole e diacritici; cifre e
   lettere attaccate si separano. L'evidenza ha gli offset del testo conservato.
3. **Campi nel passo del documento.** Sul passo trovato, non sulla citazione proposta,
   devono comparire i campi clinici del fatto: farmaco e numeri della dose; esame, valore
   e unità; descrizione e codice della diagnosi; codice di esenzione; prestazione e NRE;
   ausilio e codice ISO; scala, totale e massimo; percentuale d'invalidità. Un principio
   attivo non scritto nel passo diventa una nota da confermare, non un dato. Un testo
   descrittivo (anamnesi, valutazione, imaging, contesto, invalidità) è verificato solo se
   è esso stesso un passo del documento; una riformulazione resta da decidere.
   Oltre al passo, contano le parole della stessa frase prima della citazione: una
   negazione («non assume») nega il fatto e un familiare (genitori, figli, fratelli,
   coniuge, moglie, marito e altri parenti) mette la terapia o la diagnosi in conflitto
   di soggetto, anche se la citazione li taglia fuori. Il fatto resta visibile e si decide
   a mano, ma non entra nel blocco.
4. **Regole del dominio invariate.** Codici LOINC e UCUM solo dal catalogo locale, anche
   se il file ne propone: un valore senza corrispondenza non diventa osservazione e resta
   nella sintesi. Date solo ISO valide e non future; la data del documento letta da
   MediFlow prevale su quella del file; mai la data di oggi. Una terapia «in corso» di un
   documento più vecchio di 120 giorni, o senza data, torna storica. Un farmaco senza dose
   scritta ha posologia «non indicata nel documento».
   La terapia può portare il principio attivo, scritto in `therapies.active_principle`.
5. **Sintesi.** Ogni documento ha una sintesi breve degli eventi clinici. È testo
   riassunto, non verificabile: entra solo con una scelta esplicita del medico («Ho letto
   le sintesi»), e allora sostituisce la voce di diario col testo intero, che resta
   nell'artefatto cifrato dell'allegato.
6. **Proposte dei parser.** Restano tutte visibili. Una proposta per sezione o di scala
   si rifiuta solo se un fatto preparato dello stesso tipo è accettato nello stesso
   documento; la voce col testo intero solo se la sintesi è accettata. Una proposta
   preparata uguale a una codificata del parser non si ripete.
7. **Paziente.** Le fonti si raggruppano per il paziente indicato dall'estrazione (codice
   fiscale valido, altrimenti cognome, nome e nascita), solo se quel CF o quel cognome e
   nome sono scritti nel testo letto da MediFlow. Un paziente proposto e non scritto nel
   documento non raggruppa la fonte, che resta nel gruppo della cartella con una nota.
   Il CF dell'estrazione serve solo a
   raggruppare: il controllo d'identità di ADR 0175 resta sui codici letti da MediFlow, e
   un'attribuzione sbagliata produce un gruppo discordante e bloccato. Senza CF leggibile
   nessuna scheda viene preselezionata, e se il documento scrive il paziente su una riga con
   etichetta («Paziente:», «Assistito:», «Cognome e nome:», parole con l'iniziale maiuscola)
   almeno uno dei nomi scritti deve essere quello della scheda scelta: altrimenti il gruppo è
   bloccato (`discordant_name`). Un secondo nome sullo stesso documento, come il prescrittore
   nei moduli di protesica, non blocca (aggiornamento del 7 novembre 2026: falsificazione 10
   del banco del 5 novembre, misurata anche sui 33 documenti reali del lotto del 3 novembre,
   zero blocchi sulla scheda giusta). La nuova scheda riceve dall'estrazione le proposte
   d'anagrafica mancanti, sempre con un gesto del medico e il PIN.
8. **Dossier già acquisiti.** Una fonte già nel dossier riceve le nuove proposte
   preparate da decidere solo se il testo conservato è lo stesso su cui sono state
   verificate e l'originale riletto coincide; le decisioni precedenti restano. L'identità
   dei fatti dipende solo da ciò che il file propone: rileggere lo stesso file non duplica.
9. **Accettazione in blocco.** Per i soli documenti con estrazione preparata, un
   pulsante per scheda, **Accetta il verificato e applica**, decide soltanto: proposte
   verificate (citazione e campi nel passo), nuove rispetto alla scheda, senza negazione e
   senza blocchi; ICD, esenzioni e laboratorio codificati del parser con evidenza; «già
   presente» per ciò che è in scheda o accettato in un'altra fonte; le sostituzioni del
   punto 6; le sintesi solo con la scelta esplicita. Il residuo si conferma solo con la
   sintesi accettata, copertura dichiarata completa e, se MediFlow conta le pagine, lo
   stesso numero di pagine. Conflitti, negazioni, riformulazioni, citazioni brevi o non
   trovate restano da decidere. Un documento cambiato nel frattempo si salta. Poi applica
   con i writer ordinari di ADR 0175 (claim CAS, rilettura su tutti i campi). Senza
   estrazione preparata il dossier funziona come in ADR 0175.

## Confine

`lib/domain/documents/dossier-prepared.ts` resta nel perimetro di
`check:ai-clinical-writes` e non scrive. `acceptVerifiedAndApply` in
`lib/document-dossier-session.ts` passa solo da `saveDossierReview` e
`applyDossierDocument`: nessun nuovo writer. Il file dell'estrazione vive solo nella
memoria della pagina, mai nello storage del browser né nell'URL.

## Consumer GPUI sul Mac host

Dall'8 novembre 2026 ([PR #883](https://github.com/Wulfgardr/mediflow/pull/883)),
GPUI usa il percorso host locale di ADR 0175. La seconda autenticazione precede
la revisione. Il processo locale riusa il modulo TS, mentre
`transport/src/dossier.rs` esegue la verifica Rust indipendente: identità,
citazioni, campi, date, codifica di laboratorio, identificativi e decisioni in
blocco. Una differenza interrompe il processo prima della scrittura.

`native/contracts/dossier-conformance/` contiene soli dati sintetici: venti
documenti del banco, relative estrazioni del parser e candidati, le dieci
falsificazioni ed ingressi raccolti dai test TS, compreso #872. Le attese si
rigenerano con `scripts/update-dossier-conformance.ts` dal verificatore Web
corrente. Le suite Web e Rust confrontano l'intero risultato JSON, senza campi
esclusi. I tempi storici del banco non sono uscite del verificatore.
I test Rust girano nel job GPUI esistente, quelli TS nella suite Web.

## Lettura dei documenti fuori dall'app

La skill legge i documenti con l'agente che la esegue, quindi il testo dei documenti va
al fornitore di quel modello. È una scelta del medico per il lotto, fuori dall'app, e non
cambia la postura locale di MediFlow: con le funzioni AI spente il dossier funziona come
in ADR 0175. Senza estrazione preparata nulla cambia.

## Limiti dichiarati

- La verifica dimostra che la citazione esiste e contiene il valore, non che
  l'interpretazione sia corretta: il medico vede ogni proposta e la sua evidenza.
- Per una scansione, testo di MediFlow e testo della skill vengono da due OCR diversi:
  più citazioni approssimate o non trovate, che restano da decidere.
- Una busta `.p7m` resta senza testo in MediFlow: i fatti vanno sul PDF estratto dalla
  skill, da importare insieme alla busta.

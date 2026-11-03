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
2. **Citazione verificata sul testo di MediFlow.** Ogni fatto porta una citazione breve.
   MediFlow la cerca per parole nel testo che ha estratto lei stessa, unità per unità:
   esatta, oppure approssimata (almeno l'85% delle parole, una sola lettera diversa
   nelle parole lunghe). Una parola con cifre diverse esclude sempre la corrispondenza:
   dosi, valori e date non si approssimano. L'evidenza ha gli offset del testo
   conservato, come le proposte dei parser.
3. **Valori nella citazione.** Il valore chiave (farmaco, codice di diagnosi o di
   esenzione, valore di laboratorio, codice ISO, totale della scala, NRE, percentuale)
   deve comparire nella citazione. Un codice ICD non scritto nel documento non passa.
4. **Regole del dominio invariate.** Codici LOINC e UCUM solo dal catalogo locale: un
   valore di laboratorio senza corrispondenza non diventa osservazione e resta nella
   sintesi. Date solo ISO valide; in loro assenza la data del documento, mai quella di
   oggi. Una terapia «in corso» di un documento più vecchio di 120 giorni torna storica.
   La terapia può portare il principio attivo, scritto in `therapies.active_principle`.
5. **Sintesi.** Ogni documento ha una sintesi breve degli eventi clinici, scritta come
   voce di diario al posto della voce col testo intero. Il testo completo resta
   nell'artefatto cifrato dell'allegato.
6. **Proposte dei parser.** Restano quelle codificate e ancorate (ICD etichettati,
   esenzioni del catalogo, laboratorio con codice). Le proposte per sezione e la voce col
   testo intero lasciano il posto all'estrazione, che descrive lo stesso contenuto.
7. **Paziente.** Le fonti si raggruppano per il paziente indicato dall'estrazione (codice
   fiscale valido, altrimenti cognome, nome e nascita). Il controllo d'identità di ADR
   0175 resta sui codici letti da MediFlow: un'estrazione che attribuisce un documento al
   paziente sbagliato produce un gruppo discordante e bloccato. Il CF dell'estrazione
   partecipa al confronto solo se il testo di MediFlow non ne contiene uno valido. La
   nuova scheda riceve dall'estrazione le proposte d'anagrafica mancanti, sempre con un
   gesto del medico e il PIN.
8. **Dossier già acquisiti.** Una fonte già nel dossier riceve le nuove proposte
   preparate da decidere; le decisioni precedenti restano.
9. **Accettazione in blocco.** Un pulsante per scheda, **Accetta il verificato e
   applica**, decide soltanto: proposte con citazione trovata e valori presenti, nuove
   rispetto alla scheda, senza negazione e senza blocchi; «già presente» per ciò che è in
   scheda o accettato in un'altra fonte; rifiuto per le proposte per sezione sostituite.
   Conferma il residuo solo dove l'estrazione dichiara lette tutte le pagine. Conflitti,
   negazioni, citazioni non trovate e proposte senza citazione restano da decidere. Poi
   applica con i writer ordinari di ADR 0175 (claim CAS, rilettura su tutti i campi).

## Confine

`lib/domain/documents/dossier-prepared.ts` resta nel perimetro di
`check:ai-clinical-writes` e non scrive. `acceptVerifiedAndApply` in
`lib/document-dossier-session.ts` passa solo da `saveDossierReview` e
`applyDossierDocument`: nessun nuovo writer. Il file dell'estrazione vive solo nella
memoria della pagina, mai nello storage del browser né nell'URL.

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

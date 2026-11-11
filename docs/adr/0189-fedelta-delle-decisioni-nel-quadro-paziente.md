# ADR 0189: Fedeltà dello stato delle decisioni nel Quadro paziente

Data: 2026-11-11. Stato: proposto.

Related: [ADR 0020](0020-ai-insight-source-hierarchy-and-conflict-rules.md)
(fonti e conflitti del Quadro), collaudo a schermo 0.9.1, rilievi B e D.

## Problema

Al collaudo a schermo della 0.9.1 il modello locale ha scritto nel Quadro
paziente frasi che cambiano lo stato di una decisione clinica rispetto alla
fonte che citano:

- «Aumentare ramipril a 10 mg e aggiungere amlodipina come deciso [S6].» La
  fonte S6 dice «Da decidere: aumento ramipril a 10 mg e aggiunta di
  amlodipina 5 mg come suggerito.»
- «Fondo oculare scaduto da oltre 2 anni richiede prenotazione urgente [S6]».
  La fonte S6 dice «Ultimo fundus oculi oltre 2 anni fa: da prenotare.» e non
  parla di urgenza.

Sul paziente 1 la forma esplicita «come deciso» è uscita in 3 generazioni su 6.
Il validatore del server (`patient-insight-host-capability.ts`) controllava
solo la forma delle citazioni: ogni frase deve avere almeno un gruppo `[S<n>]`
con indici validi. Non confrontava la frase con la fonte citata.

## Decisione

### Due regole deterministiche sul server

Il controllo sta nel validatore del server, quindi vale per il Web e per GPUI,
che leggono la stessa risposta. Testo di frase e fonti viene normalizzato
(minuscolo, senza accenti, apostrofi tipografici uniformati). Per ogni frase
della proposta (sintesi, quadro attuale, allerte, prossimi passi, lacune) si
leggono le fonti citate nei suoi gruppi `[S<n>]`, con lo stesso testo che il
modello ha ricevuto.

1. **Stato della decisione.** Se almeno una fonte citata contiene un marcatore
   di decisione aperta e la frase contiene un marcatore di decisione presa,
   la frase è infedele.
2. **Urgenza introdotta.** Se la frase contiene un marcatore di urgenza e
   nessuna fonte citata ne contiene uno, la frase è infedele.

Due attenuazioni evitano gli scarti ovvi:

- **Negazione.** Un marcatore preceduto, nella stessa proposizione e entro tre
  parole, da «non», «senza», «nessun», «nessuna», «nessuno» o «mai» non conta. «Non urgente» nella frase non è urgenza; «non urgente» nella fonte
  non autorizza «urgente» nella frase.
- **Riscontro nella fonte.** Un marcatore di decisione presa che compare, non
  negato e con la stessa radice, anche in una fonte citata non conta. Una nota
  come «Avviata metformina. Da rivalutare fra 3 mesi.» autorizza la frase
  «Metformina avviata [S6]».

### Marcatori

L'elenco ha un solo posto: `lib/ai-providers/fabric/patient-insight-fidelity.ts`.
Qui è descritto per famiglie, nella forma normalizzata.

| Famiglia | Marcatori |
| --- | --- |
| Decisione aperta (nella fonte) | «da» seguito da decidere, valutare, rivalutare, definire, discutere, concordare, confermare, prenotare, programmare, avviare, iniziare, introdurre, eseguire, effettuare, richiedere, modificare, aumentare, ridurre, sospendere, fare; «in attesa»; «proposto/a/i/e», «suggerito/a/i/e», «consigliato/a/i/e», «raccomandato/a/i/e»; «valutare», «considerare»; «eventuale/i», «eventualmente»; «ipotesi di» |
| Decisione presa (nella frase) | «deciso/a/i/e» (anche dentro «come deciso», «deciso di», «è stato deciso»); «stabilito», «avviato», «iniziato», «intensificato», «introdotto», «prescritto», «prenotato», «programmato» in tutte le desinenze; «in corso» dopo un cambio di terapia (aumento, aggiunta, modifica, intensificazione, titolazione, introduzione, sostituzione, riduzione, incremento) o nella forma «in corso di» seguita da uno di questi; «in fase di» seguito da aggiustamento, modifica, titolazione, intensificazione, aumento |
| Urgenza | «urgente», «urgenti», «urgentemente», «urgenza»; «immediato/a/i/e», «immediatamente»; «al più presto»; «prima possibile» |

«In corso» da solo non è un marcatore: «terapia con metformina in corso»
racconta una terapia già in scheda, non una decisione presa.

### Una frase infedele scarta tutta la proposta

Alternative considerate:

- **Togliere la frase e dirlo a schermo.** La sintesi è una sola stringa con
  più frasi: togliere una frase vorrebbe dire spezzarla sul server, e una
  sintesi senza la frase scartata può restare costruita sulla stessa deriva.
  Nella prova 2 del collaudo, accanto a «come deciso» c'era «risposta alla
  terapia intensificata» e nella prova 3 «risposta all'aggiunta di
  amlodipina»: frasi che la regola prende solo in parte e che danno per fatta
  la stessa decisione. Il medico vedrebbe un quadro coerente in apparenza ma
  nato da una generazione che ha già cambiato lo stato di una decisione.
  Servirebbe anche un campo nuovo nella proposta (quante frasi tolte e
  perché), letto con chiavi esatte dal Web e da GPUI.
- **Scartare la proposta intera.** È lo stesso trattamento delle citazioni
  non valide: il secondo tentativo locale già esistente
  (`runLocalGenerationAttempts`) rifà la stessa richiesta una volta. Se anche
  la seconda risposta è infedele, nessuna proposta arriva al medico e il
  messaggio a schermo dice la causa.

Scelta: **scarto della proposta intera**, con il secondo tentativo. I due
criteri del collaudo sono rispettati: nessuna decisione che la fonte non
contiene arriva allo schermo, e niente sparisce senza che lo si dica, perché
lo scarto ha un codice proprio e un messaggio proprio. Il costo è una seconda
generazione quando la prima deriva, e un rifiuto quando derivano entrambe.

### Codice e messaggio

Una nuova voce nel codice di fallimento: `proposal_unfaithful`. Il server lo
restituisce quando l'ultimo tentativo è stato scartato da queste regole. Se
l'ultimo tentativo è stato scartato per un'altra causa (citazioni, risposta
tagliata), il codice resta `proposal_invalid`.

Messaggio a schermo, uguale sul Web e in GPUI:

> Il modello ha dato per presa una decisione ancora aperta nella scheda, o per
> urgente qualcosa che la scheda non segnala come urgente. Nessuna proposta
> creata.

## Limiti

- Le regole leggono parole, non significati. Restano fuori le forme implicite
  («risposta all'aggiunta di amlodipina», «terapia modificata»), le inversioni
  di stato senza marcatore («in attesa di visita» quando la visita c'è già
  stata) e le urgenze dette con altre parole.
- Il riscontro nella fonte lavora per radice: se la stessa nota contiene una
  decisione aperta e una decisione presa con la stessa radice, una frase che
  sposta la prima usando quella radice passa.
- Una frase che cita insieme una fonte con una decisione aperta e una fonte
  con un fatto concluso detto con una radice diversa viene scartata anche se
  è fedele.
- Il percorso in rete del Quadro (ChatGPT, `ordinary-task-profile.ts`) non
  applica ancora queste regole: il suo esito di scarto è generico e non
  potrebbe dire la causa.
- Smart Import e sintesi dei documenti non sono coperti da questa decisione.

## Conseguenze

- `lib/ai-providers/fabric/patient-insight-fidelity.ts` contiene marcatori e
  regole; il validatore del Quadro lo chiama dopo il controllo delle
  citazioni.
- `local-generation-attempts.ts` conosce un terzo motivo di scarto,
  `unfaithful`.
- Il contratto della proposta (`patient-insight-preview-contract.ts`) e il
  trasporto GPUI (`transport/src/local_host/patient_insight.rs`) ammettono
  `proposal_unfaithful`. Un client che non lo conosce tratta la risposta come
  non valida e non mostra alcuna proposta.

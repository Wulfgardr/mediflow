# ADR 0195: La nota del modello entra dopo il gesto del medico

Data: 2026-11-19

Stato: **Proposed**. Decide Leonardo.

## Problema

Nella visita dettata la nota SOAP la scrive il modello cloud. Arriva come
argomento `scheda` dello strumento del plugin `mediflow-ambulatorio`, che ne
controlla solo la forma (quattro righe `S:`, `O:`, `A:`, `P:` e la lunghezza).
Dalla nota il plugin genera anche `nota-visita.pdf`.

Con l'[ADR 0190](0190-mandato-agenti-e-cassetta-della-visita.md) nota,
trascrizione e PDF entravano senza gesto appena la cassetta era chiusa e
senza blocchi. Una frase aggiunta dal modello, per errore o perché un
documento conteneva istruzioni nascoste, finiva così nel diario senza che il
medico l'avesse letta in MediFlow. `SECURITY.md` chiede invece di trattare
l'output del modello come non fidato finché un operatore non lo conferma.

La trascrizione è diversa: è il file del dettato, fissato dal suo hash. I PDF
originali sono copie di documenti con il codice fiscale verificato.

## Decisione

In automatico entra solo ciò che è copia fedele di una fonte, cioè la
trascrizione e i PDF originali. Il testo composto dal modello entra dopo un
gesto del medico su quel testo. Per il medico resta un solo gesto per visita.

1. La nota passa alla fase di revisione insieme alle proposte strutturate.
   Entra con «Applica la visita» in «In arrivo» oppure con la conferma nativa
   avviata dalla chat ([ADR 0191](0191-conferma-da-chat-e-cassetta-senza-finestra.md)),
   in un'unica transazione con l'audit della fase `review`.
2. Il PDF che riproduce la nota segue la nota. Un PDF è considerato tale
   quando il suo testo, letto dal browser sbloccato, contiene per intero il
   testo di una nota della stessa cassetta, a meno di spazi e a capo
   (normalizzazione NFKC e spazi tolti). Così l'intestazione del plugin
   (codice fiscale e data) e l'impaginazione a 88 colonne non cambiano
   l'esito. Non contano il nome del file né la fonte dichiarata dal client,
   che il modello può scegliere. Un originale che riporta solo una frase della
   nota resta automatico.
3. Il server non legge il contenuto delle buste e conosce solo tipo ed hash
   degli elementi. Per questo rifiuta la nota in fase automatica ed ammette la
   trascrizione solo lì, mentre il PDF può stare in entrambe le fasi. La
   revisione deve comprendere tutti gli elementi ancora da applicare, così
   una visita non entra a metà.
4. La conferma nativa mostra la nota intera come campo «Testo», con il PDF
   che la riproduce come fonte e la dicitura «Scritta dal modello». Il digest
   del piano firmato copre il contenuto cifrato della nota. Una cassetta con
   sola nota, trascrizione e PDF, senza proposte, diventa confermabile. Il
   contratto `VisitConfirmationPresentation` ed il componente Swift non
   cambiano: un campo accetta fino a 16.384 byte e la nota del plugin resta
   sotto i 12.000 caratteri. Se la presentazione non si può costruire, la
   conferma non parte e la visita resta in «In arrivo».
5. Le cassette depositate prima restano come sono: se la nota è già entrata,
   si completano le sole proposte. Quelle non ancora applicate seguono la
   regola nuova. Nessuna migrazione e nessuna riga cancellata. Una cassetta
   cloud senza consenso ([ADR 0193](0193-egress-clinico-controllato-dal-server.md))
   ha ancora tutto in revisione.
6. L'esito del deposito restituito alla chat elenca la nota fra gli elementi
   che attendono il medico. Le istruzioni del plugin non dicono più che la
   nota è già in cartella.

## Alternative scartate

- Riconoscere il PDF dal nome `nota-visita.pdf` o da un'etichetta del client:
  il nome lo sceglie chi deposita.
- Usare l'unico fatto `document_entry` del PDF: è un dato dell'estrazione
  preparata, che non arriva in MediFlow insieme alle buste.
- Confrontare la nota con il dettato e far entrare in automatico le note
  coerenti: un confronto di testo libero non distingue una frase clinica
  aggiunta da una riformulazione.

## Limite che resta

Un modello che fabbrica un documento e lo presenta come originale non è
coperto da questa regola: se il PDF porta il codice fiscale giusto e non
riproduce la nota, entra in automatico come copia. Lo limitano oggi la
selezione dei PDF per finestra temporale e codice fiscale nel plugin e la
possibilità di aprire l'originale in «In arrivo», non una verifica di
MediFlow.

## Prove

Le prove stanno in `lib/agent-incoming.test.ts` (fase automatica,
riconoscimento del PDF, «Applica la visita», conferma nativa, cassette
applicate con la regola precedente), in `lib/agent-visit-application.test.ts`
per il confine del server ed in `e2e/agent-auto-apply.spec.ts`. Il modello
formale in `docs/formal/agent-visit-confirmation/` non distingue gli elementi
automatici e non cambia.

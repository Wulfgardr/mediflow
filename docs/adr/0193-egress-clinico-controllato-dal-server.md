# ADR 0193: Egress clinico controllato dal server

Data: 2026-11-19

Stato: **Accettato** da Leonardo il 19/11/2026.

## Problema

Il mandato di un agente dichiara il fornitore del modello (`openai`,
`anthropic` o `local`) e se il medico ha consentito l'uscita di dati clinici
verso quel fornitore (`allowsClinicalEgress`). Il contratto vieta solo un
mandato `local` con egress vero, quindi un mandato cloud senza consenso è
valido.

Fino ad oggi il rifiuto stava solo nel client: `packages/agent-client`
non deposita se il fornitore non è `openai` o se manca il consenso.
Un client diverso o modificato, con lo stesso mandato, poteva aprire la
visita, depositare nota, trascrizione e PDF, chiuderla e chiedere la
conferma. L'audit registrava poi `egress:denied` su un contenuto che il
modello cloud aveva per forza già letto.

Il server non sa dove sia stato elaborato il testo. Può però rifiutare
ciò che contraddice la dichiarazione del mandato.

## Regola

1. Un mandato con fornitore diverso da `local` ed `allowsClinicalEgress`
   falso riceve 403 su ogni operazione che porta o applica contenuto
   clinico: apertura, deposito di ogni elemento, chiusura, avvio e lettura
   della conferma. Dopo il rifiuto l'archivio non cambia.
2. Il rifiuto sta in `withAuthenticatedAgentTransaction`, da cui passano
   tutte le operazioni del canale, così una rotta nuova lo eredita.
   `check:never-regress` segnala una rotta di `app/api/agent/v1` che esegue
   un'operazione fuori da quel punto o con operazione nulla. È un vincolo
   sul testo di un confine, ammesso dall'[ADR 0184](0184-prove-sul-comportamento-e-vincoli-sul-testo.md).
3. Contesto del mandato e ritiro della credenziale restano leggibili, perché
   servono al client per spiegare il rifiuto, e non restituiscono contenuto
   clinico.
4. Una cassetta già depositata da un mandato cloud senza egress non entra
   più in automatico. Il server rifiuta la fase automatica e la cassetta
   resta in «In arrivo». Il medico la rilegge e la applica intera con la
   fase di revisione, con l'audit di oggi. Nessuna migrazione e nessuna
   riga cancellata.

Questo controllo riguarda il consenso nel mandato. Per i mandati locali e
quelli cloud con consenso, il successivo
[ADR 0195](0195-materiale-dell-agente-dopo-il-gesto-del-medico.md) regola
l’ingresso dei contenuti in cartella. Nota, trascrizione, PDF e proposte
restano in «In arrivo» fino alla revisione del medico.

## Cosa resta fuori

- La prova che il testo sia davvero rimasto in locale: il server verifica
  la coerenza con la dichiarazione, non l'elaborazione.
- Il controllo lato client, che resta com'è.
- L'avviso nelle impostazioni per chi crea un mandato cloud senza consenso.
- Il rimescolatore ed il confine di uscita dei dati verso i fornitori.

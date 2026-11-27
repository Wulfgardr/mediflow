# ADR 0195: Il materiale dell'agente entra dopo il gesto del medico

Data: 2026-11-19

Stato: **Accettato** da Leonardo il 19/11/2026 («Sì, profilo pseudonimizzato e
revisione dei contenuti senza fonte verificata»). Riferimenti: WUL-903,
[ADR 0190](0190-mandato-agenti-e-cassetta-della-visita.md),
[ADR 0191](0191-conferma-da-chat-e-cassetta-senza-finestra.md),
[ADR 0193](0193-egress-clinico-controllato-dal-server.md).

## Problema

Con l'ADR 0190 nota, trascrizione e PDF di una cassetta chiusa entravano in
cartella senza gesto, appena l'identità del paziente risultava verificata.
Tutto questo materiale arriva però dal client agente:

- la nota SOAP la scrive il modello, che può aggiungere una frase per errore o
  perché un documento conteneva istruzioni nascoste;
- la trascrizione e i PDF li sceglie e li nomina il plugin per conto
  dell'agente. Il tipo dell'elemento, il nome del file e la fonte dichiarata
  sono etichette del client, non prove di provenienza.

MediFlow non ha oggi una prova che un PDF o una trascrizione siano stati
acquisiti in modo indipendente dall'agente, per esempio da uno scanner o da un
servizio regionale. `SECURITY.md` chiede di trattare l'output del modello come
non fidato finché un operatore non lo conferma.

La versione proposta di questo ADR spostava in revisione solo la nota ed il PDF
che ne riproduce il testo. Leonardo ha approvato invece la regola più stretta
che segue.

## Decisione

1. Nessun elemento di una cassetta entra in cartella senza il gesto del
   medico, qualunque siano tipo, nome o fonte dichiarata. Nota, trascrizione,
   PDF e proposte strutturate stanno in un'unica revisione. Un'eccezione
   richiederà una prova di acquisizione indipendente da MediFlow ed un nuovo
   ADR. Un'etichetta del client non basta.
2. Sul Web, «In arrivo» mostra la nota, la trascrizione e le proposte ed apre
   ogni PDF nel visore. «Applica la visita» o «Applica tutte le visite senza
   dubbi» scrivono tutti gli elementi ancora da applicare in una transazione,
   con l'audit della fase `review`.
3. La conferma nativa avviata dalla chat
   ([ADR 0191](0191-conferma-da-chat-e-cassetta-senza-finestra.md)) mostra per
   intero ciò che si approva: il testo della nota («Scritta dal modello»),
   quello della trascrizione («Depositata dall'agente») e, per ogni PDF, il nome
   del file, il testo letto dal browser sbloccato ed il suo hash («Depositato
   dall'agente»). Il digest della presentazione entra nella sfida firmata come
   prima. Se un elemento non si può mostrare per intero, la conferma non parte
   e la visita resta in «In arrivo» per la revisione Web. Succede con un PDF
   che disegna qualcosa oltre al testo (immagini, tracciati, campi o
   annotazioni), con un testo oltre i 16.384 byte di un campo del riquadro, con
   caratteri che il riquadro rifiuta. Il contratto
   `VisitConfirmationPresentation` ed il componente Swift non cambiano.
4. Il server conosce solo tipo ed hash degli elementi. Accetta soltanto la fase
   `review` e solo se comprende tutti gli elementi ancora da applicare: una
   richiesta `automatic`, anche ripetuta da una scheda aperta prima
   dell'aggiornamento, ed una revisione parziale sono rifiutate senza scrivere
   nulla. Il rifiuto o la scadenza della conferma nativa, oppure un «Applica»
   mai premuto, non scrivono dati clinici.
5. Le cassette depositate prima restano come sono. Gli elementi già entrati con
   la regola precedente non si ripetono: la revisione comprende solo quelli
   rimasti. Le ricevute già scritte valgono ancora per la ripetizione della
   stessa revisione. Nessuna migrazione e nessuna riga cancellata.
6. Una cassetta cloud senza consenso
   ([ADR 0193](0193-egress-clinico-controllato-dal-server.md)) si applica solo
   dal Web, come prima.
7. Le istruzioni del plugin e le descrizioni degli strumenti MCP dicono che
   nota, trascrizione, PDF e proposte attendono la conferma del medico.

8. Sul Web il medico conferma il codice fiscale, il nome e il cognome
   quando la visita crea una scheda. Ogni PDF deve riportare come unico
   codice fiscale del paziente quello confermato. I codici di ruolo
   professionale documentato restano esclusi. Si può applicare una nota o
   una trascrizione anche senza PDF. Il commit ricontrolla ambulatorio e
   duplicati e scrive scheda, appartenenza, elementi e audit nella stessa
   transazione. La data di nascita viene registrata quando una fonte
   esplicita il secolo ed è coerente con il codice fiscale. La conferma
   nativa richiede una scheda esistente.

## Alternative scartate

- Riconoscere il PDF della nota dal testo e lasciare automatici trascrizione e
  altri PDF (versione proposta): trascrizione e PDF entravano senza una prova di
  provenienza, sulla base di etichette del client.
- Riconoscere il materiale dal nome del file o dal tipo: li sceglie chi
  deposita.
- Mostrare nel riquadro nativo solo nome ed hash del PDF: il medico
  confermerebbe un contenuto che non vede.

## Conseguenze

Ogni visita richiede il gesto del medico, anche quando contiene solo un
referto. Un PDF ospedaliero con logo, firma grafica o tabelle disegnate non
passa dal riquadro nativo e si rivede sul Web.

## Limiti che restano

- Il riquadro nativo mostra lo strato di testo del PDF, non il suo aspetto.
  Se un font rimappa i glifi, il testo mostrato può differire da quello
  disegnato. Il visore Web mostra la pagina com'è.
- La revisione sposta la responsabilità sul medico che legge, non verifica la
  provenienza del materiale.

## Prove

`lib/agent-incoming.test.ts` (nessuna scrittura prima del gesto, materiale
senza nota, conferma nativa con tutti gli elementi, rinvio al Web, cassette
applicate con la regola precedente), `lib/agent-visit-application.test.ts`
(confine del server, fase `automatic` e revisione parziale rifiutate),
`lib/agent-visit-pdf-content.test.ts` (riconoscimento con pdf.js di ciò che un
PDF disegna oltre al testo, PDF della nota del plugin solo testo) ed
`e2e/agent-auto-apply.spec.ts`. Il modello formale in
`docs/formal/agent-visit-confirmation/` non distingue gli elementi e non
cambia.

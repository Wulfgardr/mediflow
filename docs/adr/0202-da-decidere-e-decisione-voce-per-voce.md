# ADR 0202: «Da decidere» e decisione voce per voce di una visita

Data: 2026-11-25

Stato: **Accettato** da Leonardo il 25/11/2026 (voce `da-decidere` della pagina
«Decisioni del 25 novembre»: «si fa subito»). Riferimenti: WUL-960, WUL-952,
[ADR 0190](0190-mandato-agenti-e-cassetta-della-visita.md),
[ADR 0191](0191-conferma-da-chat-e-cassetta-senza-finestra.md),
[ADR 0195](0195-materiale-dell-agente-dopo-il-gesto-del-medico.md),
ADR 0175 e 0176 (Dossier da cartella ed estrazione preparata).

## Problema

Ciò che aspetta una decisione del medico sta in code separate: le visite in
«In arrivo», che si applicano solo per intero (ADR 0195, punto 4), e le
proposte dai documenti nella revisione Dossier, che si decidono una per una.
Una visita con una sola voce dubbia (una dose, una ricetta che non vale, un
farmaco di un familiare) resta ferma, oppure si applica tutta. Leonardo ha
chiesto una pagina sola, con la fonte accanto alla voce, e la decisione voce
per voce anche per le visite.

## Decisione

1. **Una pagina, nessun dato proprio.** «Da decidere» (`/da-decidere`) legge
   le code che esistono già e scrive solo attraverso gli scrittori che hanno
   già audit e prove. Il filtro «Visite» è «In arrivo»; il filtro «Documenti»
   è la revisione Dossier (ADR 0175 e 0176), con lo stesso componente.
   `/in-arrivo` porta al filtro «Visite»; `/patients/import/dossier` resta
   dov'è. Le domande sul significato delle locuzioni avranno un loro filtro
   quando esisteranno.
2. **La visita intera non cambia.** «Applica la visita», «Applica tutte le
   visite senza dubbi» e la conferma nativa con Touch ID (ADR 0191) scrivono
   in una transazione tutte le voci ancora da decidere, come prima.
   Quando occorre una scheda nuova, il medico conferma e può correggere
   codice fiscale, nome e cognome nella singola visita. La scheda e le voci
   entrano nella stessa transazione. Il client propone i nomi nell’àncora
   cifrata quando l’estrazione li indica senza valori discordanti. Il medico
   può compilare anche una visita depositata con il solo codice fiscale. Il punto 4
   dell'ADR 0195 resta vero per quel percorso: una richiesta che non comprende
   tutte le voci ancora da decidere è rifiutata.
3. **Decisione voce per voce, su un percorso distinto.** Una voce di una
   visita in arrivo si decide con un gesto: **Tieni**, **Correggi**, **Scarta**.
   Il server riceve una sola voce per richiesta (`decideAgentVisitItem`) e la
   scrive con lo stesso scrittore della visita intera, nella stessa
   transazione dell'audit.
4. **Scarta scrive solo l'audit.** L'evento `agent.item.discarded` registra
   chi e quando, senza dati clinici e senza toccare la versione della scheda.
   Una voce scartata non rientra più fra quelle da decidere, neanche per la
   visita intera.
5. **Correggi è Tieni con il valore del medico.** I campi corretti passano
   dallo stesso scrittore; l'audit porta il segno `corrected` e la provenienza
   sigillata porta passaggio e file della fonte con `corrected: true`.
6. **Una correzione non perde nulla in silenzio.** Se Correggi cambia il
   farmaco o il principio attivo di una terapia, i codici AIC e ATC depositati
   non entrano in scheda: valevano per il farmaco proposto. Il modulo lo dice
   solo in quel caso. Se cambia solo dose, posologia, stato o date, i codici
   restano. Una diagnosi o un'esenzione già in scheda (stesso codice e
   sistema, oppure stessa descrizione senza codice) non si tiene e non si
   corregge restando uguale: la decisione viene rifiutata, la voce mostra «Già
   in scheda» e il medico la scarta o modifica la voce dalla scheda. Una
   correzione che cambia il codice entra come diagnosi nuova. La visita
   intera non cambia: la voce mostra già «In scheda: …» prima di applicare.
7. **Solo su una scheda esistente.** La decisione voce per voce vale quando la
   visita ha una scheda attiva riconosciuta. Una visita che crea la scheda
   (prima visita) si applica ancora per intero.
8. **La conferma con Touch ID non parte** su una visita già decisa in parte:
   la si finisce dal Web. Il percorso nativo (`lib/agent-visit-confirmation*`,
   `native/AgentVisitConfirmation/`) non cambia.

### Stati di una voce

| Stato | Da dove | Effetto | Audit |
| --- | --- | --- | --- |
| da decidere | deposito della cassetta | nessuno | `agent.item.deposited` |
| tenuta | Tieni, oppure visita intera | scritta in scheda con la fonte | scrittore + `agent.item.applied` |
| corretta | Correggi | scritta con il valore del medico | scrittore + `agent.item.applied` con `corrected` |
| scartata | Scarta | nessun dato clinico | `agent.item.discarded` |

Gli stati tenuta, corretta e scartata sono finali.

### Stati di una visita

| Stato | Condizione | Dove si vede |
| --- | --- | --- |
| in attesa | nessuna voce decisa | «Visite» |
| decisa in parte | almeno una voce decisa, almeno una da decidere | «Visite», con le voci decise segnate |
| applicata | ogni voce tenuta o corretta | esce dalla coda; `agent.visit.applied` con `cassette_complete` |
| decisa | ogni voce decisa, almeno una scartata | esce dalla coda; `agent.visit.decided`, **mai** `cassette_complete` |

### Che cosa controlla il server a ogni gesto

Nella stessa transazione `immediate`, prima di scrivere:

- sessione Web dell'amministratore, generazione dell'archivio della cassetta,
  chiusura auditata sotto un mandato autorizzato al deposito e operazioni
  comprese nel perimetro originario. Dopo la chiusura, scadenza e revoca
  del mandato lasciano disponibile la revisione Web. La revoca della
  registrazione o del client blocca la visita. I mandati non distinguono
  una revoca per compromissione da una revoca ordinaria. La conferma
  nativa continua a richiedere il mandato attivo oltre alla prova del gesto;
- cassetta chiusa e alla revisione vista dal medico;
- voce depositata in quella cassetta, con lo stesso tipo, e ancora da
  decidere;
- per Tieni e Correggi: scheda attiva alla versione vista dal medico, e nessuna
  scrittura precedente della stessa visita su un'altra scheda.

Una richiesta identica già eseguita restituisce la stessa ricevuta senza
scrivere. Ogni altra richiesta su una voce già decisa è rifiutata senza
scrivere.

## Invarianti

Il modello `docs/formal/agent-item-decision/ItemDecision.tla` le controlla con
TLC, con richieste duplicate, ritardate e concorrenti, visita intera inclusa:

- `OnceWritten`: nessuna voce si scrive due volte;
- `DiscardWritesNothing`: una voce scartata non ha scritture;
- `EveryWriteAudited` ed `EveryDiscardAudited`: ogni gesto lascia il suo
  audit;
- `OneRecipient`: le voci di una visita finiscono in una sola scheda;
- `AppliedMeansAllKept`: una visita risulta applicata solo se ogni voce è
  stata tenuta o corretta;
- `DeniedChangesNothing`: una richiesta priva di autorità di revisione
  non cambia dati. Nel modello, scadenza e revoca rappresentano la
  perdita di tale autorità, per esempio alla scadenza della sessione o
  alla revoca dell’agente.

Togliere a turno ciascuna delle quattro guardie del server viola la regola
corrispondente. Le prove sul codice stanno in
`lib/agent-visit-item-decision.test.ts`.

## Limiti

- I due controlli del punto 6 stanno nel browser che prepara la scrittura, come
  la verifica dell'identità: il server riceve valori cifrati. Le prove sono in
  `lib/agent-visit-item-review.test.ts` e nella spec `e2e/da-decidere.spec.ts`.

- La prima scrittura di una visita va alla scheda che il medico ha davanti. Il
  server non legge il codice fiscale cifrato della cassetta: l'identità resta
  verificata nel browser sbloccato, come per la visita intera (ADR 0190). Il
  server impedisce che le voci successive della stessa visita vadano su una
  scheda diversa.
- Si può applicare una nota o una trascrizione anche senza PDF. Quando
  ci sono PDF, il browser verifica il codice fiscale confermato in ciascuno.
  Per le proposte strutturate valgono ancora i controlli sulla fonte e il
  riscontro con il PDF citato.
- Una voce scartata non si riprende dall'interfaccia. Se serve, il medico la
  inserisce a mano nella scheda; il deposito resta nella cassetta.
- Una ripetizione con un corpo diverso (per esempio una nuova cifratura dello
  stesso valore) riceve un rifiuto, non la ricevuta: la pagina rilegge la
  cassetta e mostra la voce come decisa.

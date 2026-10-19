# ADR 0148 — Revisione monouso delle note, senza scrittura

Data: 2026-10-19. Stato: Proposed; accettazione con review e merge.
Riferimenti: WUL-584, ADR 0098, ADR 0146, ADR 0147.

## Decisione

La verticale delle note aggiunge una prova di revisione del comando canonico.
L'esito è esclusivamente `reviewed`, con `writesPerformed: 0`: nessun writer,
provider o transazione clinica viene invocato. Questa prova non costituisce
un'autorizzazione a modificare la cartella e non è accettata dal dispatch di
produzione. WUL-577/585 richiedono un contratto separato prima di collegare una
conferma al writer esistente.

Si riusano l'owner Web di sessione e selezione, l'attestazione
`physician_terminal_review` e la verifica del PIN fresco. Il nuovo consumer
dell'ADR 0098 è una decisione terminale di sola revisione, conservata in memoria:
non amplia la capability a scritture cliniche. Il ruolo descrittivo dell'account,
il pairing, un token locale e un campo `confirmed` non sono fonti di autorità.
Le attestazioni e le proof specifiche F10/SOAP non vengono convertite.

Il comando viene normalizzato una volta dall'host, con le primitive del profilo.
Autore, operazione/versione, scopo, percorso, ambito effettivo, revisione,
selection epoch, generazioni di sessione/revoca, policy e scadenza vengono legati
alla medesima revisione. La chiave di esecuzione nasce nell'host. Una nuova
preparazione ritira la revisione precedente, anche se il testo torna uguale.

## Presentazione e cifratura

Il client prepara una sola volta le note con la cifratura esistente. La vista
da rivedere contiene i byte cifrati del comando conservato dall'host: il client
decifra proprio quelli e non mostra una copia distinta della bozza. Nessuna
ricifratura avviene dopo il gesto. L'impronta identifica il comando e i suoi
byte cifrati, non un plaintext osservato dal server. Chiavi e plaintext restano
nel client. Null esplicito, stringa vuota e impossibilità di decifrare rimangono
esiti distinti; una presentazione non leggibile non può essere confermata.

La conferma presenta soltanto riferimento e impronta attesi più il PIN, senza
un nuovo payload, ruolo, scopo, paziente o proof. Il riferimento serve a
confrontare la revisione corrente posseduta dall'host; non seleziona una nuova
revisione. Dopo tutte le attese si ricontrollano attestazione, sessione e
selezione. Il consumo della proof è sincrono, monouso e terminale anche al
diniego. La meccanica degli oggetti opachi viene condivisa con F10, mentre
policy, scadenze e binding restano nei rispettivi owner.

## Confini e verifica

La porta è Web-only e dry-run. Non espone conferme via MCP, Mini, local-v1 o
paired e non cambia l'ordinario salvataggio. Il candidato UI deve dichiarare
chiaramente la prova senza salvataggio. Ogni cambio materiale, ritorno ad una
selezione precedente, lock, revoca, scadenza o riavvio ritira la revisione.
Un PIN iniziato sul vecchio contesto non può completare la nuova revisione.

Prima del merge: flusso sintetico attraverso gli owner reali; alterazioni e
invalidazioni; doppio consumo e revoca durante il PIN; decifratura e ritiro
della presentazione; confronto di record/audit prima e dopo. Riutilizzare i
test F10 dell'estrazione e i gate pertinenti. Una prova con stubs non sostituisce
questa composizione. Nessun nuovo schema, migrazione, enrollment o storage
delle proof. La reversione elimina esclusivamente stato volatile e porta di
prova.

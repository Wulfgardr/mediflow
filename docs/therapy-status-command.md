# Comando stato terapia Web

`therapy.status.change.v1` è il percorso di conferma di TherapyManager (ADR0168).
È riservato alla projection Web admin fisicamente corrente e al medico ammesso
alla risorsa dal writer host. Token locale, paired/native, MCP e chat sono negati.
Non è un endpoint generico di aggiornamento della terapia.

| Porta | Input | Risposta |
| --- | --- | --- |
| POST `/api/therapy-status-commands/{commandId}/execute` | Binding + `target` canonico active/suspended/completed | Terminale applied/rejected/closed; nessun retry automatico |
| GET `/api/therapy-status-commands/{commandId}/receipt` | Binding nei query params | Terminale con `historical`, oppure unknown |
| POST `/api/therapy-status-commands/{commandId}/close` | Binding senza target | Terminale esistente dello stesso owner/binding o nuovo closed con target NULL |

Binding: commandId UUIDv4 casuale, protocollo, archiveGeneration UUIDv4,
patientId/therapyId opachi (1–256 caratteri), expectedVersion intera positiva.
Path e body devono avere lo stesso ID. Actor, date, endDate, versioni risultanti
e audit non sono input. Body massimo4096byte, campi extra e target in close
negati. Autenticazione e generation correnti restano necessarie; ID non è bearer.
Il browser usa same-origin e il fence di generazione del documento.

Le risposte sono no-store. La receipt espone binding, actorRef, target (NULL su
closed), outcome, reason (version_conflict su rejected), committedAt in secondi,
resultVersion/resultEndDate e auditEventId (NULL senza effetto). Lo snapshot
audit completo resta nel ledger host. Un owner diverso non riceve receipt.
4xx/5xx e assenza di risposta non sono una receipt. Unknown non prova assenza
di commit e non riabilita un invio.

Close non richiede CAS corrente; mantiene ammissione alla risorsa e binding
originale. Se execute ha commesso, close restituisce applied. Se close vince,
tutti i target tardivi sullo stesso ID sono negati. Il marker browser mantiene
solo il binding nonclinico e resta su errore, abort o reload. Dopo terminale
verificato e rilettura il nuovo gesto richiede nuovo ID e conferma.

I record uniti dopo restore restano storici nella generation originale: non
riapplicano effetti e non attestano lo stato corrente. La lettura host consente
al proprietario autenticato una receipt storica anche senza righe cliniche
ripristinate; execute/close vecchi non attraversano una nuova generation.
Questa tranche non aggiunge un esploratore Web delle receipt storiche né una
nuova autorità chat. Il marker legacy ADR0156 resta separato e blocca il nuovo
percorso finché il recupero legacy non lo risolve.

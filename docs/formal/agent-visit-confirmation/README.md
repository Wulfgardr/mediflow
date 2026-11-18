# Conferma nativa di una visita

Il modello considera due consumatori concorrenti della stessa prova, con un
massimo di due tentativi di commit e due cambiamenti del contesto clinico.
`revision` accorpa la revisione della cassetta, il digest del piano, la
generazione dell'archivio e lo stato della scheda. Un cambiamento rispetto al
piano mostrato deve impedire il commit. Annullamento, scadenza, revoca e perdita
del peer ritirano la richiesta. Il modello conta le scritture, l'audit e la
ricevuta come effetti della stessa transazione.

| Passaggio | Codice |
| --- | --- |
| Preparazione e ritiro | `prepareVisitConfirmation` e `retire`, in `lib/agent-visit-confirmation.ts` |
| Valutazione macOS o ripiego | `VisitAuthentication.confirm`, in `native/AgentVisitConfirmation/Authentication.swift` |
| Firma | `AgentVisitConfirmationHelper.confirmVisit`, in `native/AgentVisitConfirmation/Helper.swift` |
| Confronto del piano, ammissione e consumo | `commitAgentVisit`, in `lib/agent-visit-application.ts` |

`OnlyApproved` richiede un gesto per ogni commit. `BoundCommit` controlla la
corrispondenza al piano e la validità al momento del commit. `OnceAndAtomic`
controlla applicazione unica, audit e ricevuta. Per provare la raggiungibilità
si aggiunge `Reachable` come invariante da falsificare. Disattivare a turno
`CheckBinding` e `CheckConsumption` deve violare rispettivamente
`BoundCommit` e `OnceAndAtomic`. Il test del writer
`native approval commits and audits exactly one plan` controlla le due
negazioni sul codice. Il modello assume che il componente firmato produca una
firma solo dopo l'esito del sistema. Toccare il sensore, usare il Watch,
inserire la password e osservare il peer reale richiedono prove sul Mac.

Con TLC 1.7.4 (binario 2.19), dalla cartella del modello:

```sh
java -cp "$TLA_JAR" tlc2.TLC -config MC.cfg VisitConfirmation.tla
```


Il 18/11/2026 TLC ha esplorato 45 stati distinti. La cancellazione di ciascuna
guardia ha prodotto la violazione attesa. Falsificare `Reachable` ha mostrato
una sequenza con un commit riuscito.

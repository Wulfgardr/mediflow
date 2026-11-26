# Decisione voce per voce di una visita

Il modello descrive le voci di una cassetta chiusa, due schede possibili e fino
a tre richieste in volo, che il server può ricevere più volte, in ritardo e in
qualunque ordine: Tieni, Correggi e Scarta su una voce
(`decideAgentVisitItem`) e l'applicazione della visita intera
(`applyAgentVisit`), che si porta l'insieme delle voci viste dal medico. La
revoca del mandato o la scadenza della sessione chiudono l'ammissione. Ogni
consegna è una transazione `immediate` di SQLite, per questo nel modello è un
passo solo.

| Passaggio | Codice |
| --- | --- |
| Ammissione (sessione, archivio, mandato, client, operazione) | `admittedCassette`, `admittedClient` in `lib/agent-visit-application.ts` |
| Voce ancora da decidere, ripetizione con ricevuta | `decideAgentVisitItem`, ricerca di `agent.item.applied` e `agent.item.discarded` |
| Una sola scheda per visita | `visitRecipients` in `decideAgentVisitItem` e `commitAgentVisit` |
| Chiusura applicata o decisa | `visitDecisionState`, `closeDecidedVisit` |
| Visita intera solo sulle voci ancora da decidere | `commitAgentVisit`, insieme `pending` |

Le guardie sono costanti del modello. Con TLC 1.7.4, dalla cartella del modello:

```sh
java -cp "$TLA_JAR" tlc2.TLC -config MC.cfg ItemDecision.tla
```

Il 25/11/2026 TLC ha esplorato 5.516 stati distinti senza violazioni.
Mettendo a `FALSE` una guardia per volta:

| Guardia tolta | Regola violata |
| --- | --- |
| `CheckPending` | `OnceWritten` |
| `CheckAdmission` | `DeniedChangesNothing` |
| `CheckRecipient` | `OneRecipient` |
| `CheckComplete` | `AppliedMeansAllKept` |

Falsificare `ReachPartial` ha mostrato una visita chiusa come decisa con una
voce tenuta e una scartata, quindi lo stato è raggiungibile.

Le stesse mutazioni sul codice fanno fallire le prove di
`lib/agent-visit-item-decision.test.ts`: senza la ricerca della decisione
precedente cade la prova della richiesta ripetuta, senza il controllo della
scheda quella della seconda scheda, senza l'ammissione quella delle richieste
negate, senza la distinzione fra applicata e decisa le due prove della visita
decisa in parte, e senza le voci scartate fuori dall'insieme `pending` la prova
di «Applica la visita» dopo uno scarto.

Il modello non descrive l'identità della prima scheda: il server non legge il
codice fiscale cifrato e la verifica resta nel browser sbloccato (ADR 0190).

---------------------------- MODULE ItemDecision ----------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS Items, Patients, MaxInFlight, CheckPending, CheckAdmission, CheckRecipient, CheckComplete

Gestures == {"keep", "correct", "discard"}
Kept == {"kept", "corrected"}
Outcome == [keep |-> "kept", correct |-> "corrected", discard |-> "discarded"]

VARIABLES state, writes, writtenTo, audited, mark, admitted, inflight

vars == <<state, writes, writtenTo, audited, mark, admitted, inflight>>

ItemRequests == [kind : {"item"}, item : Items, gesture : Gestures, patient : Patients]
VisitRequests == [kind : {"visit"}, items : SUBSET Items, patient : Patients]

Pending == {i \in Items : state[i] = "pending"}
Recipients == UNION {writtenTo[i] : i \in Items}

Init ==
    /\ state = [i \in Items |-> "pending"]
    /\ writes = [i \in Items |-> 0]
    /\ writtenTo = [i \in Items |-> {}]
    /\ audited = [i \in Items |-> "none"]
    /\ mark = "none"
    /\ admitted = TRUE
    /\ inflight = {}

SendItem(i, g, p) ==
    /\ Cardinality(inflight) < MaxInFlight
    /\ inflight' = inflight \cup {[kind |-> "item", item |-> i, gesture |-> g, patient |-> p]}
    /\ UNCHANGED <<state, writes, writtenTo, audited, mark, admitted>>

SendVisit(p) ==
    /\ Cardinality(inflight) < MaxInFlight
    /\ Pending # {}
    /\ inflight' = inflight \cup {[kind |-> "visit", items |-> Pending, patient |-> p]}
    /\ UNCHANGED <<state, writes, writtenTo, audited, mark, admitted>>

Revoke ==
    /\ admitted
    /\ admitted' = FALSE
    /\ UNCHANGED <<state, writes, writtenTo, audited, mark, inflight>>

RecipientAllowed(p) == ~CheckRecipient \/ Recipients \subseteq {p}

Closing(newState) ==
    IF \A i \in Items : newState[i] # "pending"
    THEN IF ~CheckComplete \/ \A i \in Items : newState[i] \in Kept THEN "applied" ELSE "decided"
    ELSE mark

DeliverItem(r) ==
    /\ r \in inflight
    /\ r.kind = "item"
    /\ IF (~CheckAdmission \/ admitted)
          /\ (~CheckPending \/ state[r.item] = "pending")
          /\ (r.gesture = "discard" \/ RecipientAllowed(r.patient))
       THEN LET next == [state EXCEPT ![r.item] = Outcome[r.gesture]] IN
            /\ state' = next
            /\ audited' = [audited EXCEPT ![r.item] = Outcome[r.gesture]]
            /\ IF r.gesture = "discard"
               THEN UNCHANGED <<writes, writtenTo>>
               ELSE /\ writes' = [writes EXCEPT ![r.item] = @ + 1]
                    /\ writtenTo' = [writtenTo EXCEPT ![r.item] = @ \cup {r.patient}]
            /\ mark' = Closing(next)
       ELSE UNCHANGED <<state, writes, writtenTo, audited, mark>>
    /\ UNCHANGED <<admitted, inflight>>

DeliverVisit(r) ==
    /\ r \in inflight
    /\ r.kind = "visit"
    /\ IF (~CheckAdmission \/ admitted)
          /\ (~CheckPending \/ r.items = Pending)
          /\ r.items # {}
          /\ RecipientAllowed(r.patient)
       THEN LET next == [i \in Items |-> IF i \in r.items THEN "kept" ELSE state[i]] IN
            /\ state' = next
            /\ audited' = [i \in Items |-> IF i \in r.items THEN "kept" ELSE audited[i]]
            /\ writes' = [i \in Items |-> IF i \in r.items THEN writes[i] + 1 ELSE writes[i]]
            /\ writtenTo' = [i \in Items |-> IF i \in r.items THEN writtenTo[i] \cup {r.patient} ELSE writtenTo[i]]
            /\ mark' = Closing(next)
       ELSE UNCHANGED <<state, writes, writtenTo, audited, mark>>
    /\ UNCHANGED <<admitted, inflight>>

Next ==
    \/ \E i \in Items, g \in Gestures, p \in Patients : SendItem(i, g, p)
    \/ \E p \in Patients : SendVisit(p)
    \/ Revoke
    \/ \E r \in inflight : DeliverItem(r) \/ DeliverVisit(r)

Spec == Init /\ [][Next]_vars

OnceWritten == \A i \in Items : writes[i] <= 1
DiscardWritesNothing == \A i \in Items : state[i] = "discarded" => writes[i] = 0
EveryWriteAudited == \A i \in Items : writes[i] = 1 => audited[i] \in Kept
EveryDiscardAudited == \A i \in Items : state[i] = "discarded" => audited[i] = "discarded"
OneRecipient == Cardinality(Recipients) <= 1
AppliedMeansAllKept == mark = "applied" => \A i \in Items : state[i] \in Kept

DeniedChangesNothing ==
    [][~admitted => (state' = state /\ writes' = writes)]_vars

ReachPartial == ~(mark = "decided" /\ \E i \in Items : state[i] \in Kept)
=============================================================================

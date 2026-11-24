---- MODULE AmbulatoryDestructiveFlow ----
EXTENDS Naturals

CONSTANTS CheckFlowWebIdOnly, SkipControlLockOnPrune
VARIABLES control, flowState, expired, webIdRecorded, retiredViaService, prunedPendingLogin

vars == <<control, flowState, expired, webIdRecorded, retiredViaService, prunedPendingLogin>>

Init ==
    /\ control = "idle"
    /\ flowState = "present"
    /\ expired = FALSE
    /\ webIdRecorded = FALSE
    /\ retiredViaService = FALSE
    /\ prunedPendingLogin = FALSE

BeginLogin ==
    /\ control = "idle"
    /\ control' = "login_pending"
    /\ UNCHANGED <<flowState, expired, webIdRecorded, retiredViaService, prunedPendingLogin>>

IssueSession ==
    /\ control = "login_pending"
    /\ control' = "active"
    /\ UNCHANGED <<flowState, expired, webIdRecorded, retiredViaService, prunedPendingLogin>>

RecordWebId ==
    /\ flowState = "present"
    /\ control = "active"
    /\ ~expired
    /\ ~webIdRecorded
    /\ webIdRecorded' = TRUE
    /\ UNCHANGED <<control, flowState, expired, retiredViaService, prunedPendingLogin>>

Expire ==
    /\ flowState = "present"
    /\ ~expired
    /\ expired' = TRUE
    /\ UNCHANGED <<control, flowState, webIdRecorded, retiredViaService, prunedPendingLogin>>

PruneExpired ==
    /\ flowState = "present"
    /\ expired
    /\ IF CheckFlowWebIdOnly THEN
           /\ ~(webIdRecorded /\ control = "active")
           /\ flowState' = "pruned"
           /\ prunedPendingLogin' = (prunedPendingLogin \/ control = "login_pending")
           /\ UNCHANGED <<control, expired, webIdRecorded, retiredViaService>>
       ELSE IF SkipControlLockOnPrune THEN
           /\ control # "active"
           /\ flowState' = "pruned"
           /\ prunedPendingLogin' = (prunedPendingLogin \/ control = "login_pending")
           /\ UNCHANGED <<control, expired, webIdRecorded, retiredViaService>>
       ELSE
           /\ control \in {"idle", "login_pending"}
           /\ control' = "locked"
           /\ flowState' = "pruned"
           /\ prunedPendingLogin' = (prunedPendingLogin \/ control = "login_pending")
           /\ UNCHANGED <<expired, webIdRecorded, retiredViaService>>

Retire ==
    /\ flowState = "present"
    /\ control = "active"
    /\ control' = "locked"
    /\ flowState' = "pruned"
    /\ retiredViaService' = TRUE
    /\ UNCHANGED <<expired, webIdRecorded, prunedPendingLogin>>

Terminal ==
    /\ flowState = "pruned"
    /\ control = "locked"
    /\ UNCHANGED vars

Next ==
    \/ BeginLogin
    \/ IssueSession
    \/ RecordWebId
    \/ Expire
    \/ PruneExpired
    \/ Retire
    \/ Terminal

Spec == Init /\ [][Next]_vars

NoOrphanedActiveSession == ~(control = "active" /\ flowState = "pruned")
NoSessionBornAfterPrune == flowState = "pruned" => control = "locked"

NoActiveRetireWitness == ~retiredViaService
NoPruneAfterPendingLoginWitness == ~prunedPendingLogin
====

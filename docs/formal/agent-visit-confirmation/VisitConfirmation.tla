---- MODULE VisitConfirmation ----
EXTENDS Naturals

CONSTANTS CheckBinding, CheckConsumption
VARIABLES stage, revision, plan, approved, live, commits, audited, receipt
vars == <<stage, revision, plan, approved, live, commits, audited, receipt>>

Init ==
    /\ stage = "waiting"
    /\ revision = 0
    /\ plan = 0
    /\ approved = FALSE
    /\ live = TRUE
    /\ commits = 0
    /\ audited = 0
    /\ receipt = 0

Prepare ==
    /\ stage = "waiting"
    /\ live
    /\ stage' = "displayed"
    /\ plan' = revision
    /\ UNCHANGED <<revision, approved, live, commits, audited, receipt>>

Fallback ==
    /\ stage = "displayed"
    /\ live
    /\ stage' = "fallback"
    /\ UNCHANGED <<revision, plan, approved, live, commits, audited, receipt>>

Approve ==
    /\ stage \in {"displayed", "fallback"}
    /\ live
    /\ stage' = "signed"
    /\ approved' = TRUE
    /\ UNCHANGED <<revision, plan, live, commits, audited, receipt>>

Retire ==
    /\ live
    /\ live' = FALSE
    /\ stage' = "retired"
    /\ UNCHANGED <<revision, plan, approved, commits, audited, receipt>>

ChangeClinicalContext ==
    /\ revision < 2
    /\ revision' = revision + 1
    /\ UNCHANGED <<stage, plan, approved, live, commits, audited, receipt>>

Consume ==
    /\ stage \in {"signed", "applied"}
    /\ live
    /\ (~CheckBinding \/ revision = plan)
    /\ (~CheckConsumption \/ stage = "signed")
    /\ commits < 2
    /\ stage' = "applied"
    /\ commits' = commits + 1
    /\ audited' = audited + 1
    /\ receipt' = receipt + 1
    /\ UNCHANGED <<revision, plan, approved, live>>

Next == Prepare \/ Fallback \/ Approve \/ Retire \/ ChangeClinicalContext \/ Consume

Spec == Init /\ [][Next]_vars

OnceAndAtomic == commits <= 1 /\ commits = audited /\ commits = receipt
OnlyApproved == commits = 0 \/ approved
BoundCommit == [][(commits' > commits) => (revision = plan /\ live)]_vars
Reachable == commits = 0
====

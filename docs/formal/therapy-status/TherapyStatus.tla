--------------------------- MODULE TherapyStatus ---------------------------
EXTENDS Naturals, FiniteSets, TLC
CONSTANTS Clients, Attempts, AbortUnlock, AdmissionUncertain, OwnerBlindRemove
VARIABLE w
vars == <<w>>
ClientSymmetry == Permutations(Clients)
EmptyClient == [phase |-> "idle", a |-> 0, version |-> 1, target |-> "suspended",
                recovered |-> FALSE, readVersion |-> 0, coherent |-> FALSE,
                readOutcome |-> "unknown", commandOutcome |-> "unknown", unsubmitted |-> 0]
EmptyAttempt == [expected |-> 1, target |-> "suspended", host |-> "none",
                 reply |-> "waiting", outcome |-> "unknown", confirmed |-> FALSE]
Init == w = [version |-> 1, status |-> "active", marker |-> 0, readable |-> TRUE,
             next |-> 1, clients |-> [c \in Clients |-> EmptyClient],
             attempts |-> [a \in Attempts |-> EmptyAttempt],
             unsafeIntent |-> FALSE, unsafeRemoval |-> FALSE]
C(c) == w.clients[c]
A(a) == w.attempts[a]
Applicable == {a \in Attempts : A(a).host = "pending" /\ A(a).expected = w.version}
CanBegin(c) == w.readable /\ w.marker = 0 /\ C(c).phase \in {"idle", "confirm", "reviewed", "registered"}
Begin(c, target) ==
    /\ CanBegin(c) /\ w.next \in Attempts
    /\ w' = [w EXCEPT !.clients[c] = [EmptyClient EXCEPT !.phase = "confirm",
                    !.version = w.version, !.target = target],
                    !.unsafeIntent = @ \/ Applicable # {}]
Cancel(c) ==
    /\ C(c).phase = "confirm" /\ w.marker = 0
    /\ w' = [w EXCEPT !.clients[c] = EmptyClient]
Confirm(c) ==
    /\ C(c).phase = "confirm" /\ w.next \in Attempts
    /\ LET a == w.next IN
       w' = [w EXCEPT !.next = @ + 1,
              !.clients[c].phase = "claiming", !.clients[c].a = a,
              !.clients[c].unsubmitted = a,
              !.attempts[a] = [EmptyAttempt EXCEPT !.confirmed = TRUE,
                       !.expected = C(c).version, !.target = C(c).target]]
Claim(c) ==
    /\ C(c).phase = "claiming" /\ w.marker = 0 /\ w.readable
    /\ w' = [w EXCEPT !.marker = C(c).a, !.clients[c].phase = "admitted"]
ClaimFailure(c) ==
    /\ C(c).phase = "claiming"
    /\ w' = [w EXCEPT !.clients[c].phase = IF AdmissionUncertain THEN "uncertain" ELSE "unavailable"]
ClaimCompletionFailure(c) ==
    /\ C(c).phase = "admitted"
    /\ w' = [w EXCEPT !.clients[c].phase = IF AdmissionUncertain THEN "uncertain" ELSE "unavailable"]
Dispatch(c) ==
    /\ C(c).phase = "admitted"
    /\ w' = [w EXCEPT !.clients[c].phase = "writing", !.clients[c].unsubmitted = 0,
                       !.attempts[C(c).a].host = "pending"]
Host(ca) ==
    /\ A(ca).host = "pending"
    /\ IF A(ca).expected = w.version
       THEN w' = [w EXCEPT !.version = @ + 1, !.status = A(ca).target,
                            !.attempts[ca].host = "committed"]
       ELSE w' = [w EXCEPT !.attempts[ca].host = "rejected"]
HostReject(a) ==
    /\ A(a).host = "pending"
    /\ w' = [w EXCEPT !.attempts[a].host = "rejected"]
OtherWriter ==
    /\ w.version < 3
    /\ w' = [w EXCEPT !.version = @ + 1, !.status = "active"]
LoseResponse(c) ==
    /\ C(c).phase = "writing" /\ A(C(c).a).reply = "waiting"
    /\ w' = [w EXCEPT !.clients[c].phase = "uncertain",
                       !.attempts[C(c).a].reply = "lost"]
Receive(a) ==
    /\ A(a).reply = "waiting" /\ A(a).host \in {"committed", "rejected"}
    /\ w' = [w EXCEPT !.attempts[a].reply = IF A(a).host = "committed" THEN "positive" ELSE "negative"]
Settle(a) ==
    /\ A(a).reply \in {"positive", "negative"} /\ w.readable
    /\ w' = [w EXCEPT !.attempts[a].outcome = IF w.marker = a
                    THEN (IF A(a).reply = "positive" THEN "accepted" ELSE "rejected") ELSE @,
                       !.attempts[a].reply = IF A(a).reply = "positive" THEN "settledPositive" ELSE "settledNegative"]
Deliver(c) ==
    /\ C(c).phase = "writing" /\ A(C(c).a).reply \in {"settledPositive", "settledNegative"}
    /\ w' = [w EXCEPT !.clients[c].phase = IF A(C(c).a).reply = "settledPositive" THEN "uncertain" ELSE "rejected"]
GetStart(c) ==
    /\ C(c).phase \in {"uncertain", "rejected"} /\ C(c).a # 0
    /\ (A(C(c).a).host # "none" \/ C(c).recovered)
    /\ w' = [w EXCEPT !.clients[c].phase = "get",
                       !.clients[c].readVersion = w.version,
                       !.clients[c].coherent = (w.status = C(c).target)]
GetReturn(c) ==
    /\ C(c).phase = "get" /\ w.readable
    /\ LET a == C(c).a
           outcome == IF w.marker = a THEN A(a).outcome ELSE C(c).commandOutcome
           resolved == C(c).readVersion > A(a).expected
                       \/ (outcome = "rejected" /\ C(c).readVersion = A(a).expected)
       IN w' = [w EXCEPT !.clients[c].phase = IF resolved \/ AbortUnlock THEN "removing" ELSE "uncertain",
                         !.clients[c].readOutcome = outcome]
GetFailure(c) ==
    /\ C(c).phase = "get"
    /\ w' = [w EXCEPT !.clients[c].phase = "uncertain"]
Remove(c) ==
    /\ C(c).phase = "removing" /\ w.readable
    /\ w' = [w EXCEPT !.marker = IF OwnerBlindRemove \/ w.marker = C(c).a THEN 0 ELSE @,
                       !.unsafeRemoval = @ \/ (w.marker # 0 /\ w.marker # C(c).a /\
                           (IF OwnerBlindRemove \/ w.marker = C(c).a THEN 0 ELSE w.marker) # w.marker),
                       !.clients[c].phase = "publishing"]
Publish(c) ==
    /\ C(c).phase = "publishing"
    /\ w' = [w EXCEPT !.clients[c].phase =
          IF C(c).readOutcome = "accepted" /\ ~C(c).recovered /\ C(c).coherent
             /\ C(c).readVersion > A(C(c).a).expected THEN "registered" ELSE "reviewed"]
Remount(c) ==
    /\ C(c).phase \in {"writing", "uncertain", "rejected", "unavailable", "reviewed", "registered", "confirm"}
    /\ w' = [w EXCEPT !.clients[c] = EmptyClient]
Recover(c) ==
    /\ C(c).phase = "idle" /\ w.marker # 0
    /\ IF w.readable
       THEN w' = [w EXCEPT !.clients[c] = [EmptyClient EXCEPT !.a = w.marker,
                       !.phase = IF A(w.marker).outcome = "rejected" THEN "rejected" ELSE "uncertain",
                       !.recovered = TRUE, !.commandOutcome = A(w.marker).outcome]]
       ELSE w' = [w EXCEPT !.clients[c].phase = "unavailable"]
RecheckCleanup(c) ==
    /\ C(c).phase = "unavailable" /\ w.readable
    /\ w' = [w EXCEPT !.marker = IF C(c).unsubmitted # 0 /\ (OwnerBlindRemove \/ w.marker = C(c).unsubmitted) THEN 0 ELSE @,
                       !.unsafeRemoval = @ \/ (C(c).unsubmitted # 0 /\ w.marker # 0 /\ w.marker # C(c).unsubmitted /\
                           (IF OwnerBlindRemove \/ w.marker = C(c).unsubmitted THEN 0 ELSE w.marker) # w.marker),
                       !.clients[c].phase = "rechecking", !.clients[c].unsubmitted = 0]
RecheckInspect(c) ==
    /\ C(c).phase = "rechecking" /\ w.readable
    /\ w' = [w EXCEPT !.clients[c] = IF w.marker = 0 THEN EmptyClient
          ELSE [EmptyClient EXCEPT !.a = w.marker, !.recovered = TRUE, !.commandOutcome = A(w.marker).outcome,
                !.phase = IF A(w.marker).outcome = "rejected" THEN "rejected" ELSE "uncertain"]]
StorageFailure == w.readable /\ w' = [w EXCEPT !.readable = FALSE]
StorageRestored == ~w.readable /\ w' = [w EXCEPT !.readable = TRUE]
Next == (\E c \in Clients : (\E target \in {"suspended", "completed"} : Begin(c, target))
         \/ Cancel(c) \/ Confirm(c) \/ Claim(c) \/ ClaimFailure(c) \/ ClaimCompletionFailure(c)
         \/ Dispatch(c) \/ LoseResponse(c) \/ Deliver(c) \/ GetStart(c) \/ GetReturn(c)
         \/ GetFailure(c) \/ Remove(c) \/ Publish(c) \/ Remount(c) \/ Recover(c)
         \/ RecheckCleanup(c) \/ RecheckInspect(c))
         \/ (\E a \in Attempts : Host(a) \/ HostReject(a) \/ Receive(a) \/ Settle(a))
         \/ OtherWriter \/ StorageFailure \/ StorageRestored
NoWriteWithoutConfirmation == \A a \in Attempts : A(a).host # "none" => A(a).confirmed
NoNewIntentWhileApplicable == ~w.unsafeIntent
NoUnprovedRegistration == \A c \in Clients : C(c).phase = "registered" =>
    C(c).readOutcome = "accepted" /\ ~C(c).recovered /\ C(c).coherent
    /\ C(c).readVersion > A(C(c).a).expected /\ A(C(c).a).host = "committed"
AdmissionIsNotUncertain == \A c \in Clients :
    (C(c).phase = "uncertain" /\ C(c).a # 0) =>
        (A(C(c).a).host # "none" \/ C(c).recovered)
OldOwnerPreservesMarker == ~w.unsafeRemoval
NoRegisteredWitness == ~\E c \in Clients : C(c).phase = "registered"
NoRejectedWitness == ~\E c \in Clients : C(c).phase = "rejected"
NoAdmissionWitness == ~\E c \in Clients : C(c).phase = "unavailable" /\ C(c).a # 0 /\ A(C(c).a).host = "none"
NoSameVersionWitness == ~\E c \in Clients : C(c).phase = "uncertain" /\ C(c).readVersion > 0
    /\ C(c).readVersion = A(C(c).a).expected /\ A(C(c).a).host = "pending"
NoRecoveryWitness == ~\E c \in Clients : C(c).recovered /\ C(c).phase = "reviewed"
NoReplacementWitness == ~\E c \in Clients : C(c).phase = "publishing" /\ w.marker # 0 /\ w.marker # C(c).a
=============================================================================

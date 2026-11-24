---- MODULE AgentUnlock ----
EXTENDS Naturals, TLC

CONSTANT Bound, IgnoreManualLock
VARIABLES registration, session, web, grant, token, time, deadline, lastDepositSafe, sharedSeen, revoked, idleDeposit

vars == <<registration, session, web, grant, token, time, deadline, lastDepositSafe, sharedSeen, revoked, idleDeposit>>
NoGrant == <<0, 0>>

Init ==
    /\ registration = "none"
    /\ session = 0
    /\ web = "locked"
    /\ grant = NoGrant
    /\ token = NoGrant
    /\ time = 0
    /\ deadline = 0
    /\ lastDepositSafe = TRUE
    /\ sharedSeen = FALSE
    /\ revoked = FALSE
    /\ idleDeposit = FALSE

Register ==
    /\ registration = "none"
    /\ web = "confirmed"
    /\ registration' = "registered"
    /\ UNCHANGED <<session, web, grant, token, time, deadline, lastDepositSafe, sharedSeen, revoked, idleDeposit>>

Revoke ==
    /\ registration = "registered"
    /\ registration' = "revoked"
    /\ UNCHANGED <<session, web, grant, token, time, deadline, lastDepositSafe, sharedSeen, revoked, idleDeposit>>

Login ==
    /\ session < Bound
    /\ web # "recovering"
    /\ session' = session + 1
    /\ web' = "pending"
    /\ sharedSeen' = FALSE
    /\ UNCHANGED <<registration, grant, token, time, deadline, lastDepositSafe, revoked, idleDeposit>>

Issue(gesture) ==
    IF registration = "registered" /\ grant # gesture
    THEN /\ grant' = gesture
         /\ deadline' = time + 1
         /\ revoked' = FALSE
    ELSE UNCHANGED <<grant, deadline, revoked>>

Confirm(ticket) ==
    /\ ticket = session
    /\ web = "pending"
    /\ web' = "confirmed"
    /\ Issue(<<ticket, 1>>)
    /\ UNCHANGED <<registration, session, token, time, lastDepositSafe, sharedSeen, idleDeposit>>

Share(binding) ==
    /\ binding = session
    /\ web = "confirmed"
    /\ IF sharedSeen THEN UNCHANGED <<grant, deadline, revoked>> ELSE Issue(<<binding, 2>>)
    /\ sharedSeen' = TRUE
    /\ UNCHANGED <<registration, session, web, token, time, lastDepositSafe, idleDeposit>>

Recover ==
    /\ web = "locked"
    /\ web' = "recovering"
    /\ UNCHANGED <<registration, session, grant, token, time, deadline, lastDepositSafe, sharedSeen, revoked, idleDeposit>>

IdleLock ==
    /\ web # "locked"
    /\ web' = "locked"
    /\ UNCHANGED <<registration, session, grant, token, time, deadline, lastDepositSafe, sharedSeen, revoked, idleDeposit>>

ManualLock ==
    /\ web # "locked"
    /\ web' = "locked"
    /\ revoked' = TRUE
    /\ UNCHANGED <<registration, session, grant, token, time, deadline, lastDepositSafe, sharedSeen, idleDeposit>>

Tick ==
    /\ time < Bound
    /\ time' = time + 1
    /\ UNCHANGED <<registration, session, web, grant, token, deadline, lastDepositSafe, sharedSeen, revoked, idleDeposit>>

Available == registration = "registered" /\ grant # NoGrant /\ (~revoked \/ IgnoreManualLock) /\ time < deadline

Retrieve ==
    /\ Available
    /\ token' = grant
    /\ UNCHANGED <<registration, session, web, grant, time, deadline, lastDepositSafe, sharedSeen, revoked, idleDeposit>>

Deposit ==
    /\ Available
    /\ token = grant
    /\ lastDepositSafe' = (registration = "registered" /\ ~revoked /\ time < deadline)
    /\ idleDeposit' = (idleDeposit \/ web = "locked")
    /\ UNCHANGED <<registration, session, web, grant, token, time, deadline, sharedSeen, revoked>>

Next == Register \/ Revoke \/ Login \/ Recover \/ IdleLock \/ ManualLock \/ Tick \/ Retrieve \/ Deposit
        \/ \E binding \in 1..Bound : Confirm(binding) \/ Share(binding)

Spec == Init /\ [][Next]_vars

NoUnauthorizedDeposit == lastDepositSafe
NoGrantWithoutRegistration == grant = NoGrant \/ registration # "none"
NoTokenWithoutGrant == token[1] <= grant[1]
NoTokenWitness == token = NoGrant
NoSharedWitness == token[2] # 2
NoIdleDepositWitness == ~idleDeposit
====

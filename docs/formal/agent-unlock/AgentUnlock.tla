---- MODULE AgentUnlock ----
EXTENDS Naturals, TLC

CONSTANT Bound, IgnoreLock
VARIABLES registration, session, web, grant, token, time, deadline, lastDepositSafe, sharedSeen

vars == <<registration, session, web, grant, token, time, deadline, lastDepositSafe, sharedSeen>>
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

Register ==
    /\ registration = "none"
    /\ web = "confirmed"
    /\ registration' = "registered"
    /\ UNCHANGED <<session, web, grant, token, time, deadline, lastDepositSafe, sharedSeen>>

Revoke ==
    /\ registration = "registered"
    /\ registration' = "revoked"
    /\ UNCHANGED <<session, web, grant, token, time, deadline, lastDepositSafe, sharedSeen>>

Login ==
    /\ session < Bound
    /\ web # "recovering"
    /\ session' = session + 1
    /\ web' = "pending"
    /\ sharedSeen' = FALSE
    /\ UNCHANGED <<registration, grant, token, time, deadline, lastDepositSafe>>

Issue(gesture) ==
    IF registration = "registered" /\ grant # gesture
    THEN /\ grant' = gesture
         /\ deadline' = time + 1
    ELSE UNCHANGED <<grant, deadline>>

Confirm(ticket) ==
    /\ ticket = session
    /\ web = "pending"
    /\ web' = "confirmed"
    /\ Issue(<<ticket, 1>>)
    /\ UNCHANGED <<registration, session, token, time, lastDepositSafe, sharedSeen>>

Share(binding) ==
    /\ binding = session
    /\ web = "confirmed"
    /\ IF sharedSeen THEN UNCHANGED <<grant, deadline>> ELSE Issue(<<binding, 2>>)
    /\ sharedSeen' = TRUE
    /\ UNCHANGED <<registration, session, web, token, time, lastDepositSafe>>

Recover ==
    /\ web = "locked"
    /\ web' = "recovering"
    /\ UNCHANGED <<registration, session, grant, token, time, deadline, lastDepositSafe, sharedSeen>>

Lock ==
    /\ web # "locked"
    /\ web' = "locked"
    /\ UNCHANGED <<registration, session, grant, token, time, deadline, lastDepositSafe, sharedSeen>>

Tick ==
    /\ time < Bound
    /\ time' = time + 1
    /\ UNCHANGED <<registration, session, web, grant, token, deadline, lastDepositSafe, sharedSeen>>

Available == registration = "registered" /\ grant # NoGrant /\ grant[1] = session /\ time < deadline

Retrieve ==
    /\ Available
    /\ web = "confirmed"
    /\ token' = grant
    /\ UNCHANGED <<registration, session, web, grant, time, deadline, lastDepositSafe, sharedSeen>>

Deposit ==
    /\ Available
    /\ web = "confirmed" \/ IgnoreLock
    /\ token = grant
    /\ lastDepositSafe' = (web = "confirmed" /\ registration = "registered" /\ time < deadline)
    /\ UNCHANGED <<registration, session, web, grant, token, time, deadline, sharedSeen>>

Next == Register \/ Revoke \/ Login \/ Recover \/ Lock \/ Tick \/ Retrieve \/ Deposit
        \/ \E binding \in 1..Bound : Confirm(binding) \/ Share(binding)

Spec == Init /\ [][Next]_vars

NoUnauthorizedDeposit == lastDepositSafe
NoGrantWithoutRegistration == grant = NoGrant \/ registration # "none"
NoTokenWithoutGrant == token[1] <= grant[1]
NoTokenWitness == token = NoGrant
NoSharedWitness == token[2] # 2
====

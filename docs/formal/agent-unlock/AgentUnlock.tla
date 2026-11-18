---- MODULE AgentUnlock ----
EXTENDS Naturals, TLC

CONSTANT Bound, IgnoreLock
VARIABLES registration, session, web, grant, token, time, deadline, lastDepositSafe

vars == <<registration, session, web, grant, token, time, deadline, lastDepositSafe>>
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

Register ==
    /\ registration = "none"
    /\ web = "confirmed"
    /\ registration' = "registered"
    /\ UNCHANGED <<session, web, grant, token, time, deadline, lastDepositSafe>>

Revoke ==
    /\ registration = "registered"
    /\ registration' = "revoked"
    /\ UNCHANGED <<session, web, grant, token, time, deadline, lastDepositSafe>>

Login ==
    /\ session < Bound
    /\ web # "recovering"
    /\ session' = session + 1
    /\ web' = "pending"
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
    /\ UNCHANGED <<registration, session, token, time, lastDepositSafe>>

Share(binding) ==
    /\ binding = session
    /\ web = "confirmed"
    /\ Issue(<<binding, 2>>)
    /\ UNCHANGED <<registration, session, web, token, time, lastDepositSafe>>

Recover ==
    /\ web = "locked"
    /\ web' = "recovering"
    /\ UNCHANGED <<registration, session, grant, token, time, deadline, lastDepositSafe>>

Lock ==
    /\ web # "locked"
    /\ web' = "locked"
    /\ UNCHANGED <<registration, session, grant, token, time, deadline, lastDepositSafe>>

Tick ==
    /\ time < Bound
    /\ time' = time + 1
    /\ UNCHANGED <<registration, session, web, grant, token, deadline, lastDepositSafe>>

Available == registration = "registered" /\ grant # NoGrant /\ grant[1] = session /\ time < deadline

Retrieve ==
    /\ Available
    /\ web = "confirmed"
    /\ token' = grant
    /\ UNCHANGED <<registration, session, web, grant, time, deadline, lastDepositSafe>>

Deposit ==
    /\ Available
    /\ web = "confirmed" \/ IgnoreLock
    /\ token = grant
    /\ lastDepositSafe' = (web = "confirmed" /\ registration = "registered" /\ time < deadline)
    /\ UNCHANGED <<registration, session, web, grant, token, time, deadline>>

Next == Register \/ Revoke \/ Login \/ Recover \/ Lock \/ Tick \/ Retrieve \/ Deposit
        \/ \E binding \in 1..Bound : Confirm(binding) \/ Share(binding)

Spec == Init /\ [][Next]_vars

NoUnauthorizedDeposit == lastDepositSafe
NoGrantWithoutRegistration == grant = NoGrant \/ registration # "none"
NoTokenWithoutGrant == token[1] <= grant[1]
NoTokenWitness == token = NoGrant
NoSharedWitness == token[2] # 2
====

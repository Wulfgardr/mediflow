---- MODULE AgentUnlock ----
EXTENDS Naturals, TLC

CONSTANT Bound, IgnoreLock
VARIABLES registration, session, web, grant, token, time, deadline, lastDepositSafe

vars == <<registration, session, web, grant, token, time, deadline, lastDepositSafe>>

Init ==
    /\ registration = "none"
    /\ session = 0
    /\ web = "locked"
    /\ grant = 0
    /\ token = 0
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
    /\ session' = session + 1
    /\ web' = "pending"
    /\ UNCHANGED <<registration, grant, token, time, deadline, lastDepositSafe>>

Confirm(ticket) ==
    /\ ticket = session
    /\ web = "pending"
    /\ web' = "confirmed"
    /\ IF registration = "registered"
       THEN /\ grant' = session
            /\ deadline' = time + 1
       ELSE UNCHANGED <<grant, deadline>>
    /\ UNCHANGED <<registration, session, token, time, lastDepositSafe>>

Lock ==
    /\ web # "locked"
    /\ web' = "locked"
    /\ UNCHANGED <<registration, session, grant, token, time, deadline, lastDepositSafe>>

Tick ==
    /\ time < Bound
    /\ time' = time + 1
    /\ UNCHANGED <<registration, session, web, grant, token, deadline, lastDepositSafe>>

Available == registration = "registered" /\ grant > 0 /\ grant = session /\ time < deadline

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

Next == Register \/ Revoke \/ Login \/ Lock \/ Tick \/ Retrieve \/ Deposit
        \/ \E ticket \in 1..Bound : Confirm(ticket)

Spec == Init /\ [][Next]_vars

NoUnauthorizedDeposit == lastDepositSafe
NoGrantWithoutRegistration == grant = 0 \/ registration # "none"
NoTokenWithoutGrant == token <= grant
NoTokenWitness == token = 0
====

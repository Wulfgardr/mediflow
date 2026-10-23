-------------------------- MODULE LocalOperation --------------------------
EXTENDS Naturals, TLC
CONSTANT UnsafePreparation
VARIABLES state, pack, authority, possible, flight, effects, receipt, recorded,
          badPreparation, actCount, changes, manual
vars == <<state, pack, authority, possible, flight, effects, receipt, recorded,
          badPreparation, actCount, changes, manual>>

Init == /\ state = "prepared" /\ pack = TRUE /\ authority = TRUE
        /\ possible = FALSE /\ flight = FALSE /\ effects = 0 /\ receipt = FALSE
        /\ recorded = FALSE /\ badPreparation = FALSE /\ actCount = 0
        /\ changes = 0 /\ manual = FALSE

Prepare == /\ pack /\ authority /\ state # "confirmed"
           /\ (~possible \/ UnsafePreparation)
           /\ state' = "saved" /\ badPreparation' = (badPreparation \/ possible)
           /\ UNCHANGED <<pack, authority, possible, flight, effects, receipt,
                          recorded, actCount, changes, manual>>
Approve == /\ state = "saved" /\ pack /\ authority /\ ~possible
           /\ state' = "authorized"
           /\ UNCHANGED <<pack, authority, possible, flight, effects, receipt,
                          recorded, badPreparation, actCount, changes, manual>>
Begin == /\ state = "authorized" /\ pack /\ authority /\ ~possible
         /\ state' = "attempt_started" /\ possible' = TRUE /\ flight' = TRUE
         /\ actCount' = actCount + 1
         /\ UNCHANGED <<pack, authority, effects, receipt, recorded,
                        badPreparation, changes, manual>>
ExternalEffect == /\ possible /\ ~manual /\ effects = 0 /\ effects' = 1
                  /\ UNCHANGED <<state, pack, authority, possible, flight,
                                 receipt, recorded, badPreparation, actCount, changes, manual>>
Reply == /\ flight /\ effects = 1 /\ ~manual
         /\ flight' = FALSE
         /\ state' = IF pack /\ authority /\ state = "attempt_started" THEN "confirmed_pending_recording" ELSE "uncertain"
         /\ receipt' = (pack /\ authority /\ state = "attempt_started")
         /\ UNCHANGED <<pack, authority, possible, effects, recorded,
                        badPreparation, actCount, changes, manual>>
LostReply == /\ flight /\ flight' = FALSE /\ state' = "uncertain"
             /\ UNCHANGED <<pack, authority, possible, effects, receipt,
                            recorded, badPreparation, actCount, changes, manual>>
Handoff == /\ state = "saved" /\ pack /\ authority /\ ~possible
           /\ state' = "awaiting_manual_act" /\ possible' = TRUE /\ manual' = TRUE
           /\ UNCHANGED <<pack, authority, flight, effects, receipt, recorded,
                          badPreparation, actCount, changes>>
ManualEffect == /\ manual /\ possible /\ effects = 0 /\ effects' = 1
                /\ UNCHANGED <<state, pack, authority, possible, flight, receipt,
                               recorded, badPreparation, actCount, changes, manual>>
Reconcile == /\ possible /\ ~flight /\ effects = 1 /\ pack /\ authority
             /\ state # "confirmed" /\ state' = "confirmed_pending_recording" /\ receipt' = TRUE
             /\ UNCHANGED <<pack, authority, possible, flight, effects, recorded,
                            badPreparation, actCount, changes, manual>>
Record == /\ state = "confirmed_pending_recording" /\ pack /\ authority /\ receipt
          /\ state' = "confirmed" /\ recorded' = TRUE
          /\ UNCHANGED <<pack, authority, possible, flight, effects, receipt,
                         badPreparation, actCount, changes, manual>>
Disable == /\ pack /\ changes < 2 /\ state # "confirmed"
           /\ pack' = FALSE /\ authority' = FALSE /\ changes' = changes + 1
           /\ state' = IF possible THEN "uncertain" ELSE "suspended_pack_disabled"
           /\ UNCHANGED <<possible, flight, effects, receipt, recorded,
                          badPreparation, actCount, manual>>
Enable == /\ ~pack /\ changes < 2 /\ pack' = TRUE /\ changes' = changes + 1
          /\ UNCHANGED <<state, authority, possible, flight, effects, receipt,
                         recorded, badPreparation, actCount, manual>>
SuspendOrCrash == /\ authority /\ state # "confirmed" /\ authority' = FALSE
                  /\ state' = IF possible THEN "uncertain" ELSE "suspended"
                  /\ UNCHANGED <<pack, possible, flight, effects, receipt,
                                 recorded, badPreparation, actCount, changes, manual>>
Resume == /\ pack /\ ~authority /\ state # "confirmed"
          /\ authority' = TRUE /\ state' = IF possible THEN "uncertain" ELSE "prepared"
          /\ UNCHANGED <<pack, possible, flight, effects, receipt, recorded,
                         badPreparation, actCount, changes, manual>>
Next == Prepare \/ Approve \/ Begin \/ ExternalEffect \/ Reply \/ LostReply \/ Handoff
        \/ ManualEffect \/ Reconcile \/ Record \/ Disable \/ Enable \/ SuspendOrCrash \/ Resume
Spec == Init /\ [][Next]_vars
NoRepeatedAct == actCount <= 1
NoUnreconciledPreparation == ~badPreparation
ConfirmedHasReceipt == recorded => (receipt /\ effects = 1 /\ state = "confirmed")
NoWitness == ~recorded
NoManualWitness == ~(recorded /\ manual)
=============================================================================

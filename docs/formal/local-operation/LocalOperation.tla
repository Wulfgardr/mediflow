-------------------------- MODULE LocalOperation --------------------------
EXTENDS Naturals, TLC
CONSTANTS UnsafePreparation, AutomaticEnabled, UnsafeDispatch
VARIABLES state, pack, authority, possible, flight, effects, receipt, recorded,
          badPreparation, actCount, changes, manual, observationClosed
vars == <<state, pack, authority, possible, flight, effects, receipt, recorded,
          badPreparation, actCount, changes, manual, observationClosed>>

Init == /\ state = "prepared" /\ pack = TRUE /\ authority = TRUE
        /\ possible = FALSE /\ flight = FALSE /\ effects = 0 /\ receipt = FALSE
        /\ recorded = FALSE /\ badPreparation = FALSE /\ actCount = 0
        /\ changes = 0 /\ manual = FALSE /\ observationClosed = FALSE

Prepare == /\ pack /\ authority /\ state # "confirmed"
           /\ (~possible \/ UnsafePreparation)
           /\ state' = "saved" /\ badPreparation' = (badPreparation \/ possible)
           /\ UNCHANGED <<pack, authority, possible, flight, effects, receipt,
                          recorded, actCount, changes, manual, observationClosed>>
Approve == /\ state = "saved" /\ pack /\ authority /\ ~possible
           /\ state' = "authorized"
           /\ UNCHANGED <<pack, authority, possible, flight, effects, receipt,
                          recorded, badPreparation, actCount, changes, manual, observationClosed>>
Begin == /\ state = "authorized" /\ pack /\ authority /\ ~possible
         /\ state' = "attempt_started" /\ possible' = TRUE
         /\ UNCHANGED <<pack, authority, flight, actCount, effects, receipt, recorded,
                        badPreparation, changes, manual, observationClosed>>
Dispatch == /\ AutomaticEnabled /\ (state = "attempt_started" \/ (UnsafeDispatch /\ state = "authorized")) /\ pack /\ authority
            /\ (possible \/ UnsafeDispatch) /\ ~manual /\ actCount = 0
            /\ flight' = TRUE /\ actCount' = 1
            /\ UNCHANGED <<state, pack, authority, possible, effects, receipt, recorded,
                           badPreparation, changes, manual, observationClosed>>
ExternalEffect == /\ possible /\ ~manual /\ actCount = 1 /\ effects = 0 /\ effects' = 1
                  /\ UNCHANGED <<state, pack, authority, possible, flight,
                                 receipt, recorded, badPreparation, actCount, changes, manual, observationClosed>>
Reply == /\ flight /\ effects = 1 /\ ~manual
         /\ flight' = FALSE
         /\ state' = IF pack /\ authority /\ state = "attempt_started" THEN "attempt_started" ELSE "uncertain"
         /\ receipt' = (pack /\ authority /\ state = "attempt_started")
         /\ UNCHANGED <<pack, authority, possible, effects, recorded,
                        badPreparation, actCount, changes, manual, observationClosed>>
CloseObservation == /\ receipt /\ ~flight /\ ~observationClosed /\ state = "attempt_started"
                    /\ pack /\ authority
                    /\ observationClosed' = TRUE /\ state' = "confirmed_pending_recording"
                    /\ UNCHANGED <<pack, authority, possible, flight, effects, receipt, recorded,
                                   badPreparation, actCount, changes, manual>>
LostReply == /\ flight /\ flight' = FALSE /\ state' = "uncertain"
             /\ UNCHANGED <<pack, authority, possible, effects, receipt,
                            recorded, badPreparation, actCount, changes, manual, observationClosed>>
Handoff == /\ state = "saved" /\ pack /\ authority /\ ~possible
           /\ state' = "awaiting_manual_act" /\ possible' = TRUE /\ manual' = TRUE
           /\ UNCHANGED <<pack, authority, flight, effects, receipt, recorded,
                          badPreparation, actCount, changes, observationClosed>>
ManualEffect == /\ manual /\ possible /\ effects = 0 /\ effects' = 1
                /\ UNCHANGED <<state, pack, authority, possible, flight, receipt,
                               recorded, badPreparation, actCount, changes, manual, observationClosed>>
Reconcile == /\ state # "attempt_started" /\ possible /\ ~flight /\ effects = 1 /\ pack /\ authority
             /\ state # "confirmed" /\ state' = "confirmed_pending_recording" /\ receipt' = TRUE
             /\ observationClosed' = TRUE
             /\ UNCHANGED <<pack, authority, possible, flight, effects, recorded,
                            badPreparation, actCount, changes, manual>>
Record == /\ state = "confirmed_pending_recording" /\ pack /\ authority /\ receipt /\ observationClosed
          /\ state' = "confirmed" /\ recorded' = TRUE
          /\ UNCHANGED <<pack, authority, possible, flight, effects, receipt,
                         badPreparation, actCount, changes, manual, observationClosed>>
Disable == /\ pack /\ changes < 2 /\ state # "confirmed"
           /\ pack' = FALSE /\ authority' = FALSE /\ changes' = changes + 1
           /\ state' = IF possible THEN "uncertain" ELSE "suspended_pack_disabled"
           /\ UNCHANGED <<possible, flight, effects, receipt, recorded,
                          badPreparation, actCount, manual, observationClosed>>
Enable == /\ ~pack /\ changes < 2 /\ pack' = TRUE /\ changes' = changes + 1
          /\ UNCHANGED <<state, authority, possible, flight, effects, receipt,
                         recorded, badPreparation, actCount, manual, observationClosed>>
SuspendOrCrash == /\ authority /\ state # "confirmed" /\ authority' = FALSE
                  /\ state' = IF possible THEN "uncertain" ELSE "suspended"
                  /\ UNCHANGED <<pack, possible, flight, effects, receipt,
                                 recorded, badPreparation, actCount, changes, manual, observationClosed>>
Resume == /\ pack /\ ~authority /\ state # "confirmed"
          /\ authority' = TRUE /\ state' = IF possible THEN "uncertain" ELSE "prepared"
          /\ UNCHANGED <<pack, possible, flight, effects, receipt, recorded,
                         badPreparation, actCount, changes, manual, observationClosed>>
Next == Prepare \/ Approve \/ Begin \/ Dispatch \/ ExternalEffect \/ Reply \/ CloseObservation \/ LostReply \/ Handoff
        \/ ManualEffect \/ Reconcile \/ Record \/ Disable \/ Enable \/ SuspendOrCrash \/ Resume
Spec == Init /\ [][Next]_vars
NoRepeatedAct == actCount <= 1
NoUnreconciledPreparation == ~badPreparation
ConfirmedHasReceipt == recorded => (observationClosed /\ receipt /\ effects = 1 /\ state = "confirmed")
NoDispatchBeforeMarker == actCount > 0 => possible
NoEffectBeforeDispatch == (~manual /\ effects > 0) => (possible /\ actCount = 1)
NoAutomaticWitness == ~(recorded /\ ~manual /\ actCount = 1)
NoManualWitness == ~(recorded /\ manual)
=============================================================================

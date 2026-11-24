# Rinnovo dei mandati allo sblocco

Il modello esplora un client e un medico per tre sessioni e tre avanzamenti
del tempo. Ogni sessione può ricevere un trasferimento di chiave, con retry
dello stesso gesto. Un'unità rappresenta la durata del mandato. Il blocco per
inattività chiude la scheda e lascia valido il mandato emesso; il blocco manuale
lo revoca. La durata esatta, gli scope e i dati
della cassetta sono verificati dalle prove TypeScript e HTTP.

| Transizione | Codice |
| --- | --- |
| Registra e revoca | `approve` e `register`, `revoke` in agent-pairing-store e agent-registration-store |
| Login, conferma tardiva | `beginAgentUnlock`, `confirmAgentUnlock` |
| Blocco per inattività, blocco manuale | `completeExactWebP3ApplicationLock`; solo il manuale chiama `revokeAll` |
| Trasferimento e recupero | `confirmSharedAgentUnlock` con la generazione e il controllo Web della scheda. Il recupero ritira l’accesso prima che lo sblocco possa ripartire. |
| Emissione | `renew` in agent-registration-store, una transazione IMMEDIATE per tutti i client |
| Ritiro | `retrieve` verifica scadenza, corrente e revoca prima di consegnare il token, senza richiedere la sessione Web |
| Deposito | `principal` rilegge gli stessi vincoli dentro la transazione del deposito |

La conferma, il controllo della sessione e la transazione SQLite sono
sincroni nel processo Web. Il browser può perdere, ritentare o ritardare
una richiesta prima di quella regione. SQLite serializza i cambi dell'archivio.
Il ticket pendente, il possesso della credenziale lunga e la ricevuta del
mandato sono distinti. Gli effetti su più client, il riavvio, i segreti e
i guasti del disco sono fuori dal modello.

TLC 2.19 dal pacchetto TLA+ 1.7.4. Dalla directory del modello, con
`TLA_JAR` impostato sul percorso del jar:

```sh
java -XX:+UseParallelGC -cp "$TLA_JAR" tlc2.TLC -deadlock -config MC.cfg AgentUnlock.tla
```

Con `IgnoreManualLock = TRUE`, ci si aspetta che fallisca
`NoUnauthorizedDeposit` dopo ritiro, blocco manuale e deposito. Sostituendo la riga
`INVARIANTS` con `INVARIANT NoSharedWitness`, il controesempio deve
raggiungere il ritiro dopo «Rinnova accesso»; con `INVARIANT NoIdleDepositWitness`
deve raggiungere un deposito a scheda bloccata per inattività. La prova browser
esercita ritiro e contesto dopo il blocco per inattività su route reali.

Al 24 novembre 2026, 8.284 stati distinti senza violazioni. Il mutante viola
`NoUnauthorizedDeposit`. I due testimoni raggiungono il ritiro condiviso e il
deposito dopo il blocco per inattività.

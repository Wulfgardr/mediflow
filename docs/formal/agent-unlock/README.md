# Rinnovo dei mandati allo sblocco

Il modello esplora un client e un medico per tre sessioni e tre avanzamenti
del tempo. Un'unità rappresenta la durata del mandato. Il modello tratta la
scadenza della sessione come un blocco. La durata esatta, gli scope e i dati
della cassetta sono verificati dalle prove TypeScript e HTTP.

| Transizione | Codice |
| --- | --- |
| Registra e revoca | `approve` e `register`, `revoke` in agent-pairing-store e agent-registration-store |
| Login, conferma tardiva, blocco | `beginAgentUnlock`, `confirmAgentUnlock` e il ritiro della risorsa dal proprietario della sessione |
| Emissione | `renew` in agent-registration-store, una transazione IMMEDIATE per tutti i client |
| Ritiro | `retrieve` verifica sessione, scadenza, corrente e revoca prima di consegnare il token |
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

Con `IgnoreLock = TRUE`, ci si aspetta che fallisca
`NoUnauthorizedDeposit` dopo ritiro, blocco e deposito. Sostituendo la riga
`INVARIANTS` con `INVARIANT NoTokenWitness`, il controesempio deve
raggiungere il ritiro di un token. La prova browser esercita lo stesso
ordine di ritiro, blocco e rifiuto su route reali.

Al 18 novembre 2026, 404 stati distinti senza violazioni. Il mutante viola
`NoUnauthorizedDeposit`. Il testimone raggiunge il ritiro.

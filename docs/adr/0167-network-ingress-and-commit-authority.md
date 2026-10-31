# ADR 0167: ingresso paired e autorità corrente al commit

Data: 2026-10-31
Stato: Proposed

Il browser locale è l'ingresso Web documentato. Il listener TLS in LAN serve
invece il collegamento dei dispositivi abbinati, secondo ADR 0034 e la guida
TLS. L'inoltro indiscriminato esponeva anche login e API Web senza pairing.

Il proxy consente ai peer remoti solo metodi e percorsi espliciti del contratto
network e native, più check, profilo account e cambio credenziale consumati dai
client Apple e Rust. Il socket decide il peer, senza fidarsi di Host o header.
Il server richiede l'attestazione loopback sia per emettere sia per consumare
sessioni Web. Le sessioni native conservano il proprio ingresso paired.

Tutti i writer clinici network rivalidano pairing, modalità, capability,
sessione, generazione archivio e ambulatorio nella transazione IMMEDIATE che
scrive dato e audit. La negazione precede anche duplicati e ricevute di successo.
Le scale continuano a usare il writer del diario.

Per un'origine non loopback Swift e Rust richiedono un pin SHA-256 valido.
La discovery propone indirizzo e impronta candidata, ma non compila il pin
fidato: l'operatore lo confronta con quello mostrato localmente dall'host.
Un pin assente o malformato impedisce la richiesta prima dell'invio di segreti.

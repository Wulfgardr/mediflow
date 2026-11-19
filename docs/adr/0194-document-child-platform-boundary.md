# ADR 0194: Confine dei processi documentali per piattaforma

Date: 2026-11-19
Status: Proposed

## Contesto

Web e Headless distribuiscono lo stesso runtime Web standalone. Il controllo del pacchetto
avviava i worker documentali direttamente, mentre i chiamanti normali passano dal
launcher documentale. Q-4, Q-6 e Q-8 richiedono evidenza sul profilo effettivo ed esigono
che i limiti del perimetro distribuito siano espliciti.

## Decisione

Il controllo del pacchetto usa la stessa ricetta di avvio del codice di produzione
per l'estrazione AnyDoc e per il worker PDF. Su macOS quel launcher applica una
policy Seatbelt che nega rete, scritture su file e fork al processo documentale.
L'avvio tramite Seatbelt è obbligatorio. I thread del motore di rendering restano
disponibili. Apple Vision ha un proprio launcher Seatbelt su macOS.

Su Linux ARM64 il launcher conserva il limite dati di `prlimit`. Avvia poi il
worker tramite `unshare` in un namespace di rete nuovo, mantenendo UID e GID
del chiamante. Il worker parte senza le interfacce e le rotte IP del guest.
Il sistema deve permettere a un utente ordinario di creare questi namespace.
Un avvio negato rende indisponibile l'elaborazione del documento.

Windows 11 ARM con Node x64 emulato avvia direttamente Node. Su Linux con
un'altra architettura resta il limite dati di `prlimit`. Su questi profili
manca un blocco di rete imposto dal launcher a livello di sistema. Tutti i
worker mantengono il modello dei permessi Node e il blocco JavaScript delle
API di rete. Gli addon nativi operano fuori da quei controlli JavaScript.

## Conseguenze

Il namespace Linux separa la rete IP e i socket Unix astratti. I socket Unix
visibili come file restano accessibili secondo i permessi del processo.
Per Windows, AppContainer senza capacità di rete richiede di verificare anche
accesso a Node x64, file del pacchetto, addon e pipe ereditate.
L'evidenza relativa al runtime Web non attribuisce la stessa protezione al
processo GPUI. La qualifica del client installato segue il profilo Mac di Q-6.

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

Su Omarchy ARM il launcher usa `prlimit` per il limite dati. Su Windows 11 ARM
con Node x64 emulato avvia direttamente Node. Entrambi mantengono i limiti
applicativi, il modello di permessi Node e il blocco JavaScript delle API di rete
usate dai worker. Gli addon nativi non ricadono sotto il blocco JavaScript.
Su questi due profili il percorso resta disponibile e manca un blocco di rete
imposto dal sistema operativo.

## Conseguenze

L'isolamento di rete di sistema su Linux o Windows richiede un meccanismo
applicato al figlio e una prova del rendering nel profilo distribuito con
l'utente ordinario. Per Windows, AppContainer senza capacità di rete richiede
di verificare anche accesso a Node x64, file del pacchetto, addon e pipe ereditate.
L'evidenza relativa al runtime Web non attribuisce la stessa protezione al
processo GPUI. La qualifica del client installato segue il profilo Mac di Q-6.

# ADR 0196: Confine dei processi documentali per piattaforma

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

Windows 11 ARM richiede un confine di rete del sistema operativo per AnyDoc e
il lettore PDF. Il launcher usa un AppContainer senza capacità, tramite
`PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES` e `CreateProcessW`. Il
bootstrap verifica il token prima di avviare il worker. Un errore durante
la preparazione o la verifica rende indisponibile l'elaborazione.

Il contenitore riceve in lettura ed esecuzione una copia temporanea di Node e
degli asset necessari al worker. Il PDF e la risposta transitano attraverso
le sole pipe standard. Il Job Object termina il worker se il bootstrap
termina prima di lui.
Il bootstrap verifica che il token del figlio sospeso abbia il SID atteso e
zero capacità. Node conserva i permessi applicativi e il guard JavaScript.
La copia contiene solo asset documentali fisici. Node risolve i moduli al
suo interno conservando i percorsi delle copie, senza richiedere accesso
alle directory superiori.

## Conseguenze

Il namespace Linux separa la rete IP e i socket Unix astratti. I socket Unix
visibili come file restano accessibili secondo i permessi del processo.
Sulle altre architetture Linux resta il limite dati di `prlimit`.
La qualifica GPUI resta quella del client installato sul Mac di Q-6.


[API Microsoft per AppContainer](https://learn.microsoft.com/windows/win32/secauthz/implementing-an-appcontainer)

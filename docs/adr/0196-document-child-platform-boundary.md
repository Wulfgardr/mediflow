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

Il 19 novembre 2026 Leonardo ha approvato il requisito di consegna per Web e
Headless su Windows 11 ARM. Il sistema operativo deve imporre l'isolamento di
rete ai processi di AnyDoc e del lettore PDF, anche quando caricano moduli nativi.
L'esecuzione senza questo confine blocca la consegna.

L'ADR resta `Proposed` durante l'integrazione della ricetta. Il requisito
Windows 11 ARM è già approvato.

Il launcher usa un AppContainer senza capacità, tramite
`PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES` e `CreateProcessW`. Il
bootstrap verifica il token prima di avviare il worker. Un errore durante
la preparazione o la verifica rende indisponibile l'elaborazione.

Il contenitore riceve in lettura ed esecuzione una copia temporanea di Node e
degli asset necessari al worker. Il PDF e la risposta transitano attraverso
le sole pipe standard. Il Job Object termina il worker se il bootstrap
termina prima di lui. Il bootstrap cancella il proprio profilo quando il worker
termina. Quando si chiude il bootstrap, il processo padre ritenta la pulizia
dello stesso profilo. La pulizia vale anche per un annullamento e può essere
ripetuta.
Il bootstrap verifica che il token del figlio sospeso abbia il SID atteso e
zero capacità. Node conserva i permessi applicativi e il guard JavaScript.
Il launcher prepara una copia fisica degli asset documentali. Il renderer usa
i file del pacchetto nella copia e verifica l'identità del binario e dei dati
ICU prima del caricamento. La risoluzione dei file su Windows resta dentro la
copia, dove il token del worker ha accesso in lettura.

## Prove

Sullo standalone Web, lo stesso PDF sintetico ha prodotto testo e un PNG da
640 × 288 nei profili sotto indicati. Il digest dell'originale è rimasto
invariato. Ogni prova vale per il pacchetto e il profilo in cui è stata eseguita.

- **macOS 27.3 ARM64, Node 24.22.3.** Il controllo di Seatbelt sui PID di
  estrazione, materializzazione e rendering ha rilevato il diniego di rete in
  ingresso e in uscita. Il launcher modificato nega anche il fork.
- **Omarchy ARM, Node 24.22.3.** I PID dei worker avevano un namespace di rete
  distinto dal padre. Nel namespace c'erano solo loopback, zero rotte IPv4 e
  zero indirizzi IPv6. Il limite dati di `prlimit` era attivo.
- **Windows 11 Pro ARM, build 26200, Node x64 24.22.3 e account ordinario.**
  I pacchetti prodotti dai tar di `03a4c153d` e `a3d93d4d` hanno passato la
  prova documentale. I worker avevano un token AppContainer con zero capacità
  e senza eccezioni di loopback. Il listener TCP sintetico ha registrato zero
  connessioni dai worker confinati e due connessioni di controllo. Con il
  bootstrap mancante l'avvio è stato negato. Su `a3d93d4d` è passata anche la
  verifica del digest nella ricevuta del materializzatore.

La CI Windows x64 verifica un profilo distinto. Il job su `03a4c153d` ha
verificato il pacchetto, l'estrazione, il PNG e l'avvio del Web.
[Job Windows x64](https://github.com/Wulfgardr/mediflow/actions/runs/44646163505/job/135989706638)

## Conseguenze

Il namespace Linux separa la rete IP e i socket Unix astratti. I socket Unix
visibili come file restano accessibili secondo i permessi del processo.
Sulle altre architetture Linux resta il limite dati di `prlimit`.
La qualifica GPUI resta quella del client installato sul Mac di Q-6.


[API Microsoft per AppContainer](https://learn.microsoft.com/windows/win32/secauthz/implementing-an-appcontainer)

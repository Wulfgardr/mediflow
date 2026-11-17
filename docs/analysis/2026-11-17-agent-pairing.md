# Abbinamento e credenziale di un agente

Data: 17 novembre 2026. Refs WUL-867, ADR 0190.

L'agente chiede un abbinamento con nome e operazioni. La risposta distingue
la ricevuta, che contiene il codice di otto caratteri, dal segreto di
polling destinato al trasporto. Prima dell'approvazione il polling non
restituisce un token. La pagina Agenti mostra codice, nome, operazioni e
mandati compatibili. Il medico confronta il codice e approva.

L'approvazione associa la richiesta ad un mandato corrente del medico,
senza ampliare il perimetro. Transizione ed audit stanno nella stessa
transazione IMMEDIATE. Un UPDATE ignorato o un errore audit impediscono
la ricevuta di successo. La credenziale si emette soltanto dopo
l'approvazione, con scadenza uguale a quella del mandato.

Il token opaco ha una classe distinta dal token locale. Viene derivato
con separazione di dominio dal segreto del pairing, consentendo retry e
riavvio senza conservare token aperti nel DB. Il server conserva solo gli
hash di segreto e token. Il segreto di polling dura cinque minuti. Le
ricevute ordinarie non contengono queste credenziali.

Ogni richiesta autenticata rilegge token, perimetro, scadenza e mandato
nella transazione chiamante. Il token non accede alla privata avvolta o
all'identità del medico. Il contesto contiene soltanto riferimenti opachi,
operazioni, scadenza, fornitore dichiarato e pubblica del mandato.

Il file della credenziale è privato (`0600`, directory `0700` su POSIX),
fuori dalle cartelle sincronizzate. La lettura rifiuta file condivisi
tramite hard link, symlink e permessi più ampi. Nessuna funzione di
persistenza stampa il token. Questa qualificazione dei permessi riguarda
POSIX e non costituisce una verifica delle ACL Windows.

La versione 14 aggiunge le tabelle locali del pairing e dei client,
preservando l'originale 13 ed il recupero cifrato dei predecessori. Le
credenziali restano associate alla generazione dell'archivio, che cambia
al ripristino. La ricostruzione degli schemi precedenti mantiene le loro
impronte immutabili.

## Confini della verifica

Le prove dello store coprono approvazione, scope, attore, scadenza,
revoca, retry, hash nel DB e rollback. Le route del canale sono provate
su un vero socket loopback. Il controllo del perimetro sulla terapia
usa ancora una fixture di transazione, da collegare al deposito A3.
L'API v1 precedente ed il resolver documentale non sono modificati.

Il proxy esclude le route agenti e risponde 404 al peer non loopback,
conservando 403 per gli altri percorsi Web esclusi. La prova TLS locale
sul Mac si ferma prima di HTTP: il server registra `ENOTCONN`, il client
`ECONNRESET`. Sono fallimenti della prova, senza causa attribuita a VPN
o firewall. Il test resta attivo nella CI e non viene saltato per
qualificare il 404. Finché non raggiunge HTTP, il risultato del proxy
resta non provato.

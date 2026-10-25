# ADR 0163 — Dossier visita e appunti mobili cifrati

Stato: Proposed. Data: 2026-10-25. Refs WUL-793.

## Decisione

L'archivio autorevole resta sull'host. Una preparazione online esplicita acquisisce
profilo minimo, fino a 100 terapie e 100 voci di diario tramite il client canonico.
Ogni sezione conserva provenienza, versioni e limiti: una lista al limite può essere
parziale; documenti, allegati, checkup, prescrizioni e Fabric non sono acquisiti.
I consumer Fabric esistenti restano online e governati dall'host.

Questo dossier è distinto dalla cache ADR 0048: non ne rimuove il sessionDigest e
non estende la sessione host. Il binding comprende HTTPS/pin, device paired,
digest del token, operatore, scope, archiveGeneration e paziente. L'identità
archivio è disponibile in HomeBaseAccountProfile. Il server controlla la generazione
dei pairing in network-home-base-server.ts; la sostituzione rende inerti i grant
precedenti, coperta da network-home-base-server.test.ts. L'adapter rilegge profilo
operatore, identità/scope/capability e paziente prima e dopo le sezioni.

Lo sblocco locale usa una chiave AES-GCM casuale, non la master key dell'host.
Keychain: userPresence, WhenPasscodeSetThisDeviceOnly, synchronizable=false;
un sistema senza tale protezione nega la preparazione. Non è una chiave simmetrica
nel Secure Enclave. La chiave host, la password e il cookie restano solo nel
raccordo online in RAM. Il dossier contiene una proiezione minima decifrata online,
ricifrata sotto la chiave locale. Un'appena riavviata può leggere quella proiezione
dopo autenticazione locale, senza inventare una sessione server.

Un unico envelope autenticato conserva dossier e appunti in Application Support
privato. Salvataggio atomico, iOS complete file protection, esclusione backup
impostata e verificata dopo ogni sostituzione, nomi costanti senza identificativi.
Nessun SQLite mobile, coda HTTP o invio alla riconnessione. L'appunto è dato
sanitario, distinto dalla cartella; viene salvato cifrato ad ogni modifica accettata.
Lock/background invalidano le operazioni pendenti e azzerano chiave/presentazione.
Il raccordo deve coprire anche logout e cambi di autorità, prima di pubblicarli.

Il dossier scade entro 24 ore dall'inizio dell'acquisizione, senza rinnovo in lettura.
Orologio precedente all'acquisizione o all'ultima apertura persistita nega la
lettura. Un controllo periodico invalida una vista lasciata aperta oltre scadenza.
Non esiste un orologio fidato offline: rollback non osservabile dopo spegnimento
rimane un limite, da qualificare su dispositivo. La scadenza conserva il ciphertext
dell'appunto. Il TTL riguarda soltanto la copia derivata dell'host. L'appunto scritto
dal medico ha conservazione separata senza TTL di lettura: dopo userPresence può
essere letto e modificato offline, anche dopo la scadenza del dossier. Mostra solo
la propria identità/provenienza minima (etichetta paziente, host, operatore, scope,
revisione e data), conservate con l'appunto; non ripresenta sezioni del dossier
scaduto. Rimane dato sanitario cifrato, non un record clinico registrato. Non si
cancella automaticamente e non diventa autorità per scrivere sull'host.

## Revisione online

Il raccordo richiede un nuovo login esplicito; rilegge archivio, pairing, operatore,
scope, permessi e versioni tramite lo stesso adapter canonico. Un cambio di contesto
nega l'importazione. Versioni diverse richiedono confronto esplicito; non ribasano
l'appunto. L'importazione precompila il compositore ordinario solo per gesto medico,
senza sovrascrivere una bozza già presente. Il writer e l'audit ADR 0053 restano
unici. L'appunto rimane conservato anche dopo importazione, timeout o esito incerto:
un ack HTTP da solo non lo dichiara registrato. Il collegamento noteID/revisione/
entryID è persistito prima dell'importazione. Prima del primo tentativo il writer
ordinario conserva nel vault il payload esatto (data e ciphertext inclusi), quindi
marca l'esito incerto prima di chiamare il create ordinario. Nessuna seconda coda
HTTP: soltanto Registra avvia il tentativo. Il writer conserva lo stesso ID e gli
stessi byte per un eventuale nuovo tentativo esplicito, perché sameNetworkCreate
confronta anche data, ciphertext e riferimenti agli allegati.

La ricevuta richiede id/version del DTO HomeBaseCreatedResource e rilettura fresca
dell'esatta voce tramite il GET canonico per entryID; si confrontano paziente,
versione, campi e stato con il payload congelato. Dopo perdita dell'ack la stessa
rilettura può riconciliare la voce. Il solo 404 corrente autorizza a ripresentare
lo stesso payload a Registra; rete assente, errore o mismatch non autorizzano un
nuovo ID. L'assenza da una lista limitata non prova nulla. Un fallimento nel salvare
la ricevuta lascia appunto e riferimento recuperabili; non sblocca un nuovo invio.
Le ricevute restano associate alla revisione inviata, anche se l'appunto viene
modificato successivamente.

La riautenticazione è una sequenza esplicita, senza callback sospesa che conservi
materiale decifrato: un riferimento opaco all'appunto sopravvive al lock; nuovo
login, nuovo userPresence, rilettura e review sono fasi separate. L'importazione
riusa quella sessione, purché diversa da quella di preparazione e ancora valida,
e rilegge le fonti prima di precompilare. Logout, background e cambi di autorità
invalidano chiave, presentazione, compositore associato e risposte tardive.

## Minacce e limiti

Si coprono lettura di file copiati, alterazione dell'envelope, mescolamento di
pazienti/archivi, riapertura senza consenso locale e risposte tardive dopo lock.
Non si coprono dispositivo/host compromessi, osservazione dello schermo sbloccato,
revoca host durante l'intervallo offline e recupero dopo perdita della chiave.
Rimuovere il codice del dispositivo può distruggere la chiave e rendere irrecuperabili
gli appunti non registrati. L'opt-in deve dirlo prima della preparazione.
La copia non è un backup recuperabile; disponibilità/rete privata dell'host restano
prerequisiti separati. Il simulatore non qualifica Keychain, passcode, file protection o firma fisici.
Sul simulatore FileManager può non restituire protectionKey: quel solo target
accetta il metadato assente dopo aver richiesto complete protection. Su dispositivo
il valore deve essere presente e completo; un valore diverso nega il salvataggio
anche sul simulatore. L'esclusione backup è sempre riletta e verificata.

## Consegna

L'ingresso Visita senza rete è montato nella Worklist iOS, anche prima del login.
La sheet permette preparazione esplicita, apertura di appunti conservati, nuovo
accesso e review; l'importazione apre il Diario ordinario e lascia Registra al
medico. Ricevute e riconciliazione sono nella stessa sheet. NSFaceIDUsageDescription
è presente nel progetto iOS. La qualifica sintetica non chiude da sola WUL-793.
Servono review indipendente del diff finale e prove UI native iPhone/iPad sintetiche.

Il test `MobileVisitProductUITests` usa la vera app Debug sul simulatore, con
`MEDIFLOW_APPLE_UITEST_PATIENTS=1` e un namespace sintetico univoco in
`MEDIFLOW_APPLE_UITEST_VISIT`. Il trasporto canonico incontra soltanto un URLProtocol
locale simulato; chiave, archivio host e autenticazione dispositivo sono fixture,
senza rete esterna né Keychain reale. `MEDIFLOW_APPLE_UITEST_VISIT_OFFLINE=1`
riavvia l'app senza sessione host conservando il vault sintetico del namespace.
Il percorso copre preparazione, appunto, riavvio senza sessione, nuovo accesso,
review, importazione, Registra e ricevuta dopo un altro riavvio. La sua compilazione
non equivale alla sua esecuzione, né qualifica userPresence su dispositivo fisico.
Il raccordo sintetico è escluso da Release e da ogni build su dispositivo.

## Fonti Apple

- [Accessibilità Keychain](https://developer.apple.com/documentation/security/restricting-keychain-item-accessibility)
- [WhenPasscodeSetThisDeviceOnly](https://developer.apple.com/documentation/security/ksecattraccessiblewhenpasscodesetthisdeviceonly)
- [userPresence](https://developer.apple.com/documentation/security/secaccesscontrolcreateflags/userpresence)
- [Esclusione backup](https://developer.apple.com/documentation/foundation/urlresourcekey/isexcludedfrombackupkey)

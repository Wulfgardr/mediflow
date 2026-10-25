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
dell'appunto, recuperabile solo dopo nuova autenticazione online e rivalidazione.

## Revisione online

Il raccordo richiede un nuovo login esplicito; rilegge archivio, pairing, operatore,
scope, permessi e versioni tramite lo stesso adapter canonico. Un cambio di contesto
nega l'importazione. Versioni diverse richiedono confronto esplicito; non ribasano
l'appunto. L'importazione precompila il compositore ordinario solo per gesto medico,
senza sovrascrivere una bozza già presente. Il writer e l'audit ADR 0053 restano
unici. L'appunto rimane conservato anche dopo importazione, timeout o esito incerto:
questa tranche non espone uno stato «registrato» e non cancella dopo un ack HTTP.
Un futuro raccordo di ricevuta deve associare conferma e rilettura del writer.

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

Componenti e adapter possono essere verificati indipendentemente. Finché il parent
non monta il percorso e collega i confini di sessione/compositore nei file con altra
ownership, questa ADR non attesta una feature disponibile né chiude WUL-793.
Servono review indipendente del diff finale e prove UI native iPhone/iPad sintetiche.

## Fonti Apple

- [Accessibilità Keychain](https://developer.apple.com/documentation/security/restricting-keychain-item-accessibility)
- [WhenPasscodeSetThisDeviceOnly](https://developer.apple.com/documentation/security/ksecattraccessiblewhenpasscodesetthisdeviceonly)
- [userPresence](https://developer.apple.com/documentation/security/secaccesscontrolcreateflags/userpresence)
- [Esclusione backup](https://developer.apple.com/documentation/foundation/urlresourcekey/isexcludedfrombackupkey)

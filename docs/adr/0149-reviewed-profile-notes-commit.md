# ADR 0149 — Salvataggio delle note rivedute e recupero dell'esito

Data: 2026-10-19. Stato: Proposed; accettazione con review indipendente e merge.
Riferimenti: WUL-577, WUL-585, ADR 0098, ADR 0147, ADR 0148.

## Decisione e ambito

La capacità Web `patient-profile.notes.commit.v1` sostituisce esclusivamente
le note del paziente selezionato. Il normale salvataggio del profilo e i suoi
adattatori storici e `/api/v1` conservano il servizio e il contratto qualificati.
La nuova capacità usa lo stesso `patient-profile.update.v1`, il dispatch fisso
`legacy-node` e `updatePatientOperation`; non introduce un writer, un database
o un esecutore alternativi. Non è esposta a MCP, Mini, native, FHIR o provider.

L'ammissione Web esistente, la generazione dell'archivio, l'account corrente e
l'ambito reale del paziente restano necessari. La nuova capacità aggiunge la
revisione terminale `physician_terminal_review`, il PIN fresco e un permesso
host monouso distinto dalla proof e dall'esito review-only dell'ADR 0148.
Si estende esplicitamente il consumatore dell'owner di attestazione dell'ADR
0098 a questa condizione aggiuntiva: l'attestazione da sola non ammette una
scrittura. Nessun ruolo dichiarato dal client, `confirmed`, receipt F10/SOAP
o esito `reviewed` è convertito in autorità. Non occorrono nuovi enrollment o
registri di sessione; gli owner correnti conservano e ritirano il permesso.

## Un comando, una presentazione, un commit

L'host normalizza una sola volta. Il binding include comando completo, byte
ENC, destinatario mostrato, autore, sessione e generazioni dell'attestazione,
ambulatorio, selection epoch, revisione, operazione, policy, esecutore, chiave
host e scadenza. La UI decifra i byte trattenuti dall'host e mostra insieme
destinatario, sostituzione o rimozione delle note e contenuto integrale. Dopo
la preparazione non ricifra e non invia un nuovo contenuto alla conferma.
Cambio materiale o di contesto, lock, revoca, scadenza e riavvio invalidano
il permesso. La conferma presenta soltanto riferimento, impronta e PIN.

Dopo le attese per PIN e attestazione, il writer apre il proprio `IMMEDIATE`.
Il controllo sincrono di ammissione, account, selezione, ambito, policy,
scadenza e versione e il consumo del permesso avvengono prima dell'effetto,
nella stessa transazione del CAS e dell'audit obbligatorio. Nessuna attesa,
chiamata esterna o scelta di fallback può intervenire tra controllo e commit.
Una revisione consumata resta terminale anche se il commit viene rifiutato.

## Esito durevole nell'audit esistente

Si riusa la meccanica del journal F10: identificatore di evento derivato dalla
chiave host, impronta del comando e ricevuta validata nell'evento append-only
`audit_events`. Non si riusano l'autorità o il writer F10 e non si aggiunge una
tabella di idempotenza. L'unico audit della modifica contiene metadati esatti
e versionati: riferimenti opachi, impronte, revisioni ed esito, senza note,
nomi, PIN, chiavi, ciphertext o nuovi identificatori clinici in chiaro.
L'evento viene riletto e verificato prima del commit: qualsiasi errore di
audit o ricevuta annulla anche la modifica del paziente.

Stessa chiave e contenuto restituiscono la stessa ricevuta; contenuto diverso
con la stessa chiave viene rifiutato. Un invio concorrente con altra chiave
e medesima versione perde il CAS. La risposta persa si risolve con una
lettura autorizzata dell'esito, anche dopo un riavvio e una nuova sessione del
medesimo autore e ambito. Il riferimento e l'impronta possono essere mantenuti
nell'URL della cartella; non contengono dati clinici. La lettura non riattiva
proof, permessi o esecutori. Nessuna ricevuta fornita dal client è accettata:
l'host restituisce soltanto l'evento verificato del proprio archivio, quindi
la UI rilegge lo stato corrente attraverso il servizio del profilo.

L'assenza di un evento non basta per concludere che nulla sarà salvato: un'altra
sessione può ancora completare una conferma. L'host restituisce `not_committed`
soltanto se ha ritirato la review corrispondente nell'owner corrente prima della
lettura. Negli altri casi, anche dopo un crash prima del commit, mantiene l'esito
non verificato (`503`) e la UI conserva il riferimento senza rieseguire il comando.
Alla scadenza di una review non ancora confermata, la UI può conservare soltanto
la bozza nel medesimo contesto, senza PIN, proof o rinnovo di revisione e selezione.

## Verifica e limiti

SQLite reale e owner reali: un successo con una modifica e un audit, replay
identico e conflitto, dinieghi essenziali, gara sulla versione, errori audit,
crash prima del commit e risposta persa dopo il commit. Verificare la UI su
build di produzione con dati sintetici e rilettura delle note salvate. Una
matrice negativa accerta che altre superfici non concedano questa capacità;
le operazioni 0.9 già qualificate mantengono i loro confini. La reversione
ritira la nuova capacità; gli eventi già commessi restano leggibili. Una
correzione clinica successiva è una nuova operazione esplicitamente riveduta.

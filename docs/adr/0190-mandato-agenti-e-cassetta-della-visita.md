# ADR 0190: Mandato agenti e cassetta della visita

Data: 2026-11-17. Stato: Accepted per le decisioni di prodotto di Leonardo.
Implementazione e prove di accettazione ancora da completare.

Riferimenti: WUL-866 e WUL-867..875, WUL-877 e WUL-878.
Il lavoro rientra nell'eccezione per il blocco del lavoro clinico di
[ADR 0185](0185-rotta-di-mediflow.md).

## Problema

Un agente deve poter depositare una visita mentre la scheda è bloccata,
senza ricevere la master key. Il deposito deve distinguersi dall'applicazione
clinica. L'identità del paziente deve dipendere dal codice fiscale e dalla
visita confermata. L'orario non identifica il paziente.

## Mandato e credenziali

Il medico crea un mandato nella UI fidata dopo lo sblocco con la credenziale
dell’account e la conferma con PIN. Sceglie durata, operazioni consentite e fornitore del
modello. La durata massima è 12 ore. Il fornitore attuale è OpenAI tramite
Codex. Il mandato deve dichiarare l'eventuale passaggio di trascrizione e
documenti a quel fornitore e le ricevute devono registrarlo. Un abbonamento
all'host non costituisce una credenziale API del provider.

Il browser genera una coppia ECDH P-256. Conserva sul server la chiave pubblica
e la privata avvolta dalla master key. Dopo un ricaricamento, la privata si
riapre solo nel browser sbloccato. Il server non riceve chiavi private aperte.
Il blocco per inattività toglie le chiavi dalla scheda ma lascia attivo il
mandato per il deposito. Revoca e blocco manuale revocano il mandato.
Scadenza e revoca negano ogni nuovo deposito, anche con un token già emesso.

Ogni agente chiede un abbinamento con codice di otto caratteri. Solo il
medico, confrontando il codice nella UI fidata, approva l'abbinamento. Per il
kit locale sullo stesso Mac dello stesso utente macOS, l'[ADR 0196](0196-collegamento-agente-locale-senza-codice.md)
ammette il collegamento diretto dalla UI fidata sbloccata senza codice, con
scrittura atomica delle credenziali nella cartella configurata del kit. Il
token opaco identifica agente, mandato, perimetro e scadenza, mai successiva
a quella del mandato. Il token locale preesistente non accede al canale
agenti. Il token agente non legge dati clinici decifrati, non conferma
visite e non sostituisce PIN o step-up. Non entra in chat, log o ricevute.
La CLI lo conserva con permessi 0600 fuori dalle cartelle sincronizzate.

Il perimetro ammette soltanto apertura della visita, allegato, trascrizione,
nota, proposta di terapia, prestazione, diagnosi, esenzione, osservazione e
chiusura della cassetta. Le route `/api/agent/v1/*` accettano soltanto il
canale loopback, senza fidarsi di indirizzi dichiarati dal chiamante. Il
proxy LAN non le inoltra. CLI e futuro MCP usano lo stesso contratto, senza
accesso diretto a SQLite, cookie, PIN o master key.

### Rinnovo allo sblocco

Il medico può scegliere «Rinnova allo sblocco» quando approva il codice di
un client, confermando col PIN il perimetro, il fornitore e l’eventuale
passaggio di documenti e trascrizioni già scelti. Ogni sblocco riuscito
con PIN o passphrase e ogni «Rinnova accesso» che ottiene la chiave da
un’altra scheda confermano il gesto nella sessione Web corrente. Il server
emette un mandato di 12 ore per ciascun client registrato, con il perimetro
approvato. Riusa la chiave pubblica e l’involucro registrati. La conferma
trasporta solo il ticket di login o l’identificativo del gesto, legato
alla stessa sessione e alla stessa generazione di archivio.
Il client Web ottiene la presenza di registrazioni attive dalla risposta
del login o dal controllo di sessione già in uso. Senza registrazioni
attive, lo sblocco non invia la richiesta di rinnovo.

La credenziale di registrazione consente al client di ritirare il token
di deposito del mandato corrente sul loopback. CLI e MCP, incluso il plugin
Ambulatorio, usano il client condiviso per il ritiro esplicito o automatico
quando il deposito richiede un mandato corrente. Blocco della sessione,
scadenza, nuova emissione e revoca negano richieste con il token precedente.
La revoca della registrazione in Agenti impedisce anche le emissioni
successive. Il ripristino automatico della scheda e il recupero col kit
non emettono mandati. Dopo il recupero, il rinnovo riparte al primo sblocco
normale riuscito. L’audit lega registrazione, medico, mandato e fornitore
al rinnovo. Le regole di applicazione della cassetta descritte qui sotto
valgono anche per questi mandati.

## Deposito e identità

Ogni visita ha una cassetta separata con identità durevole e revisione.
Ogni elemento è cifrato dal client con ECDH P-256, HKDF e AES-GCM per la
chiave pubblica del mandato. Il formato versionato deve legare il ciphertext
a mandato, cassetta, elemento e tipo, così che non si possa spostarlo fra
visite. Un test deve provare l'interoperabilità fra WebCrypto e Node,
l'alterazione del contenuto e il rifiuto con chiavi di un altro mandato.

Il server conserva solo ciphertext e metadati non clinici del deposito:
identificativi opachi, tipo, dimensioni, hash del PDF, proponente e tempi.
Anche l'àncora CF viaggia cifrata. Il CF dichiarato dall'agente resta da
confermare. Il resolver del CF legge i documenti nel browser alla revisione
o all'applicazione. Il canale agenti non manda al server il testo clinico
in chiaro per risolvere l'identità.

Un PDF è ammissibile soltanto se il CF letto coincide con l'àncora confermata
della visita. Il resolver esclude il CF del medico dal profilo e i
prescrittori noti senza nascondere CF discordanti di pazienti. WUL-878
consegna il nucleo di questa distinzione, da riusare. Un PDF con CF diverso
blocca la cassetta intera e la vista mostra i due CF al medico. Un CF assente,
non confermato o ambiguo impedisce l'applicazione automatica. La creazione di
un paziente assente richiede PIN. Percorsi espliciti o hash identificano i
file da depositare. L'orario può ordinare le visite, mai abbinarle.

## Applicazione e vista In arrivo

Alla chiusura della cassetta la scheda MediFlow sbloccata applica senza un
altro gesto soltanto nota di visita, trascrizione e PDF con identità
coincidente e confermata. Se la scheda è bloccata, lo fa al primo sblocco
successivo. Il medico ha autorizzato questo comportamento nel mandato.
L'[ADR 0195](0195-materiale-dell-agente-dopo-il-gesto-del-medico.md) sostituisce questo passaggio: nessun
elemento della cassetta entra più senza il gesto del medico.

Terapie, prestazioni, diagnosi, esenzioni e osservazioni attendono un gesto
nella vista «In arrivo», che mostra paziente, fonti, differenze e dubbi.
Sono disponibili «Applica la visita» e «Applica tutte le visite senza dubbi».
Una visita con dubbi è esclusa dal secondo comando. Le codifiche restano
proposte, senza codici inventati o selezionati dal modello al posto del medico.

Una cassetta mista conserva separatamente i due passaggi: il primo applica
insieme tutti gli elementi ammessi senza gesto e lascia le proposte in attesa,
il secondo applica insieme gli elementi confermati. Un PDF discordante
impedisce anche il primo passaggio. Ogni passaggio registra gli elementi
consumati nella stessa transazione delle scritture, per evitare duplicati
al nuovo sblocco, al retry o con più schede aperte. L'automatismo non può
convertire una proposta strutturata in una nota per aggirarne la conferma.

Il browser decifra e prepara i valori per i writer esistenti con la master
key. Un solo commit SQLite IMMEDIATE deve comprendere tutte le scritture del
passaggio, verifica della revisione attesa, ammissione corrente del paziente,
audit e ricevuta. Un errore, una revoca concorrente o una revisione cambiata
lasciano zero scritture del passaggio. La ricevuta riporta «non applicata»
e la cassetta resta recuperabile. Nessun successo parziale è ammesso.

L'autore è il medico autenticato, con `actorType=user` e `recorded_by` secondo
[ADR 0183](0183-autore-delle-voci-di-diario.md). Agente proponente e mandato
sono campi distinti, insieme alla superficie `agent` e al fornitore dichiarato.
L'audit sta nella stessa transazione della scrittura. Schema 12 richiede
apertura versionata, originale v11 verificato e recuperabile, riapertura senza
DDL e prove di rollback della migrazione secondo ADR 0080.

## Emendamenti espliciti

| ADR | Modifica limitata al nuovo canale |
| --- | --- |
| [0084](0084-document-diagnoses-review-only.md) | Nota, trascrizione e PDF verificati possono entrare secondo il mandato. Le diagnosi restano proposte da confermare. Il percorso Fabric esistente resta invariato. |
| [0094 D5/D6](0094-intelligence-fabric-headless-contract-085.md) | Il deposito diventa `mandated_proposal`. Per i soli elementi ammessi senza gesto, il mandato autorizza l'applicazione condizionata alla verifica corrente. Per le altre voci serve la conferma per visita o lotto. Restano revisione attesa, audit e ricevuta. |
| [0097](0097-active-role-session-and-step-up-authorization.md) | Il PIN nella UI fidata autorizza il mandato a tempo. Il token agente non è uno step-up riusabile e non concede commit clinico. I vecchi contratti monouso non vengono riattivati. |
| [0113](0113-recording-visita-trascrizione-locale-085.md) | La trascrizione può nascere nella CLI locale ed entrare nella cassetta. Il suo testo può essere applicato secondo il mandato. Audio solo in memoria, eventuale invio al modello dichiarato e registrato. |
| [0176](https://github.com/Wulfgardr/mediflow/blob/cd20934e20afaf37c283a18966ac5ea72b8d1a31/docs/adr/0176-estrazione-preparata-per-il-dossier.md) | Il nuovo canale ammette nota e trascrizione come fonti della visita e il passaggio senza gesto sopra delimitato. Le proposte strutturate richiedono ancora conferma. |
| [0103](0103-headless-clinician-authorized-soap-entry-write.md) | La cassetta è il nuovo canale di deposito, senza ripristinare il runtime SOAP ritirato. |
| [0114](0114-intelligent-host-aip-mcp-isolation.md), [0117](0117-headless-portable-agent-first-and-capability-first-fabric.md) | Il nuovo trasporto inoltra il token agente con perimetro, senza accesso al database o alle credenziali cliniche. |
| [0116](0116-agentic-checkup-status-transition.md) | La conferma fidata del nuovo canale può riguardare una visita o un lotto esplicito. Il contratto checkup esistente resta distinto. |
| [0143](0143-strong-unlock-credential.md) | La master key avvolge la privata del mandato. La condivisione della CryptoKey fra schede dello stesso browser e «Rinnova accesso» non distruttivo richiedono le prove di WUL-877. La custodia nativa resta rinviata. |
| [0096](0096-owner-sessione-selezione-e-lifetime-broker.md) | L'identità del paziente è legata alla cassetta, senza dipendere dalla selezione condivisa. |
| [0175](https://github.com/Wulfgardr/mediflow/blob/cd20934e20afaf37c283a18966ac5ea72b8d1a31/docs/adr/0175-dossier-import-da-cartella.md) | Nel canale agenti il resolver gira nel browser e distingue i CF dei prescrittori da quelli dei pazienti. |
| [0183](0183-autore-delle-voci-di-diario.md) | Proponente e mandato si aggiungono all'autore, senza riscrivere l'attribuzione storica. |
| [0187](https://github.com/Wulfgardr/mediflow/blob/cd20934e20afaf37c283a18966ac5ea72b8d1a31/docs/adr/0187-network-ingress-and-commit-authority.md) | Il proxy LAN esclude `/api/agent/v1/*`. |

[ADR 0165](0165-native-chat-access-channel.md) e ADR 0172 conservano i
propri confini: la trascrizione GPUI non passa alla chat, nessuna passphrase
resta in una seconda sessione. I claim congelati WUL-342/354 non cambiano.
Questo ADR descrive un contratto da verificare, senza nuove garanzie pubbliche
sulla cifratura dell'intero archivio.

## Vincolo prima di A5

Prima di implementare l'applicazione si deve provare che i writer si
compongano in una sola transazione. Se manca un nucleo utilizzabile nella
transazione chiamante, l'implementazione si ferma e riporta le opzioni.
Chiamare i writer uno dopo l'altro o ignorarne le Promise non è accettabile.

La prova iniziale è documentata in
[verifica della composizione](../analysis/2026-11-17-agent-writer-composition.md).
La sua mancata riuscita non autorizza la consegna di applicazioni parziali.

## Accettazione

Le prove delle singole issue devono fallire sulla base e passare sulla
modifica, usando soltanto dati e archivi sintetici. La prova finale usa tre
chat o CLI che depositano dieci visite mentre la scheda è bloccata, con due
ricette contenenti il CF del medico ed un PDF di un altro paziente. Dopo lo
sblocco gli elementi ammessi entrano senza gesto, le proposte strutturate
attendono la conferma, la visita discordante resta bloccata. Si verificano
assenza di scritture parziali e di frasi sintetiche note in chiaro nel deposito.
Video o screenshot devono mostrare il percorso del medico. Una prova tecnica
non costituisce ammissione all'uso clinico.

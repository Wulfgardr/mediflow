# Configurazione ICD-11 WHO locale — candidato 0.8.6

La scelta vigente e il sidecar WHO locale, dietro l'Application Service
server-only di [ADR 0115](./adr/0115-icd11-who-reference-data-adapter.md).
Il vecchio container MediFlow e la porta `8888` restano ritirati. Non esiste fallback a
ICD-9, a JSON WHO grezzo o al servizio WHO remoto. Non sono richieste credenziali
OAuth. Il candidato comprende Search, stato e una procedura guidata con installer locale
a comandi fissi. Il server Web non esegue Docker.

Il [manifesto](./who-local-sidecar.manifest.json) distribuito ha lock obbligatori
non valorizzati: ogni installazione deve registrarli fuori Git. Il 7 settembre
2026 un deployment ARM64 di prova ha completato acquisizione, Search, riavvio
offline e ripristino dopo l'accettazione esplicita dell'operatore. Questa prova
non accetta i termini per altri utenti e non attiva servizi nelle installazioni.

## Configurazione server e stato

Il servizio e disattivato per default. Solo il processo server legge:

| Variabile | Valore |
| --- | --- |
| `MEDIFLOW_ICD_WHO_ENABLED` | `1` dopo il provisioning verificato |
| `MEDIFLOW_ICD_WHO_LOCAL_IMAGE_DIGEST` | Digest reale `sha256:<64 hex>` dell'immagine bloccata |
| `MEDIFLOW_ICD_WHO_LOCAL_DATASET_ID` | Identita `sha256:<64 hex>` dello snapshot inventariato |

Sono identificatori dichiarati dall'host, non attestazioni del contenuto del
sidecar. Le variabili vengono rilette al confine delle operazioni; cambiare
un file esterno non aggiorna automaticamente l'ambiente del processo.
Iniettare la configurazione tramite il supervisore previsto sul target.
Le precedenti variabili di rete e credenziali OAuth non sono lette dal locale.

Destinazione fissa `http://127.0.0.1:8382`, Search v2, release `2026-01`, MMS,
inglese. Nessun URL fornito dal browser, proxy o redirect. Limiti: query 160
byte UTF-8, 25 risultati restituiti, risposta 64 KiB, transport 5 s e audit 1 s.
L'audit conserva una proiezione esplicita della receipt validata, senza query,
codici, descrizioni o URI: `counts` contiene `resultCount`; i flag `schema`,
`operation`, `deployment`, `source`, `release`, `language`, `binding`, `image`,
`dataset`, `latencyMs`, `fetchedAt`, `expiresAt`, `completedAt` conservano i
rispettivi valori. `binding/image/dataset` corrispondono a
`bindingId/imageDigest/datasetSnapshotId`. I digest SHA-256 restano interi:
le chiavi brevi rispettano il limite di 80 caratteri del sanitizer audit.

Entro i 64 KiB il parser valida tutte le voci upstream, anche quelle oltre la
venticinquesima, e conserva l'ordine WHO. Restituisce le prime 25 con
`partial=true` se altre sono omesse o WHO segnala `resultChopped`. Una voce
malformata, codici/URI duplicati o un body oltre 64 KiB negano la risposta.
Le combinazioni di codici conservano il codice completo e un riferimento
ufficiale CodeInfo, dopo la verifica dei componenti restituiti da Search.
Questo riferimento non attesta una verifica clinica o una chiamata CodeInfo
per ciascun risultato. Search cerca termini. **Verifica codice WHO**, nei
Repertori o accanto a una diagnosi ICD-11, avvia invece CodeInfo e la lettura
del titolo del codice base: codice riconosciuto, non trovato e servizio non
disponibile sono esiti distinti. La cartella non viene modificata dal controllo.
Una fonte che dichiara una release diversa viene segnalata, senza ricodifica.
Per combinazioni, il titolo inglese mostrato riguarda esplicitamente il codice
base, non l'intera combinazione.

- `disabled`: opt-in assente;
- `configuration_required`: identificatori assenti o invalidi;
- `configured`: configurazione presente, risposta diretta recente non osservata;
- `available`: ricerca diretta riuscita nel binding corrente nelle ultime 24 ore;
- `unavailable`: tentativo diretto/audit fallito.

`configured` non equivale a `available`. Leggere lo stato non invia ricerche.
**Impostazioni → Diagnostica → Verifica con termine di esempio** interroga
solo al clic il termine pubblico `cholera`. La UI distingue risposta diretta,
cache e fallimento; una cache hit non ristabilisce la disponibilita del sidecar
e non aggiorna il tempo dell'ultimo successo diretto.

Cache solo RAM: 256 chiavi/4 MiB, TTL assoluto 24 ore senza rinnovo su hit.
Binding, immagine e dataset separano le chiavi. Disable, cambio configurazione,
dispose o clock regressivo invalidano cache e risultati pendenti. Il listener
loopback non autentica gli altri processi locali dell'host.

## Percorso ordinario sul Mac: tre passi

La procedura ordinaria non richiede hash, editing JSON o configurazione di
variabili. Il percorso supportato e **macOS Apple Silicon**, con Node 24 gia
previsto da MediFlow e un motore Docker locale Linux ARM64. Windows e Linux
non sono ancora supportati dal nuovo onboarding.

1. Sul Mac che ospita MediFlow, avvia Docker Desktop o il runtime locale scelto.
   La procedura ne verifica la disponibilita; se esistono piu contesti locali,
   propone una scelta numerata. Non installa o modifica VM e non cambia il
   contesto Docker predefinito.
2. Nella cartella MediFlow, apri **Setup_WHO.command**, oppure esegui:

   ```bash
   ./Setup_WHO.command
   ```

   La procedura mostra versione, lingua, termini WHO e operazioni previste.
   Scrivere `ACCETTO` registra il gesto locale per WHO ICD API 2.6.0 / ICD-11
   MMS 2026-01 inglese e autorizza download e verifiche del solo nuovo servizio.
   Non si richiedono credenziali WHO. Se Docker manca, la porta e occupata o il
   servizio esistente non appartiene alla procedura, compare un blocco leggibile;
   quel servizio non viene adottato, sostituito o interrotto.
3. Attendi le verifiche e scegli l'avvio di MediFlow proposto al termine.
   **Avvia MediFlow con WHO**, creato nella cartella privata del setup, carica
   automaticamente la configurazione anche negli avvii successivi. Un server
   gia attivo non viene interrotto: il collegamento si usa al prossimo avvio.
   In MediFlow premi **Rileggi configurazione** e **Verifica con termine di
   esempio**. Configurato, risposta diretta e cache restano stati distinti.

La UI ordinaria espone solo questi tre passaggi. I dettagli sono nella
sezione **Per chi gestisce il server**. Il comando e una procedura host: il
browser non riceve autorita Docker e non esegue installazioni.

### Cosa viene preparato automaticamente

Il release-lock `who-local-release-lock.json` contiene metadati pubblici
verificati nel registry ufficiale il 7 settembre 2026. La procedura verifica
SHA-256 dell'indice OCI, del manifesto ARM64 e della receipt pubblica di
acquisizione dei metadati prima di usarli. Docker acquisisce l'immagine al
digest, non a `latest`. Questa e una verifica del lock distribuito, non una
nuova osservazione del registry a ogni avvio. Le evidenze non contengono
accettazione dell'operatore, snapshot, hash dataset o prove di altri deployment.

Il setup conserva in `~/Library/Application Support/MediFlow/WHO/2026-01_en`
una registrazione privata dell'installazione, il gesto di licenza, manifesto,
configurazione, snapshot e receipt. Directory 0700, metadati/configurazione
0600; i cinque file snapshot mantengono 0644 dentro la directory privata,
per ripristinare i metadati 0:0/0644 verificati nel container. Il dataset
osservato occupa 493.455.110 byte; immagine, copia locale e container di
ripristino richiedono ulteriore spazio. Non e una stima del totale.

Il consenso riguarda la specifica installazione, identificata con UUID e
container ID. Il setup non riusa l'accettazione del deployment di prova.
Container e network creati hanno una label di ownership controllata prima
delle operazioni: nessuna adozione da un solo nome, nessun `Config.Env`,
log generico, segreto, intera `/tmp` o database clinico.

### Qualifica calcolata sul proprio deployment

La procedura esegue automaticamente questi controlli, senza checkbox di prova:

- verifica Search sul catalogo acquisito con un termine pubblico fissato;
- ferma soltanto il proprio container e copia i cinque file previsti per
  questa release, controllando tipo, dimensione e permessi; calcola SHA-256 e
  inventario dai byte della nuova copia, senza hash del deployment precedente;
- collega una rete Docker interna, scollega bridge a container in esecuzione
  e riavvia senza rete esterna; verifica network interno senza IPv6/default
  route prima e dopo una nuova Search;
- crea un secondo container della stessa immagine sulla sola rete interna,
  ripristina i cinque file e prova un altro termine pubblico; confronta byte,
  hash e metadati dei file ripristinati;
- ferma la copia di prova, riporta il proprio container su bridge e ne controlla
  di nuovo ownership, file e hash. La copia e la rete vengono conservate,
  senza rimozioni automatiche.

La receipt lega ogni tentativo a installazione, container original/restored,
immagine, network, inventario, esiti e timestamp. Solo tutti i controlli riusciti
producono `offlineRestartVerified/restoreVerified` e configurazione abilitata.
Un fallimento conserva receipt incompleta e snapshot, disabilita il file di
configurazione per gli avvii successivi e tenta il recupero del solo servizio
posseduto. Non modifica l'ambiente di un processo MediFlow gia in esecuzione.
Se anche il recupero fallisce, segnala l'intervento necessario del gestore.

Le prove attestano la topologia Docker interna osservata senza default route,
non un isolamento generale da qualsiasi egress dell'host. I probe misurano
risposte WHO bounded e non sostituiscono il parser/DTO runtime, la verifica
applicativa autenticata o una valutazione clinica.

La sequenza segue le semantiche documentate di
[Docker network disconnect](https://docs.docker.com/reference/cli/docker/network/disconnect/)
(container in esecuzione) e
[Docker cp](https://docs.docker.com/reference/cli/docker/container/cp/)
(copia anche da container fermo, proprietario destinazione e permessi conservati).

### Per chi gestisce il server

```bash
./Setup_WHO.command status
./Setup_WHO.command qualify
./Setup_WHO.command start
```

`status` legge soltanto lo stato del servizio registrato e non lo qualifica.
`qualify` richiede conferma interattiva e ripete prove sul solo deployment
creato dalla procedura; non accetta receipt/booleani forniti dall'utente.
`start` carica automaticamente le tre variabili WHO dal manifesto qualificato
nel launcher MediFlow, preserva le altre impostazioni e nega l'avvio se il
server e gia in esecuzione sulla porta prevista. Non apre una nuova API.

Una seconda esecuzione ordinaria riusa la propria installazione qualificata
senza download o nuove prove. Un tentativo incompleto resta riprendibile;
la concorrenza e bloccata da un lock privato. Dopo un'interruzione forzata il
gestore deve verificare il processo e lo stato delle sole risorse registrate
prima di rimuovere il lock: non viene cancellato automaticamente per eta.

La CLI tecnica `scripts/who-local-setup.mjs` resta disponibile per deployment
preesistenti gestiti separatamente: `init`, `plan`, `status`, `install`,
`configure` con le opzioni mostrate da `--help`. Non costituisce onboarding
ordinario e non trasferisce prove o ownership alla nuova procedura.

**Limite del candidato:** nuova orchestrazione, errori e recupero sono coperti
con Docker sintetico e file temporanei reali; non e stata eseguita una nuova
installazione live. Il deployment gia qualificato non e stato riprovato. Una
prova live del nuovo installer su risorse/porta separate richiede ownership e
autorizzazione del parent. Non chiamare il percorso live qualificato sulla sola
base dei test o della fixture UI.

## Procedura tecnica per deployment gestiti separatamente

1. Copiare il manifesto fuori Git e verificare target, risorse, disponibilita
   della porta e runtime container. Il candidato fissa `linux/arm64`; non prova
   la compatibilita o installabilita di uno specifico Mac.
2. Verificare nel registry primario `registry-1.docker.io` il riferimento
   `whoicd/icd-api:2.6.0` e il manifesto della piattaforma. Registrare digest
   reale, data e hash dell'evidenza conservata fuori Git. Non usare `latest`,
   hash sintetici o un digest copiato dal vecchio packet senza nuova verifica.
3. L'operatore valuta e, se decide, accetta espressamente i
   [termini WHO](https://icd.who.int/en/docs/icd11-license.pdf). Registrare fuori
   Git data e riferimento opaco alla decisione: la scelta del sidecar non e
   accettazione dei termini. Controllare i prerequisiti locali con:

   ```bash
   node scripts/check-who-local-sidecar-manifest.mjs --stage provision --manifest /percorso/manifesto-locale.json
   ```

   Il comando valida solo struttura e registrazioni: non verifica il registry,
   la validita della decisione o gli artefatti, e non esegue il provisioning.
4. Solo dopo questi gate e l'autorizzazione operativa ottenere l'immagine
   bloccata e creare manualmente un nuovo container identificabile. Parametri:
   bind `127.0.0.1:8382` verso porta container `80`, `include=2026-01_en`,
   `saveAnalytics=false`, `enableDoris=false`, `fhirSupport=false`;
   `acceptLicense=true` solo dopo il passo 3. Nessun mount clinico/socket Docker,
   avvio automatico o modifica globale. WHO documenta rete necessaria per
   immagine e primo caricamento del dataset; cio non autorizza traffico clinico.
5. Inventariare il dataset effettivamente acquisito e lo snapshot ripristinabile,
   conservando identita e hash dell'inventario. Il digest dell'immagine non e il
   digest del dataset. Il metodo supportato di snapshot/ripristino va verificato
   sul target; questo candidato non inventa percorsi interni, volumi o modifiche
   al software WHO. Se il ripristino non e ripetibile, l'attivazione resta bloccata.
6. Verificare con termini sintetici binding, Search, riavvio senza rete con nuove
   query e ripristino; osservare risorse ed egress del processo. Registrare le
   prove prima del controllo di attivazione:

   ```bash
   node scripts/check-who-local-sidecar-manifest.mjs --stage activate --manifest /percorso/manifesto-locale.json
   ```

   Soltanto dopo una verifica positiva sul target iniettare i due identificatori
   e l'opt-in server. Il checker non sostituisce queste prove.
7. Per aggiornamenti creare un deployment distinto, ripetere lock e verifiche
   e conservare il precedente recuperabile. Rollback: disabilitare Search e
   fermare solo il container candidato identificato; niente rimozioni globali.

Il manifesto distribuito fallisce intenzionalmente entrambi i gate finche le
registrazioni obbligatorie sono assenti. Non esiste avvio automatico dal server Web MediFlow.

## Prova locale del 7 settembre 2026

La prova usa l'immagine ufficiale `whoicd/icd-api:2.6.0`, piattaforma
`linux/arm64`, verificata nel registry e bloccata al digest
`sha256:7555e43478202d3f9a25eeb2914cc5053414c9464ec6a9a7628c01375d5b0a5e`.
Il runtime Colima dedicato usa 2 CPU e 3 GiB di RAM assegnati, senza mount
utente, analytics o cambio del contesto Docker predefinito. Queste sono risorse
assegnate alla prova, non requisiti minimi misurati per ogni target.

- Search locale: `cholera` restituisce 16 risultati, incluse combinazioni.
- Riavvio senza route di rete esterna: nuova ricerca `measles` riuscita.
- Ripristino su un nuovo container della stessa immagine: nuova ricerca
  `rubella` riuscita senza route esterna; cinque hash del dataset corrispondono.
- Application Service MediFlow: risposta diretta, nessun risultato e cache
  verificati, con DTO validato e audit raccolto dal probe. Questa prova non
  attraversa ancora la route HTTP autenticata o l'interfaccia del paziente.
- CodeInfo attraverso l'Application Service e il sidecar reale: `1A00` e
  `1A00&XN8P1` riconosciuti, titolo del codice base recuperato; `ZZ9999` non
  trovato. Tre receipt dedicate validate dal client, senza uso del database
  paziente. La verifica non usa cache e non converte codici o release.

Le due prove offline interrogano il loopback **dentro il container**: il network
Docker interno non esponeva la porta al Mac. Dopo il ripristino, il binding
host `127.0.0.1:8382` e stato verificato separatamente con il bridge ripristinato.
Non si deduce da queste prove un isolamento generale da ogni possibile egress.

Lo snapshot inventaria i soli cinque file del dataset osservati sotto `/tmp`
nel container fermo: 493.455.110 byte totali, identita
`sha256:ecf3b894425d5cfb7514868d554eb086a7b5e7284ef212d2bb230a84b523b825`.
Non include l'intera directory temporanea o lo stato del servizio. Le copie
di archivio restano private; nel container vanno ripristinati proprietario
`root:root` e permessi originali `0644`. Un primo tentativo con file `0600`
falliva durante la riscrittura dell'indice; ripristinare i metadati originali
ha consentito avvio e ricerca. Nessuna modifica al software o all'immagine WHO.

Inventario, hash, accettazione, fallimento iniziale e verifiche di recupero sono
conservati nel packet locale dell'operatore, fuori Git. Questo metodo e stato
osservato su quel target e quella immagine: non costituisce un installer
qualificato per Windows, Linux o per futuri aggiornamenti WHO.

## Verifica del candidato e limite di consegna

Le fixture coprono Search locale, route autenticata, client, stato passivo,
limiti, cache, timeout e manifesto. Non usano un servizio WHO o un corpus reale.

```bash
node scripts/run-strip-types.mjs --test lib/reference-data/icd11-who-local-*.test.ts
node scripts/run-strip-types.mjs --test lib/reference-data/icd11-who-code-check.test.ts lib/reference-data/icd11-who-production.test.ts
node --test scripts/check-who-local-sidecar-manifest.test.mjs scripts/who-local-setup.test.mjs scripts/who-local-onboarding.test.mjs
```

Il DTO v2 conserva codice, titolo, URI canonico, partial e identita della fonte;
il client mantiene la lettura separata del DTO v1. La selezione nel modulo
paziente conserva `canonicalUri/reference` attraverso schema client, salvataggio
nel JSON `diagnoses` gia cifrato e rilettura. Questi campi sono opzionali per i
record storici/manuali; non vengono inventati URI per codici preesistenti.
`reference` contiene metadati aggiunti da MediFlow, non prodotti da WHO.
Il codice della selezione WHO e in sola lettura: sostituire/cancellare la
selezione tramite la ricerca. Una nuova ricerca libera azzera codice e fonte.
Nessuna nuova colonna SQLite, route o modifica alla cifratura. I test del modulo
e la fixture E2E verificano questo percorso con dati sintetici e DB temporaneo
marcato, senza copiare il DB sorgente.
Il codec `MediFlowCore.DiagnosesCodec` conserva gli stessi campi opzionali nel
decode/encode usato dall'editor nativo, senza Search o validazione WHO nativa.
I riferimenti restano JSON opaco; campi nil non aggiungono chiavi ai record
precedenti. I test Core verificano round-trip, forma storica e fonti sconosciute.
Il modulo web tratta i due campi opzionali null come assenti, senza riscrivere
diagnosi invariate; una modifica effettiva omette le chiavi vuote. Le prove di
round-trip includono questi record, oltre alle selezioni WHO con fonte completa.
Export, altri caller, migrazioni storiche, certificazione
e prova UI autenticata WHO restano da completare; il §1.2.3 dei termini WHO
resta un requisito da valutare anche per tali flussi prima della promozione.

Fonti primarie WHO consultate il 2026-09-06:
[deployment locale](https://icd.who.int/docs/icd-api/ICDAPI-LocalDeployment/),
[container e opzioni](https://icd.who.int/docs/icd-api/ICDAPI-DockerContainer/),
[release/lingue](https://icd.who.int/docs/icd-api/SupportedClassifications/),
[release 2.6](https://icd.who.int/docs/icd-api/ReleaseNotes-Version2.6/).
MMS inglese 2026-01 e disponibile; non viene proposta una traduzione italiana.

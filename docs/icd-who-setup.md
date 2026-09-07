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

## Percorso guidato locale

In **Impostazioni > Terminologia WHO > Configura WHO locale passo per passo**
la guida accompagna prerequisiti, manifesto/termini, installazione/configurazione
ed esempio Search. I comandi si eseguono sul computer del server, dalla cartella
MediFlow, con Node.js 24. La pagina non legge file locali, esegue Docker o salva
consensi. Le conferme della guida sbloccano soltanto la copia dei comandi; la CLI
valida nuovamente il manifesto e la conferma esatta.

Prerequisiti: motore Docker Linux ARM64 gia avviato, contesto esplicito con
socket Unix locale, porta 8382 disponibile per nuove installazioni, spazio per
immagine, dataset e snapshot. Il dataset osservato occupa 493.455.110 byte;
questo non e una stima dello spazio totale o un requisito minimo universale.
Con Colima scegliere il contesto del profilo locale previsto: la CLI non crea
VM, cambia contesto globale o installa il runtime host. Se Docker non risponde,
il risultato indica di avviare il runtime scelto e ripetere `status`.

Creare una cartella privata fuori Git e sostituire i percorsi di esempio:

```bash
node scripts/who-local-setup.mjs init --manifest /percorso/privato/who-manifest.json
node scripts/who-local-setup.mjs plan --manifest /percorso/privato/who-manifest.json
```

`init` crea il template con permessi 0600 senza sovrascritture. Compilare con un
editor il lock del registry e l'accettazione esatta secondo i passi 2–3 della
procedura sottostante. Nessun valore sintetico o consenso precompilato. `plan`
mostra separatamente i campi mancanti per provisioning e attivazione; non usa
Docker o rete e non verifica la veridicita delle registrazioni.

**Deployment gia esistente:** usare il manifesto qualificato e il nome esatto
del container. `status` legge solo contesto locale, architettura, digest, stato,
porte, numero mount e policy runtime; non legge `.Config.Env`, log, segreti,
dataset o DB. Non interroga WHO e non modifica il servizio.

```bash
node scripts/who-local-setup.mjs status --manifest /percorso/privato/who-manifest.json --context CONTESTO --container CONTAINER_WHO
```

**Solo nuova installazione**, dopo licenza e registry lock: questa conferma
abilita acquisizione dell'immagine fissata e avvio del solo nuovo container
`mediflow-who-2026-01-guided`. L'acquisizione iniziale del dataset richiede rete. Il manifesto di una nuova
installazione deve avere snapshot non valorizzati e prove offline/ripristino
false: non puo ereditare la qualifica di un altro deployment.

```bash
node scripts/who-local-setup.mjs install --manifest /percorso/privato/who-manifest.json --context CONTESTO --confirm install-who-2.6.0-2026-01_en
```

Nessun URL, immagine, comando shell o argomento Docker libero. Sono fissati
versione/piattaforma, include, bind loopback, consenso gia registrato, analytics,
DORIS e FHIR disabilitati, zero mount e nessun riavvio automatico. Container
omonimo o porta occupata bloccano prima del download. Fallimenti di pull,
creazione o avvio indicano la fase; nessun cleanup distruttivo o retry automatico.
L'avvio non prova acquisizione completa, Search, offline o ripristino. Completare
i passi 5–6 della qualifica; per il deployment gia qualificato riusare le prove
pertinenti, senza ripetere download, riavvio o ripristino per il solo wizard.

**Attivazione:** dopo manifesto valido per `activate` e metadati del container
in esecuzione coerenti, il comando scrive un nuovo file 0600 con le sole tre
variabili server. Per il container creato dalla guida omettere `--container`.

```bash
node scripts/who-local-setup.mjs configure --manifest /percorso/privato/who-manifest.json --context CONTESTO --container CONTAINER_WHO --output /percorso/privato/who.env --confirm enable-who-2026-01_en
```

Caricare `who.env` nel successivo avvio autorizzato del supervisore. Con Node 24
si usa `node --env-file=/percorso/privato/who.env <entrypoint>`: conservare
entrypoint, directory dati, porta e opzioni del deployment. Le variabili gia
esportate hanno precedenza sul file. La CLI non avvia o riavvia MediFlow e non
sostituisce `.env.local` o file esistenti. Per sviluppo, con directory dati
esplicitamente scelta e server precedente gia arrestato dal suo gestore:

```bash
MEDIFLOW_DATA_DIR=/percorso/dati/mediflow node --env-file=/percorso/privato/who.env node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3000
```

Poi premere **Rileggi configurazione** e **Verifica con termine di esempio**:
la risposta diretta e distinta dalla cache, dagli errori e dallo stato soltanto
configurato. Per disabilitare al successivo avvio impostare
`MEDIFLOW_ICD_WHO_ENABLED=0`, preservando manifesto/snapshot. Nessun OAuth WHO.

Le prove sintetiche della CLI e del wizard non qualificano una nuova
installazione end-to-end. Il riscontro metadata-only sul deployment esistente
non riverifica dataset, opzioni d'ambiente, licenza o integrita del runtime.

## Provisioning manuale sul target autorizzato

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
node --test scripts/check-who-local-sidecar-manifest.test.mjs scripts/who-local-setup.test.mjs
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

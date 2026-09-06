# Configurazione ICD-11 WHO locale — candidato 0.8.6

La scelta vigente e il sidecar WHO locale, dietro l'Application Service
server-only di [ADR 0115](./adr/0115-icd11-who-reference-data-adapter.md).
Il vecchio container MediFlow e la porta `8888` restano ritirati. Non esiste fallback a
ICD-9, a JSON WHO grezzo o al servizio WHO remoto. Non sono richieste credenziali
OAuth. Il candidato comprende Search, stato e configurazione: non un installer.

Il [manifesto](./who-local-sidecar.manifest.json) ha lock obbligatori non
valorizzati; provisioning e attivazione sono bloccati. Questa consegna non
installa servizi, non scarica immagini/dataset e non accetta termini.

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
byte UTF-8, 25 risultati restituiti, risposta 64 KiB, transport 5 s e audit 1 s. L'audit
conserva solo la receipt, senza query, codici o descrizioni.

Entro i 64 KiB il parser valida tutte le voci upstream, anche quelle oltre la
venticinquesima, e conserva l'ordine WHO. Restituisce le prime 25 con
`partial=true` se altre sono omesse o WHO segnala `resultChopped`. Una voce
malformata, codici/URI duplicati o un body oltre 64 KiB negano la risposta.

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

## Provisioning manuale, in una futura sessione autorizzata

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
registrazioni obbligatorie sono assenti. Non esiste avvio automatico da MediFlow.

## Verifica del candidato e limite di consegna

Le fixture coprono Search locale, route autenticata, client, stato passivo,
limiti, cache, timeout e manifesto. Non usano un servizio WHO o un corpus reale.

```bash
node scripts/run-strip-types.mjs --test lib/reference-data/icd11-who-local-*.test.ts
node --test scripts/check-who-local-sidecar-manifest.test.mjs
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
Export, altri caller, migrazioni storiche, lookup/cross-check, certificazione
e prova live WHO restano fuori da questa consegna; il §1.2.3 dei termini WHO
resta un requisito da valutare anche per tali flussi prima della promozione.

Fonti primarie WHO consultate il 2026-09-06:
[deployment locale](https://icd.who.int/docs/icd-api/ICDAPI-LocalDeployment/),
[container e opzioni](https://icd.who.int/docs/icd-api/ICDAPI-DockerContainer/),
[release/lingue](https://icd.who.int/docs/icd-api/SupportedClassifications/),
[release 2.6](https://icd.who.int/docs/icd-api/ReleaseNotes-Version2.6/).
MMS inglese 2026-01 e disponibile; non viene proposta una traduzione italiana.

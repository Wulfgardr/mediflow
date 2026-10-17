# Trial di tsc-ts sul typecheck di Mediflow

Data: 2026-10-17. Sorgente misurata:
`670d36d154b98d84ddbc0d68a70b9ba3ef996e2a`, tree
`0f33f12009c14f1c6f29d46a935a9dfac54b3a49`.

Il trial CLI è positivo: TypeScript 5.9.3, `tsc-ts` 0.0.2 e TypeScript
ufficiale 7.0.2 completano ciascuno tre typecheck dello stesso snapshot,
senza diagnostiche. In questo campione locale, la mediana di `tsc-ts` è
1,669 secondi, contro 4,380 del motore ufficiale 7.0.2 e 30,513 della
baseline 5.9.3. Il riferimento ufficiale TS7 consente di confrontare due
implementazioni native sul medesimo grafo effettivamente risolto.

La [ricevuta compatta](../../experiments/gpui-patient-pilot/evidence/connected/tsc-ts-typecheck-validation.json)
contiene i nove campioni, exit code, tempi CPU, RSS, integrità dei quattro
pacchetti, hash dei motori, degli ingressi e dei manifest completi.
Il [driver pubblicato](../../experiments/gpui-patient-pilot/comparison/typecheck-benchmark.py)
è byte-identico a quello eseguito, SHA-256
`9975a1ca971f2a4f939d21441941a977c5f198d3bf39d6fa0036f3675b6ae8a1`.

## Che cosa viene qualificato

Il repository [vercel-labs/tsc-ts](https://github.com/vercel-labs/tsc-ts)
descrive un port sperimentale in TypeScript del compilatore TS7, compilato
in eseguibile nativo con `scriptc`. Il pacchetto provato è `tsc-ts@0.0.2`;
il suo `--version` riporta `Version 7.0.2`. Il motore di riferimento
proviene dai pacchetti ufficiali `typescript@7.0.2` e
`@typescript/typescript-linux-x64@7.0.2`.

Lo sviluppo ufficiale risiede in
[microsoft/TypeScript](https://github.com/microsoft/TypeScript); il
[precedente repository typescript-go](https://github.com/microsoft/typescript-go)
è archiviato e rimanda a quello attuale. Il confronto usa i pacchetti
precompilati verificati, senza compilare gli upstream. I requisiti Go
della build da sorgente non sono necessari per questa prova.

Il risultato riguarda il comando di typecheck. Non modifica la migrazione
Rust/GPUI, il writer dei pazienti o i relativi gate di rilascio. Il lavoro
sul confine applicativo rimane descritto nel
[verbale della porta profilo](./2026-10-17-patient-profile-port.md).

## Provenienza e configurazione

La misura è stata rifatta dopo la perdita dell'ambiente temporaneo. Tutti
i numeri della tabella seguente derivano dalle nuove esecuzioni; nessun
hash di pacchetto o file è stato ricostruito a memoria.

Lo snapshot proviene da `git archive` del tree combinato della porta
profilo, dell'annotazione TS, dei quattro aggiornamenti di pin nelle
fixture e della parità GPUI. Al momento dell'archiviazione HEAD era
`fb94c9a2fed54b14ca3943856a4850532c03cf23`; il tree è stato poi pubblicato
in `670d36d`. La ricevuta registra la corrispondenza del tree, il delta
rispetto a `db98dcf0993d1cae69508186a6e3f7a8d3f2c984` e gli hash
degli 11 file TypeScript cambiati. Le successive correzioni del guard
audit, dei digest delle fixture e del test topologico delle membership
sono fuori da questa misura, anche quando interessano file nel grafo TS.

Sono rimasti invariati `package.json`, `package-lock.json`,
`tsconfig.json` e `tsconfig.typecheck.json`. Le dipendenze di Mediflow
provengono da un `npm ci` pulito; lo snapshot le usa tramite symlink.
I nuovi compilatori sono installati in due prefissi separati in `/tmp`,
con `--ignore-scripts`, senza lockfile e con installazione offline dei
tarball già verificati. I pacchetti di piattaforma vengono passati
esplicitamente insieme ai wrapper: `--omit=optional` non elimina quindi
il binario necessario. SHA-512/SHA-1 del registry e SHA-256 locale
concordano per tutti e quattro gli archivi.

Il comando comune è:

```text
-p tsconfig.typecheck.json --noEmit --incremental false --pretty false
```

Restano i parametri del progetto, compreso `skipLibCheck: true`. Il trial
non misura emit, watch, editor o build incrementale.

## Risultati delle nove esecuzioni

Ogni riga comprende tre campioni. Il minimo e il massimo descrivono
l'intervallo osservato, senza attribuirgli un significato statistico più
ampio. RSS indica il picco del singolo processo, espresso in KiB.

| Compilatore | Exit / diagnostiche | Mediana tempo | Min–max tempo | Mediana RSS | Min–max RSS |
| --- | --- | ---: | ---: | ---: | ---: |
| TypeScript 5.9.3, Node | 3 × 0 / 0 | 30,513008 s | 30,263220–34,146098 s | 1.998.024 KiB | 1.996.328–2.052.380 KiB |
| tsc-ts 0.0.2, nativo | 3 × 0 / 0 | 1,668819 s | 1,658704–1,851220 s | 1.497.316 KiB | 1.486.372–1.498.076 KiB |
| TypeScript 7.0.2 ufficiale, nativo | 3 × 0 / 0 | 4,380135 s | 4,156027–5,094933 s | 1.912.800 KiB | 1.904.636–1.987.024 KiB |

Il rapporto fra mediane è 2,62× rispetto a TS7 ufficiale e 18,28× rispetto
a TS5.9.3. La mediana RSS di `tsc-ts` è inferiore rispettivamente del
21,72% e del 25,06%. Sono rapporti di questo comando locale, con la
concorrenza predefinita di ciascun compilatore. Il passaggio TS5→TS7
cambia anche semantica e librerie standard: quel rapporto non isola il
solo costo dell'implementazione. Nessun numero rappresenta un
acceleramento dell'applicazione Mediflow o del client GPUI.

Il batch completo dura 113,744988 secondi. I nove stdout e stderr sono
vuoti e gli ingressi risultano byte-identici prima e dopo il batch.

### Metodo di misura

Ambiente: Linux 6.18.55 x86_64, glibc 2.39, Node 24.19.0,
CPU AMD EPYC 9V74, nove CPU logiche visibili e quota cgroup di otto CPU,
limite RAM di 8 GiB. La finestra inizia alle 20:44:54 UTC, dopo la
chiusura di app GPUI, Xvfb e host Next sintetico alle 20:44:27 UTC.
Le altre suite locali sono state sospese durante i campioni.

L'ordine ruota fra i tre giri: TS5 / tsc-ts / TS7;
TS7 / TS5 / tsc-ts; tsc-ts / TS7 / TS5. Il driver esegue direttamente i
due binari nativi e Node più il CLI TS5. Usa un orologio monotono fra
`fork`/`exec` e `wait4` sul PID esatto. `ru_maxrss` viene letto per quel
processo, senza riutilizzare il massimo cumulativo dei figli precedenti.
Ogni processo ha un limite di 60 secondi e il batch di 180 secondi.

Prima del cronometro, tutti i compilatori eseguono versione,
`--showConfig` e `--listFilesOnly`. Le cache del sistema operativo e del
compilatore Node non vengono svuotate. Non si applica una nuova affinità
CPU e non si forza un numero uguale di thread. Il
[README del pacchetto tsc-ts](https://github.com/vercel-labs/tsc-ts/blob/main/packages/tsc-ts/README.md)
descrive scelte di concorrenza predefinite diverse dal riferimento:
questo è un confronto dei comandi così configurati, non di scheduler
equivalenti o di avvii a cache fredda.

## Stessa mole di codice controllata

I tre `--showConfig` restituiscono gli stessi 1.899 file radice, nello
stesso ordine. I due motori TS7 risolvono 3.588 file ciascuno e usano
89 dichiarazioni della libreria standard, byte-identiche.

Nel confronto dei grafi si sostituisce soltanto la rispettiva directory
delle `lib*.d.ts` native con `<compiler-standard-lib>/`. Tutti gli altri
percorsi rimangono intatti. Le liste normalizzate coincidono sia in ordine
sia come insiemi; il loro SHA-256 è
`77bca173a41a9f5343cc1d13754a49161e7305038a46db24b15a7c7c35700110`.

I pacchetti non contengono lo stesso numero totale di librerie:
`tsc-ts` ne include 107, TS7 ufficiale 108. Le 107 comuni coincidono;
l'ulteriore `lib.d.ts` ufficiale non compare in nessuno dei due grafi
misurati. Il primo preflight si è fermato prima del cronometro perché
richiedeva anche l'uguaglianza di tutte le librerie disponibili. Verificata
questa differenza, il driver misurato richiede l'uguaglianza dei grafi e
delle 89 librerie usate, conservando il rilievo 107/108 nella ricevuta.

TS5 risolve invece 3.596 file. Il manifest degli ingressi comprende questi
file e i quattro manifest di configurazione/dipendenze: 3.600 record,
con SHA-256 complessivo prima e dopo
`7f9104fb3d417ea83c86edd992f58e4f24b1aac1760b7e3d6d2e87cf4713c78f`.
I motori nativi e le loro librerie standard hanno registrazioni e
verifiche separate. I manifest completi restano fra gli artefatti del
trial; la ricevuta ne riporta conteggi, dimensioni e hash senza ripetere
migliaia di percorsi.

## Diagnostiche e compatibilità

La cronologia del trial precedente registra due TS2339 condivisi dai
motori TS7: `includeLayers` e `cwd` non erano riconosciute sul tipo `{}`
inferito per `fields` in `execution-mac-qualification.ts`. I vecchi log
grezzi sono andati persi; la ricevuta distingue quella osservazione
storica dalle prove appena ripetute.

La sola correzione TypeScript aggiunge l'annotazione
`const fields: PropertyDescriptorMap = ...`. La nuova verifica di
`transpileModule`, TypeScript 5.9.3, target ES2017 e modulo ESNext produce
JavaScript identico prima e dopo: 29.984 byte, SHA-256
`e5f64015497b12b136f2915a1ca83aa5ac15c4274a8145cc46dc67dc642e3f9b`.
I nove typecheck correnti verificano separatamente la versione annotata.

Un controllo negativo fuori dai campioni cronometrati assegna una stringa
a un `number`, in una fixture isolata. Tutti e tre i compilatori emettono
lo stesso TS2322; TS5 esce con codice 2 e i due motori TS7 con codice 1.
Questo conferma il rilevamento dell'errore introdotto, senza estendere
la prova a una qualifica completa del linguaggio.

Mediflow usa inoltre `typescript` come libreria a runtime: il
[loader](../../scripts/register-strip-types-loader.mjs) chiama
`transpileModule`, e diversi test, fra cui quelli della
[porta profilo](../../lib/patient-profile-service.test.ts), usano API AST.
Il PASS del CLI non qualifica la sostituzione di queste API. Il trial
mantiene il pacchetto TypeScript del progetto e circoscrive l'esito al
typecheck separato. Non vengono attestati Windows, macOS, ARM o i gate
clinici della transizione Rust.

## Riproduzione

Occorrono Linux x64 con glibc almeno 2.34, Python 3, git, npm e la stessa
versione Node 24.19.0. Il driver usa `fork`, `wait4` e cgroup Linux.
`MEDIFLOW_REPO` deve indicare una checkout che contenga questo report,
la ricevuta, il driver e il commit misurato. Si lavora in una nuova
directory temporanea; i compilatori sperimentali non vengono installati
nelle dipendenze di Mediflow.

```bash
set -euo pipefail
MEDIFLOW_REPO=/percorso/assoluto/mediflow
TYPECHECK_TRIAL=$(mktemp -d /tmp/mediflow-typecheck.XXXXXX)
export TYPECHECK_TRIAL
mkdir "$TYPECHECK_TRIAL/source"
git -C "$MEDIFLOW_REPO" archive 670d36d154b98d84ddbc0d68a70b9ba3ef996e2a |
  tar -xf - -C "$TYPECHECK_TRIAL/source"
cp "$MEDIFLOW_REPO/experiments/gpui-patient-pilot/comparison/typecheck-benchmark.py" \
  "$TYPECHECK_TRIAL/benchmark.py"
cp "$MEDIFLOW_REPO/experiments/gpui-patient-pilot/evidence/connected/tsc-ts-typecheck-validation.json" \
  "$TYPECHECK_TRIAL/receipt.json"
(cd "$TYPECHECK_TRIAL/source" && npm ci --no-audit --no-fund)
```

La prova originale usava il symlink a un `npm ci` pulito; qui si installa
la stessa dipendenza direttamente nello snapshot per rendere la
procedura autonoma. I tarball precompilati si scaricano e verificano
contro gli hash della ricevuta, con timeout e dimensione massima:

```bash
python3 - <<'PY'
import base64, hashlib, json, os, pathlib, urllib.request
trial = pathlib.Path(os.environ['TYPECHECK_TRIAL'])
receipt = json.loads((trial / 'receipt.json').read_text())
for package in receipt['packages']:
    with urllib.request.urlopen(package['tarballUrl'], timeout=30) as response:
        data = response.read(80 * 1024 * 1024 + 1)
    checks = [
        len(data) == package['tarballBytes'],
        hashlib.sha256(data).hexdigest() == package['sha256'],
        hashlib.sha1(data).hexdigest() == package['sha1'],
        'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode()
            == package['sha512Integrity'],
    ]
    if not all(checks):
        raise SystemExit('Integrità non valida: ' + package['name'])
    (trial / package['tarballFilename']).write_bytes(data)
PY

npm install --ignore-scripts --no-package-lock --no-audit --no-fund \
  --omit=optional --offline --cache "$TYPECHECK_TRIAL/npm-cache" \
  --prefix "$TYPECHECK_TRIAL/tsc-ts-install" \
  "$TYPECHECK_TRIAL/tsc-ts-0.0.2.tgz" \
  "$TYPECHECK_TRIAL/tsc-ts-linux-x64-gnu-0.0.2.tgz"
npm install --ignore-scripts --no-package-lock --no-audit --no-fund \
  --omit=optional --offline --cache "$TYPECHECK_TRIAL/npm-cache" \
  --prefix "$TYPECHECK_TRIAL/ts7-install" \
  "$TYPECHECK_TRIAL/typescript-7.0.2.tgz" \
  "$TYPECHECK_TRIAL/typescript-typescript-linux-x64-7.0.2.tgz"
python3 "$TYPECHECK_TRIAL/benchmark.py" prepare
python3 "$TYPECHECK_TRIAL/benchmark.py" measure
```

Prima di `measure`, sospendere altre build e runtime locali. Il driver
produce `preflight.json`, `graph-comparison.json`, i manifest di ingressi
e librerie, i log per campione, `measurement-samples.json` e
`measurement-summary.json`. Il comando finale si ferma su exit non zero,
diagnostiche, output inatteso, ingressi cambiati o budget superato.

Il controllo negativo si ripete creando in
`$TYPECHECK_TRIAL/negative-control` `sentinel.ts` e `tsconfig.json` dai
campi `negativeControl.source` e `negativeControl.config` della ricevuta,
poi eseguendo, dalla directory `source`, ciascun motore con
`-p ../negative-control/tsconfig.json --noEmit --incremental false --pretty false`.
Il codice di uscita atteso è non zero; questa esecuzione resta fuori dal
batch cronometrato.

I percorsi assoluti nelle nuove liste dipenderanno dalla directory scelta:
i loro hash grezzi non sono quindi invarianti fra macchine. Confrontare
conteggi, contenuti, versioni e hash di sorgenti/pacchetti/motori; verificare
entro ogni trial l'uguaglianza dei due grafi TS7 e dei manifest prima/dopo.
La ricevuta conserva gli hash del trial originale, non una previsione
dei tempi o dei percorsi di una nuova esecuzione.

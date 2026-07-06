---
summary: "Runbook for the local metadata-only Codex workflow monitor and branch/scope/check drift snapshots."
read_when:
  - "Working on or diagnosing the local Codex workflow monitor."
  - "Checking branch, expected issue, privacy boundary, or declared verification drift."
---

<!-- Codex: WUL-283 -->
# Codex Workflow Monitor

Stato documento: `SECONDARY` (runbook operativo locale)  
ADR: [ADR 0063](./adr/0063-local-workflow-monitor-control-plane.md)

Questo runbook descrive il monitor locale che controlla drift di branch, scope,
privacy e verifica durante il lavoro Codex/MediFlow.

Il monitor non e una feature clinica e non entra nel runtime applicativo. Serve
come freno silenzioso: se il lavoro sta andando su branch sbagliato, path
sensibili o senza verifica dichiarata, produce uno snapshot locale con
`continue`, `needs_codex` o `blocked`.

## Boundary privacy

Il monitor legge solo metadati:

- branch Git e issue id nel nome branch;
- path modificati da `git status` e `git diff --name-only main...HEAD`;
- check dichiarati con `--check nome=pass|fail|skip`;
- eventuale sidecar locale `.codex/workflow-checks.json` (solo branch, SHA breve,
  timestamp e nome/esito dei check dichiarati);
- eventuale snapshot precedente del monitor.

Non legge:

- contenuti diff;
- SQLite o `medical.db`;
- `docs/private` contents;
- note paziente, allegati, OCR, prompt o output clinici;
- email, calendario o Chronicle.

I path che sembrano privati o artifact documentali vengono redatti nello
snapshot (`[redacted:reason:hash]`) e generano uno stop condition.
La redazione copre anche directory operative ad alto rischio come `docs/private`,
`certs`, `Farmaci`, `exports` e artifact/chiavi/archivi (`.pdf`, `.docx`,
`.xlsx`, `.key`, `.pem`, `.zip`, `.tar.gz`, ecc.).

## Uso manuale

Run singolo, leggibile:

```bash
npm run workflow-monitor -- --once
```

Run singolo JSON:

```bash
npm run workflow-monitor -- --once --json
```

Run con verifiche dichiarate:

```bash
npm run workflow-monitor -- --once --json \
  --expected-issue WUL-283 \
  --check test:workflow-monitor=pass
```

Quando uno snapshot viene scritto con check dichiarati, i run successivi possono
riusare quei check anche in modalita read-only solo se `HEAD`, branch, path e
dirty state sono invariati e il working tree e pulito. Qualunque nuovo edit o
commit li invalida.

Ordine di precedenza nella risoluzione dei check: `--check` espliciti da CLI,
poi dichiarazioni persistite nel sidecar (vedi sotto), poi riuso dello snapshot
precedente. Il verdetto espone la provenienza in `checksSource`
(`cli`, `persisted`, `previous-snapshot`, `none`).

Snapshot salvato fuori repo:

```bash
npm run workflow-monitor -- --once --write --quiet
```

`snapshots.jsonl` resta bounded: quando supera circa 10 MB viene ricominciato
dal nuovo snapshot, mentre `last.json` e `last.md` restano sempre aggiornati.

Stato ultimo snapshot:

```bash
npm run workflow-monitor -- status
```

## Persistenza delle dichiarazioni di verifica

I `--check` passati da CLI valgono solo per il singolo run. Per far vedere la
stessa verifica anche ai run schedulati (LaunchAgent o `watch`), che girano
senza hint, aggiungi `--persist-checks` al run manuale:

```bash
npm run workflow-monitor -- --once --json \
  --check prepare-oss=pass \
  --persist-checks
```

La dichiarazione viene salvata in `.codex/workflow-checks.json` nella radice
del worktree, una entry per branch. I run successivi senza `--check` la
rileggono e la applicano con `checksSource: "persisted"` nel verdetto.

Regole di validita:

- la dichiarazione e legata al branch e allo SHA di `HEAD` al momento del run:
  un nuovo commit, amend o rebase la invalida automaticamente;
- viene salvata solo se il working tree e pulito; con modifiche non committate
  il persist viene saltato (`checksPersistence: {status: "skipped",
  reason: "dirty-tree"}`) perche lo SHA da solo non identifica il contenuto.
  Flusso consigliato: commit, poi verifica, poi dichiarazione;
- viene riletta solo se il working tree e pulito: nuovi edit non committati
  riportano il verdetto a `tests_not_declared`;
- i `--check` espliciti da CLI hanno sempre precedenza;
- anche gli esiti `fail` e `skip` vengono persistiti: un `fail` dichiarato
  continua a produrre `blocked` finche non arriva un nuovo commit o un
  `clear-checks`.

Il sidecar e git-ignorato di proposito, non committabile: la dichiarazione e
legata allo SHA di `HEAD`, quindi committarla cambierebbe lo SHA stesso e la
invaliderebbe; inoltre e stato locale della macchina, non parte del codice, e
se comparisse in `git status` sporcherebbe il dirty state osservato dal monitor
stesso. Oltre all'entry `/.codex/` in `.gitignore`, il monitor scrive
`.codex/.gitignore` con `*`, cosi il sidecar resta invisibile a `git status`
anche su branch piu vecchi che non hanno ancora l'entry di root.

Contenuto del sidecar: solo metadati (branch, SHA breve, timestamp, nome ed
esito dei check). Nessun contenuto diff, nessun dato clinico.

Opt-out della lettura per un singolo run:

```bash
npm run workflow-monitor -- --once --no-persisted-checks
```

Rimozione della dichiarazione del branch corrente:

```bash
npm run workflow-monitor -- clear-checks
```

## Automazione macOS

Installazione consigliata: runner stabile fuori repo + LaunchAgent utente.
Questa modalita copia lo script in
`~/Library/Application Support/MediFlow/workflow-monitor/bin/` e fa puntare
launchd a quella copia. Cosi il monitor continua a osservare anche branch vecchi
che non hanno ancora lo script o lo script npm.

```bash
npm run workflow-monitor -- install-global-runner
```

Installazione LaunchAgent repo-local, utile solo per sviluppo del monitor:

```bash
npm run workflow-monitor -- install-launch-agent
```

Se passi `--expected-issue WUL-123` all'installazione, il LaunchAgent conserva
lo stesso guard nei run periodici. Per il lavoro quotidiano, pero, evita un
`expected-issue` fisso: il monitor deve seguire il branch corrente, non
bloccare tutti i branch diversi dall'ultimo task.

Default:

- label: `com.mediflow.workflow-monitor`;
- intervallo: `300` secondi;
- output: `~/Library/Application Support/MediFlow/workflow-monitor/`;
- runner consigliato: copia stabile nello stesso output dir;
- modalita modello: `auto`, cioe digest locale solo su verdetti medium/high;
- esecuzione silenziosa.

Disinstallazione:

```bash
npm run workflow-monitor -- uninstall-launch-agent
```

## Digest locale Ollama

Il modello e opzionale e riceve solo il summary redatto del verdetto
deterministico. Non sostituisce le regole.

Esempi:

```bash
npm run workflow-monitor -- --once --model-mode auto
npm run workflow-monitor -- --once --model-mode always --model batiai/gemma4-e4b:q4
```

Se Ollama o il modello non sono disponibili, il monitor registra
`localModelDigest.status=unavailable` ma non fallisce il controllo.
In modalita `auto`, se branch/path/verdetto non cambiano, il digest viene
riusato come `cached-*` per evitare di ricaricare il modello a ogni intervallo.

## Interpretazione verdetti

| Status | Significato | Azione |
| --- | --- | --- |
| `continue` | Nessun drift rilevato dai metadati. | Si puo continuare. |
| `needs_codex` | Manca una decisione o verifica dichiarata. | Fermarsi a chiarire o testare. |
| `blocked` | Branch/scope/privacy/check fallito. | Non procedere con edit o handoff finche il blocco non e risolto. |

## Verifica

```bash
npm run test:workflow-monitor
npm run workflow-monitor -- --once --json --expected-issue WUL-283 \
  --check test:workflow-monitor=pass
```

La suite copre anche la persistenza: un test end-to-end crea un repo Git
temporaneo, dichiara un check con `--persist-checks`, verifica che il run
successivo senza hint lo riusi (`checksSource: "persisted"`) e che un nuovo
commit o `clear-checks` lo facciano scadere.

Complexity check: not applicable. Il monitor non e un hot path runtime e non
tocca query, rendering o cicli su dati clinici.

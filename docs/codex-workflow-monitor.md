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

Quando uno snapshot viene scritto con check dichiarati, i run automatici possono
riusare quei check solo se `HEAD`, branch, path e dirty state sono invariati e
il working tree e pulito. Qualunque nuovo edit o commit li invalida.

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

Complexity check: not applicable. Il monitor non e un hot path runtime e non
tocca query, rendering o cicli su dati clinici.

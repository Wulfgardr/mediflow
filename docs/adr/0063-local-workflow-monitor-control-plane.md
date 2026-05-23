<!-- Codex: WUL-283 -->
# ADR 0063: Monitor locale di workflow come control plane silenzioso

Date: 2026-05-23
Status: Proposed

Related: [docs/linear-codex-playbook.md](../linear-codex-playbook.md),
[SECURITY.md](../../SECURITY.md),
[ADR 0029](./0029-ai-model-parliament-and-local-retention-policy.md)

## Problema

Il lavoro operativo su MediFlow passa da branch, Linear, Codex, Claude/Gemini,
memoria locale e talvolta modelli locali. Questo flusso funziona, ma richiede
di ricostruire spesso se il branch e quello giusto, se una nuova idea merita
una issue separata, se si stanno toccando path privati o se manca una verifica.

Serve un controllo automatico e poco visibile che riduca drift e token spesi per
ricostruire il contesto, senza diventare un dashboard clinico o un agente
autonomo.

## Opzioni

1. Non aggiungere nulla e continuare con controlli manuali.
2. Costruire un control center completo cross-agente.
3. Aggiungere un monitor locale minimale, deterministic-first, che legge solo
   metadati Git/check e produce un verdetto PHI-safe.

## Trade-off

- Opzione 1:
  - Pro: nessuna nuova complessita.
  - Contro: resta facile lavorare su branch/scope sbagliato e ricostruire
    contesto a ogni turno.
- Opzione 2:
  - Pro: massima ambizione di orchestrazione.
  - Contro: rischia di riaprire un filone troppo ampio, con confini privacy e
    prodotto meno chiari.
- Opzione 3:
  - Pro: intercetta i drift piu costosi, resta locale, auditabile e invisibile
    nel quotidiano.
  - Contro: la prima slice non capisce il contenuto semantico del lavoro e non
    sostituisce review umana o Linear.

## Decisione

Adottiamo l'opzione 3.

Il monitor locale vive come tooling repo-local, non come runtime clinico
MediFlow. Legge solo:

- branch e issue id inferito dal nome;
- path modificati da Git;
- check dichiarati esplicitamente;
- stato sintetico del verdetto precedente.

Non legge diff contents, SQLite, note paziente, allegati, mail, `docs/private`
contents o prompt/risposte cliniche. Se incontra path privati o artifact
potenzialmente sensibili, li redige e alza uno stop condition.

Le regole deterministiche decidono sempre per prime. Un modello locale Ollama
puo produrre un digest opzionale solo su summary redatto e solo per verdetti
medium/high in modalita `auto`. Nessun modello remoto o cloud runtime entra nel
default.

Il monitor puo essere installato come LaunchAgent utente macOS, con snapshot
fuori repo sotto `~/Library/Application Support/MediFlow/workflow-monitor`.
L'esecuzione periodica resta silenziosa: serve a frenare drift operativi, non a
notificare continuamente.

## First Thin Slice

1. Aggiungere `scripts/codex-workflow-monitor.mjs` con comandi `once`,
   `watch`, `status`, `install-launch-agent`, `uninstall-launch-agent`.
2. Aggiungere test stdlib sulle regole critiche: branch mismatch, path privati,
   verifiche mancanti e path redatti.
3. Aggiungere runbook dedicato e wiring npm.
4. Installare opzionalmente il LaunchAgent locale dopo verifica.

## Fuori Scope

- Lettura o scrittura di dati clinici.
- Auto-commit, auto-push, auto-PR o auto-update Linear.
- Dashboard Unicum/control center completo.
- Integrazione diretta con mail, calendario, Chronicle o database clinico.
- Cloud model, telemetry o egress di default.


---
summary: "Proposta «Mini»: la faccia headless di MediFlow per agenti autenticati — identità concessa dall'operatore, lease contestuale per paziente, stadi fail-closed ereditati dal manifest AIP, output a due registri e artefatti contestuali a scope chiuso."
read_when:
  - "Progettando o implementando l'accesso headless per agenti (CLI, MCP, automazioni)."
  - "Valutando come un agente deve autenticarsi, leggere, proporre e applicare informazioni cliniche."
---

# Mini — la faccia headless di MediFlow

## 0. Rapporto con l'esistente e stato di questo documento

Su `main` non esiste alcuna superficie agent eseguibile. Il piano esiste ed è
l'[ADR 0093](../adr/0093-agent-interface-plane-headless-capability-contract.md)
(**Proposed**), implementato nei rami `codex/WUL-553` (manifest
`mediflow.agent-interface.manifest.v1`), `codex/WUL-554` (proiezione
`mediflow.agent.patient_open_loops.v1`), `codex/WUL-555`
(sessione + context lease) e nel superset `codex/WUL-518-aip-authority-loop-2-pro`.

Questo documento definisce **la forma del prodotto** (identità, comandi,
contratto d'output, artefatti), non autorizza implementazione: la modifica di
confini di sicurezza richiede la promozione dell'ADR prima del codice
([AGENTS.md](../../AGENTS.md)). Ogni nome di comando qui sotto è una proposta di
interfaccia, verificabile contro il manifest una volta mergeato.

## 1. Il concetto

Mini non è un client ridotto: è **il modo in cui un agente entra in MediFlow con
le stesse regole di un medico** — identità propria, contesto dichiarato,
permessi limitati, azioni visibili. La superficie è minimale per scelta: la
ricchezza sta nel contratto, non nei bottoni.

Il nome è voluto: Mini è la versione dell'app che non occupa schermo. Dove il
cockpit serve la domanda clinica di chi guarda, Mini serve la domanda clinica di
chi opera per conto di qualcuno che guarda.

## 2. Sette principi

1. **Identità concessa, mai condivisa.** Un agente non usa né il
   local-api-token (vincolato al data-plane read-only da ADR 0038) né la
   sessione web dell'operatore. Riceve un'identità dedicata, revocabile, con
   permessi propri.
2. **Il contesto è un lease.** Nessun accesso trasversale: il lavoro agente vive
   dentro un lease scaduto a tempo e ancorato a un `patientRef` (libreria
   `lib/agent-interface/authority.ts` del ramo WUL-555). Fuori lease,
   `outside_selected_patient_context`.
3. **Fail-closed per costruzione.** Ciò che il manifest dichiara
   `manual_only` risponde `denied_by_contract`. Oggi significa: tutto. Le
   promozioni sono decisioni esplicite tracciate nel manifest, non flag.
4. **Gli stadi si attraversano, non si saltano.**
   `observe → read → compute → propose → preview → apply`. Un agente può
   arrivare fino a `preview`; `apply` richiede autorità umana salvo policy di
   grant esplicita (default: negato).
5. **Zero PHI nel canale debole.** Argomenti, log, shell history e output di
   default portano riferimenti (`patientRef`, id voce), mai nomi, codici
   fiscali o free-text clinici. Il dato pieno viaggia solo nell'artefatto
   richiesto esplicitamente.
6. **Ogni risposta porta la sua provenienza.** Sorgente, freschezza, venue,
   lease e timestamp sono parte del payload, non un arricchimento.
7. **L'output parla Lume.** Voce per l'intestazione, Registro per i dati: la
   resa terminale usa la stessa gerarchia tipografica dell'interfaccia grafica.

## 3. Ciclo di vita dell'identità

```
operatore   $ mediflow mini grant <nome-agente> \
              --stage preview --lease-ttl 30m --patients allowlist.json
            → intent di pairing con TTL 10 min (pattern ADR 0036),
              conferma esplicita sulla home-base

agente      $ mf login --intent <id>          # scambia intent ↔ credenziale
            $ mf whoami                       # identità, stadio massimo, lease attivo
            … lavoro …
operatore   $ mediflow mini revoke <nome-agente>   # effetto immediato
```

- Credenziale breve, file `0600` sotto `<data>/agent-keys/`, mai variabile
  d'ambiente globale, mai il token `/api/v1`.
- Ogni comando rivalida sessione e lease prima di qualunque lettura
  (`validateAgentSession`, `validateAgentContextLease`): un lease scaduto
  produce esito chiuso con motivo tipizzato, non un errore generico.
- Lockout e audit riusano le librerie esistenti (`auth-lockout`,
  audit append-only locale: chi, cosa, quale lease, quale esito).

## 4. Superficie dei comandi v0

| Area | Comando | Note |
| --- | --- | --- |
| Sessione | `mf whoami` | identità, stadio massimo concesso, lease attivo con scadenza |
| Perimetro | `mf capabilities` | il manifest, letto dall'agente: cosa è lecito aspettarsi |
| Retrieve | `mf patient search <query>` | restituisce riferimenti, non anagrafica piena |
| Retrieve | `mf patient show <patientRef>` | quadro minimo scoped dal lease |
| Retrieve | `mf open-loops <patientRef>` | proiezione deterministica WUL-554 |
| Record | `mf draft create --from <payload>` | crea bozza: mai scrittura diretta |
| Record | `mf draft preview <draftId>` | resoconto differenziale di ciò che verrebbe registrato |
| Record | `mf apply <draftId>` | **negato di default**: richiede autorità umana o grant esplicito |
| Prepare | `mf handoff preview <patientRef>` | preparazione passaggio di consegne, sola lettura |

Banner costante su ogni invocazione: paziente del lease, scadenza, stadio
massimo. Se il comando eccede il lease, il rifiuto nomina il motivo esatto.

## 5. Contratto d'output

- **Default umano**: intestazione in Voce, dati in Registro (tabular-nums),
  stati onesti e azionabili (`negato: denied_by_contract — capability non
  promossa; vedi mf capabilities`). Niente spinner decorativi.
- **`--json`**: envelope macchina
  `{ schema, lease, provenance, data }` — `schema` è il nome versione del
  payload (`mediflow.agent.patient_open_loops.v1`, …), così gli agenti che
  consumano hanno un contratto stabile.
- **Exit code** documentati: `0` ok, `2` negato dal contratto, `3` lease
  scaduto/assente, `4` input illeggibile. Il fallimento è distinguibile dal
  diniego.
- **Provenance block** invariabile: `source`, `freshness`, `venue`,
  `lease`, `generatedAt`.

## 6. Artefatti contestuali e UI dinamica

È il contratto con cui un agente mostra qualcosa all'operatore:

- **`--artifact link`** → deep-link autenticato dentro la superficie localhost
  esistente (`/patients/<id>?ctx=<leaseId>`): il browser dell'operatore ha già
  la sua sessione, la superficie evidenzia il fuoco richiesto dal lease.
  Nessun dato nuovo esce dall'app.
- **`--artifact html`** → documento self-contained contenente **solo** i dati
  nello scope del lease, marcato con id lease e timestamp, apribile offline.
- **`--artifact json`** → per composizioni successive a monte.

Gli agenti che operano sopra Mini compongono queste primitive liberamente: il
contratto garantisce scope, provenanza e privacy mode, non il layout. Chi
vuole UI dinamica la costruisce dentro questi confini.

## 7. Invarianti di sicurezza non negoziabili

- Nessun accesso diretto al database: tutto passa dallo stesso servizio
  dell'app.
- Egress `none`: nessuna rete oltre la home-base locale.
- Scritture solo tramite stadi; `apply` di default umano.
- Audit append-only locale per ogni comando, incluso il negato.
- Revoca immediata; credenziali non esportabili fuori da `<data>/`.

## 8. Percorso di implementazione (dopo la promozione dell'ADR)

1. Promuovere ADR 0093 (decisione owner, già in coda Linear).
2. Mergeare il superset `codex/WUL-518-aip-authority-loop-2-pro`
   (manifest + authority + grant + proiezione, ~1463 righe, tutti push su origin).
3. Adapter CLI (`packages/mini`, tsx) che consuma le librerie esistenti —
   nessuna nuova logica di autorizzazione.
4. Estendere il gate CI `check-agent-interface-manifest` ai comandi dichiarati.
5. Adapter MCP come fase successiva e ADR separato.

## 9. Non-goals v0

Nessun cloud, nessun server MCP, nessuna scrittura oltre lo stadio concesso,
nessun accesso SQLite diretto, nessuna TUI interattiva ricca: Mini è pipe-first
per costruzione.

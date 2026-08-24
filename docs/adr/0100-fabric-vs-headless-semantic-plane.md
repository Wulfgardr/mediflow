# ADR 0100: Fabric e piano semantico Headless

Date: 2026-08-24
Status: Proposed

Issue: WUL-522, WUL-282
Program line: candidato `0.8.5`

Related: [ADR 0089](./0089-contratto-intelligence-fabric-e-venue-esecutive.md),
[ADR 0094](./0094-intelligence-fabric-headless-contract-085.md),
[ADR 0095](./0095-broker-projection-e-servizi-host-per-capability.md),
[ADR 0096](./0096-owner-sessione-selezione-e-lifetime-broker.md), candidata
ADR 0093 e candidata ADR 0097.

## Decisione

MediFlow usa due piani distinti, con un solo grafo di servizi applicativi
host-owned. Questa ADR non aggiunge un provider, un trasporto, una route o una
superficie utente.

| Piano | Responsabilità | Non è |
| --- | --- | --- |
| **Fabric** | Risolve capacità smart nominate con broker specifico, provider, modello e venue sostituibili. Registra readiness, egress, receipt e provenienza. | Un'interfaccia agente generale. |
| **Headless** | Traduce un intento chat o voce in un grafo di capability e Application Service, sotto policy e autorità host-owned. | CLI, REST, SQL, automazione schermo, replica GUI o accesso a SQLite. |

```text
chat / voce
  -> planner-orchestrator
  -> grafo di capability + Application Service nominati
  -> policy + autorità host-owned
  -> esecuzione -> receipt PHI-safe -> risposta
                       ^
Fabric: capability smart -> broker specifico -> provider/modello/venue
```

Il planner può comporre capability ammesse. Non può creare autorità, scegliere
provider o venue, coniare conferme, né eseguire `apply`. Un adapter Headless
non replica regole business e non salta il servizio applicativo.

### Fabric governato dall'host

Ogni capacità smart usa un broker capability-specific host-owned. Il broker
risolve, per la singola operazione, provider, modello, venue, readiness, egress,
receipt e provenienza secondo policy. Provider, modello e venue sono
sostituibili solo tramite quella decisione. Il chiamante non li fornisce.

Non esiste fallback silenzioso. Readiness assente, revocata, degradata o
incompatibile nega prima dell'invocazione. La UI deve rendere visibili nome e
logo del provider, stato di autenticazione e readiness; questa trasparenza non
è un grant.

Nel candidato, gli unici provider cloud candidabili al login sono OpenAI e
Anthropic. Restano disabilitati finché un ADR e un gate egress separati non li
abilitano. ATHENA resta una capacità locale. Nessun provider è un'interfaccia
agente generale o riceve accesso diretto a dati, SQLite, chiavi o segreti.

### Headless semantico

Headless rappresenta intenzioni e operazioni applicative nominate, non comandi
di trasporto. Ogni nodo del grafo dichiara capability, input/output minimizzati,
disposition, policy, owner, limiti e dipendenze Fabric. Il grafo può includere
lettura, query, orchestrazione, preview, proposta e denial; non inferisce una
scrittura dalla disponibilità di una lettura.

L'Application Service è il solo punto per regole cliniche, validazione,
transazioni, conflitti, audit e risposta. Il piano Headless non espone query
SQL, PIN, token locale, cookie, filesystem, automazione GUI o una via di
compatibilità verso la UI. La scorciatoia «SQL + PIN + Codex» è un rischio
artigianale da sostituire, non un'interfaccia approvata.

### Invarianti condivisi

Fabric e Headless devono verificare per operazione: sessione, ruolo attivo,
autorizzazione per operazione, lease, epoch, revoca, CAS, `expectedRevision`,
idempotenza, audit PHI-safe e limiti. L'assenza, l'ambiguità, la scadenza o un
mismatch negano in modo fail-closed. L'accesso diretto a SQLite è vietato.

Per `0.8.5`, D8 e WUL-282 restano invariati: ogni riga ha
`applyPolicy=none`. Sono ammessi solo discovery, read, query, orchestrazione,
preview, proposta e denial. Non esistono write, apply o applicazione autonoma.

## Inventari, owner e gate

Gli inventari restano separati. Una riga non può essere promossa da un inventario
all'altro per somiglianza di nome o di trasporto.

| Inventario | Owner | Minimo verificabile | Gate di release |
| --- | --- | --- | --- |
| Fabric | owner Fabric host | capability smart, broker, provider/modello/venue, readiness, egress, receipt, provenienza | `fabricSourceSha` esatto a 40 caratteri, policy e receipt sintetiche del medesimo SHA |
| Headless | owner Application Service | intento, piano, grafo capability/service, authority, esito e receipt | `headlessSourceSha` esatto a 40 caratteri, denial e composizione sintetiche del medesimo SHA |

Una release richiede entrambi gli SHA, il SHA di integrazione, inventari
versionati e prova sintetica dell'assenza di bypass. Branch, PR, tag, dashboard,
UI visibile o suite isolata non sostituiscono uno SHA esatto. Nessuna prova
locale promuove una release o abilita un cloud login.

## Riconciliazione e limiti dei claim

ADR 0094 resta la fonte per Application Service e classificazione. ADR 0095
resta la fonte per broker projection e servizi capability-specific. ADR 0096
resta la fonte per sessione, lease, epoch e invalidazione. Questa ADR non
modifica il loro runtime né l'autorità di ADR 0097 candidata.

La candidata ADR 0093 è superata solo nella sua definizione centrale di
Headless come superficie orientata a trasporti. Restano candidate le sue altre
evidenze finché non sono riesaminate. ADR 0097 resta indipendente: ruolo attivo
e step-up non sono creati dal planner o dal Fabric.

Il claim massimo è: «contratto proposto per piani separati e review-first».
Non sono consentiti claim di agente operativo, provider cloud abilitato,
interfaccia Headless completa, autonomia clinica, apply, parity o release.

## Stop rule e non-obiettivi

Fermare il packet se un adapter sceglie provider/modello/venue, se il planner
crea autorità o conferma, se manca una receipt PHI-safe, se compare un fallback
silenzioso, SQLite diretto, SQL/PIN come API, egress, credential sharing, write
o `apply`. Serve un ADR separato anche se occorre cambiare sessione, ruolo
attivo, policy, egress, schema, trasporto o modello dati.

Questa ADR non aggiunge runtime, route, UI, CLI, REST, MCP, SQL, provider,
credenziali, cloud, egress, database, migrazioni, test runtime, dati clinici,
promozione o release. Le verifiche future usano soltanto fixture sintetiche.

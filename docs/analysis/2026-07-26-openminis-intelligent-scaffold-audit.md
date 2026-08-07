# Audit OpenMinis per lo scaffold intelligente

Data: 2026-07-26
Stato: `SECONDARY / ARCHITECTURE INPUT`
Issue: WUL-499, WUL-502, WUL-522, WUL-518, WUL-422, WUL-523

## Scopo

Questo audit confronta lo scaffold intelligente proposto da ADR 0086 con
OpenMinis. Lo scopo è riusare pattern architetturali utili senza importare
autorità, egress o tool surface incompatibili con MediFlow.

L'audit usa il sorgente pubblico OpenMinis al commit
`9cf3a855fecd27bb5735b84cacbd56852a3ab8dd`. OpenMinis usa GPLv3. MediFlow
non copia codice o protocolli dal progetto. L'audit è un input secondario:
ADR 0072, ADR 0077, ADR 0086 e le issue Linear restano le fonti decisionali.

## Stato verificato di MediFlow

- ADR 0086 è `Proposed` e non aggiunge runtime.
- Ollama è l'unico provider operativo.
- Registry, binding per ruolo, provider alternativi e cloud non sono
  consegnati.
- Il gate egress resta chiuso per impostazione iniziale.
- La voce resta una capability futura governata da ADR 0072.
- Il Mac home-base resta autorevole. I client paired non ricevono credenziali
  provider e non accedono direttamente a SQLite.
- Codex Operator resta un esperimento personale, owner-only e read-only. Non è
  una lane clinica.

## Pattern osservati in OpenMinis

### Registry e capability

OpenMinis separa tipo di provider, istanza configurata, autenticazione,
modello, capability dichiarate e gruppi di modelli.

- [ProviderTypes.swift](https://github.com/OpenMinis/OpenMinis/blob/9cf3a855fecd27bb5735b84cacbd56852a3ab8dd/src/ios/Providers/ProviderTypes.swift#L5-L114)
- [ProviderConfigStore.swift](https://github.com/OpenMinis/OpenMinis/blob/9cf3a855fecd27bb5735b84cacbd56852a3ab8dd/src/ios/Providers/ProviderConfigStore.swift#L18-L70)
- [ModelGroup.swift](https://github.com/OpenMinis/OpenMinis/blob/9cf3a855fecd27bb5735b84cacbd56852a3ab8dd/src/ios/Providers/ModelGroup.swift#L3-L76)

OpenMinis mantiene anche allowlist separate per l'accesso al loop agentico.
Un modello visibile non diventa automaticamente agentico.

Fonte:

- [Agent-loop entries](https://github.com/OpenMinis/OpenMinis/blob/9cf3a855fecd27bb5735b84cacbd56852a3ab8dd/src/ios/Providers/ProviderConfigStore.swift#L1594-L1708)

### Voce

OpenMinis separa i binding ASR e TTS. Il resolver verifica modalità,
credenziali e disponibilità prima dell'uso.

- [Voice bindings](https://github.com/OpenMinis/OpenMinis/blob/9cf3a855fecd27bb5735b84cacbd56852a3ab8dd/src/ios/Providers/ProviderConfigStore.swift#L31-L39)
- [VoiceProviderResolver.swift](https://github.com/OpenMinis/OpenMinis/blob/9cf3a855fecd27bb5735b84cacbd56852a3ab8dd/src/ios/Providers/Voice/VoiceProviderResolver.swift#L359-L591)

### Tool per sessione

OpenMinis espone configurazione e override MCP per sessione. L'intervallo
esaminato non prova da solo l'enforcement al punto di invocazione. MediFlow
riusa solo il principio: ogni allowlist deve essere verificata quando il tool
viene invocato.

- [MCPStore.swift](https://github.com/OpenMinis/OpenMinis/blob/9cf3a855fecd27bb5735b84cacbd56852a3ab8dd/src/ios/Agent/Session/MCPStore.swift#L5-L73)

### Codex

OpenMinis contiene un flusso OAuth Codex con endpoint OpenAI e un
identificatore client incorporato.

- [CodexOAuthManager.swift](https://github.com/OpenMinis/OpenMinis/blob/9cf3a855fecd27bb5735b84cacbd56852a3ab8dd/src/ios/Providers/OpenAI/OAuth/CodexOAuthManager.swift#L14-L121)

Questo codice prova solo il comportamento del progetto OpenMinis. Non prova
che il protocollo sia un contratto supportato per integrazioni terze. MediFlow
non deve copiare identificatore, token flow o assunzioni di readiness.

## Esito del confronto

| Tema | Pattern riusabile | Limite MediFlow |
| --- | --- | --- |
| Provider | Separare istanza, modello, capability e binding. | Il registry non decide policy clinica e non apre egress. |
| Gruppi | Risoluzione ordinata e verificabile. | Nessun load balancing clinico. Fallback clinico chiuso per default. |
| Agenti | Allowlist esplicita e grant riducibili. | Un ruolo agentico non eredita dati o tool clinici. |
| Voce | Binding ASR e TTS distinti. | La cattura mobile non autorizza inferenza cloud. |
| Tool | Restrizione per richiesta o sessione. | I tool clinici partono da servizi applicativi interni, non da MCP generici. |
| Mobile | Stato e capability visibili. | Il client paired non diventa il runtime clinico autorevole. |
| Codex | Handshake e capability esplicite. | Codex resta `engineering`, senza contesto paziente o write clinici. |

## Correzione del modello proposto

Un unico `IntelligenceExecutionContext` con `providerId` e `modelId` mescola
policy della lane e risultato della risoluzione. MediFlow deve usare due
oggetti distinti.

### Policy della richiesta

La lane applicativa costruisce una policy immutabile prima del resolver. La
policy comprende almeno:

- identificatore richiesta, sessione e policy version;
- piano di autorità, tipo di operazione, classe dati e modalità;
- zone di esecuzione ammesse;
- riferimento alla policy egress e al consenso, quando richiesto;
- retention, revisione e provenienza richieste;
- tool scope massimi e kill switch applicabile;
- regola di fallback, chiusa per impostazione iniziale.

La policy non concede autorità clinica. Non contiene credenziali. Un eventuale
pin esplicito a provider o modello è un vincolo della richiesta, non prova di
readiness. Il piano `engineering_operator` rifiuta dati sanitari, transcript,
allegati e tool clinici. Il piano `clinical_application` non contiene
`clinical.write`: ogni scrittura resta un comando applicativo successivo.

La classe amministrativa resta personale e soggetta a policy restrittiva. Non
è sinonimo di dato anonimo o de-identificato.

### Ricevuta della risoluzione

Il resolver produce una ricevuta separata con:

- provider instance e modello effettivi;
- zona effettiva;
- capability verificate;
- fallback applicato o motivo del blocco;
- versione della policy, decisione egress per il candidato e stato dei gate;
- riferimenti di audit e provenienza senza PHI nei log tecnici.

Un provider adapter riceve solo una richiesta già autorizzata. Non può
allargare zone, tool scope, retention, egress o autonomia.

## Invarianti da formalizzare

1. Un binding incompatibile fallisce prima dell'inferenza.
2. Capability dichiarata, compatibilità statica e readiness per tentativo sono
   stati distinti.
3. Il fallback per dati o output clinici è disabilitato per default.
4. Ogni candidato di fallback è task-specifico, contrattualmente equivalente
   e rivalutato contro tutti i gate.
5. Un fallback non può allargare egress, zona, retention, tool scope o
   autonomia e non può ridurre revisione o provenienza.
6. Nessun fallback locale-cloud è silenzioso. Nessun fallback avviene dopo
   anteprima o autorizzazione.
7. Il load balancing non è ammesso per output clinici.
8. I piani `clinical_application` ed `engineering_operator` usano credenziali
   e grant disgiunti. Il tipo di operazione non concede dati, tool o write.
9. Le grant per richiesta o sessione possono solo restringere la policy della
   lane.
10. ASR e TTS hanno binding distinti. TTS non produce evidenza clinica.
11. Il mobile paired può catturare, ma home-base mantiene resolver, provider,
    credenziali e decisione di inferenza.
12. Consenso alla cattura, trasferimento ed egress sono decisioni distinte.
13. Raw audio resta locale e temporaneo per impostazione iniziale.
14. Credenziali provider, grant cliniche e contesto paziente non sono
    distribuiti ai client paired.

## Revisione indipendente

La chat embedded richiesta dall'utente ha restituito `FINDINGS`. Il connettore
non espone l'identità del modello, quindi la richiesta di GPT-5.6 Pro non è
verificabile.

Il revisore non ha rilevato P0 o P1. Ha rilevato cinque P2 documentali:

1. separare piano di autorità e tipo di operazione;
2. separare policy immutabile e tentativo risolto;
3. non trattare i dati amministrativi come classe sicura per l'egress;
4. restringere il fallback clinico per task e candidato;
5. rendere espliciti i gate mobile e home-base della pipeline voce.

Le correzioni sono incorporate in questo audit e in ADR 0086. Due P2 runtime
restano assegnati alle issue: readiness distinta dalle capability dichiarate e
test negativi trasversali. Le note P3 conservano il boundary GPLv3, il divieto
di copiare OAuth Codex e il limite dell'evidenza MCP esaminata.

Il riesame embedded delle correzioni ha restituito:
`CLOSED — P2 1-5 chiusi documentalmente`. Questo esito chiude i blocker
documentali del confronto. Non prova readiness runtime e non promuove ADR 0086
oltre `Proposed`.

## Mappa sulle issue esistenti

| Issue | Formalizzazione |
| --- | --- |
| WUL-499 | Conservare nell'ADR gli invarianti, i piani di autorità, la separazione policy/ricevuta e il confine provider-agnostic. |
| WUL-502 | Definire schema di registry, capability dichiarate, readiness, role binding, allowlist, ASR/TTS e fallback governato. |
| WUL-522 | Definire egress per tentativo, consenso, retention, audit e stop rule verso cloud. |
| WUL-518 | Limitare Codex a `engineering`; richiedere handshake e capability; vietare OAuth copiato. |
| WUL-422 | Valutare cattura, VAD, ASR, retention, cancellazione e sidecar sul Mac home-base. |
| WUL-523 | Validare pairing, readiness, consensi distinti e disconnessione, senza promuovere una feature clinica. |

Non serve una nuova issue generale. I sei packet coprono le responsabilità
distinte. Una nuova issue è giustificata solo se emerge un owner o un confine
runtime non assegnabile a questi packet.

## Pattern da non adottare

MediFlow non adotta:

- chiamate dirette del client mobile a provider clinici;
- fallback silenzioso da locale a cloud;
- load balancing per output clinici;
- MCP o shell generici sul piano clinico;
- credenziali provider sui client paired;
- sincronizzazione iCloud del contesto clinico o delle grant;
- eccezioni ATS globali;
- OAuth Codex non documentato come contratto terzo.

## Limiti

Questo audit non prova qualità clinica, conformità, readiness runtime o
supporto ufficiale di un provider. Non aggiunge provider, voce, egress, tool o
scritture. ADR 0086 resta `Proposed`.

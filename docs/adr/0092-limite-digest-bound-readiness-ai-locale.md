# ADR 0092: Limite digest-bound della readiness AI locale

Date: 2026-07-28
Status: Accepted

Related: [ADR 0077](./0077-ai-provider-abstraction-and-egress-anonymization-boundary.md)
e [ADR 0086](./0086-intelligent-scaffold-and-graded-automation-boundary.md).

---

## Problema

La readiness AI locale deve legare una prova al modello che produce ogni
risposta. Il runtime Ollama corrente non espone questo legame causale.

Ollama 0.32.x espone il digest nei descrittori `/api/tags` e `/api/ps`. La
risposta di inferenza espone il nome del modello, ma non il digest produttore.

Una lettura del digest prima e dopo l'inferenza rileva alcuni cambi. Non
impedisce la sostituzione del modello durante l'inferenza.

La sequenza ABA `X → Y → X` può lasciare lo stesso digest alle due letture.
Il controllo non può quindi qualificare l'output.

## Stato corrente

I percorsi Ollama presenti ricevono l'annotazione
`available_unqualified`. Il loro uso resta locale e review-first sotto i
confini esistenti.

`available_unqualified` è un'annotazione di readiness ed evidenza. Non è uno
stato operativo, non sostituisce `runtime` e non modifica gli stati ammessi.

L'annotazione descrive disponibilità tecnica. Non significa `verified`, `ready`
o `qualified`.

La futura osservazione `digest_bracketed_best_effort` richiede un nuovo caso
d'uso e un packet separato. L'osservazione descrive solo rilevazione
best-effort.

Il digest A3 ha stato `observed_not_causal`. La qualified readiness resta
`HOLD`. Il protocollo Ollama corrente non permette di raggiungerla. D0 non
sblocca WUL-418.

Un endpoint loopback non dimostra `egress=none`. Un daemon locale può
instradare un riferimento cloud o usare strumenti di rete.

Un futuro gate local-only deve verificare in modo positivo:

- modello locale senza marker remoto;
- funzioni cloud del runtime disabilitate;
- strumenti e rete disabilitati o limitati dal contratto;
- processo esecutore e venue effettiva osservabili.

Queste verifiche non cambiano lo stato A3 `observed_not_causal`.

## Confini invarianti

`clinical_application` e `engineering_operator` sono lane separate. Nessuna
lane eredita grant, provider, modello, credenziali, consenso o fallback.

Nessuna capability deriva dal provider, dalla località o dal nome del modello.
Una receipt o un tipo non autorizza un consumer.

Il modello non esegue scritture cliniche autonome. Questo packet non usa
PHI/PII, credenziali reali, egress implicito o fallback implicito.

Nello stato corrente, iPhone e iPad non invocano provider direttamente. I
client paired chiamano l'host autorizzato.

Questo stato non vieta una futura capability Apple on-device. Un ADR separato
deve prima definire supporto, policy, dati, provenance e review.

Anche la futura delega AI al Mac home-base richiede un ADR separato. Pairing,
grant AI, revoca e confine plaintext restano decisioni aperte.

## Opzioni

1. Trattare il controllo pre/post del digest come qualified readiness.
2. Trattare il controllo pre/post come detection best-effort.
3. Bloccare anche i percorsi review-first già presenti.

## Trade-off

- L'opzione 1 crea un claim non dimostrabile e non rileva lo swap ABA.
- L'opzione 2 conserva un segnale diagnostico senza attribuirgli autorità.
- L'opzione 3 riduce la superficie, ma supera il problema osservato.

## Decisione

Selezioniamo l'opzione 2. Il bracket pre/post è detection best-effort, non
prevention.

Il runtime legacy riceve l'annotazione `available_unqualified` e resta
review-first. L'annotazione non cambia lo stato operativo `runtime`.

Un futuro packet può proporre `digest_bracketed_best_effort` per un caso d'uso
nuovo.

Nessun esito locale positivo usa i termini `verified`, `ready` o `qualified`.
La qualified readiness resta `HOLD`.

Un timeout o un abort futuro resta interno al runtime. Una nuova API non
accetta un `AbortSignal` del chiamante.

Il runtime deve scartare ogni completamento tardivo. Il timeout non prova
l'arresto del processo remoto.

## Superficie transitoria da rimuovere

L'API A2 `resolveForLane` accetta digest e `ReadonlySet` forniti dal chiamante.
Questi valori non costituiscono una prova affidabile.

Le primitive A1 `capability-attestation.ts` e `readiness.ts` dipendono dallo
stesso contratto. Sono codice da rimuovere, non primitive inerti.

La rimozione avverrà dopo D0 nelle slice seguenti:

| Slice | Perimetro | Gate |
| --- | --- | --- |
| C0a | Test lane e allowlist della receipt legacy | Misurare gross LOC; stop oltre circa 300 |
| C0b | Registry A2 e `resolveForLane` | Misurare gross LOC; stop oltre circa 300 |
| C0c | A1, `capability-attestation.ts` e `readiness.ts` | Misurare gross LOC; stop oltre circa 300 |

Ogni slice deve avere file ownership esclusiva e verifica indipendente.
Nessuna slice può ampliare egress, autonomia o scope clinico.

## Conseguenze

- A3 resta `observed_not_causal`: il digest è identità osservata, non prova
  causale dell'output.
- Il runtime legacy mantiene lo stato `runtime` e riceve l'annotazione
  `available_unqualified`.
- Nessuna receipt abilita una lane o un consumer.
- La roadmap deve sostituire A1/A2, non costruire sopra quelle primitive.
- La qualified readiness resta `HOLD` fino a una prova causalmente adeguata.
- La rimozione di A1 e A2 è autorizzata solo nelle slice C0a-C0c.
- Un ADR distinto deve definire il contratto Intelligence Fabric.

## Non-obiettivi

D0 non:

- implementa sessioni digest-bracketed;
- modifica codice runtime o test prodotto;
- abilita provider remoti, egress o fallback;
- cambia i flussi clinici o la parity Apple;
- definisce il contratto Intelligence Fabric;
- autorizza AI on-device, delega home-base o cloud;
- promuove una lane, WUL-418 o la release 0.8.

## Regole di arresto

Fermare un packet se:

- presenta il bracket come prevention;
- tratta un digest pre/post come legame causale;
- usa una receipt o un tipo come autorizzazione;
- unisce `clinical_application` ed `engineering_operator`;
- introduce provider diretti su iPhone o iPad;
- introduce PHI/PII, credenziali reali o egress implicito;
- supera circa 300 gross LOC senza una nuova suddivisione;
- una decisione contrattuale resta aperta.

## First Thin Slice

1. Registrare D0 come packet solo documentale.
2. Eseguire C0a con ownership esclusiva e test sintetici.
3. Eseguire C0b solo dopo la verifica di C0a.
4. Eseguire C0c solo dopo la verifica di C0b.
5. Riesaminare una nuova API solo in un ADR o packet distinto.

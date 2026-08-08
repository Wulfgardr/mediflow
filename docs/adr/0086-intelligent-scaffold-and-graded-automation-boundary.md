# ADR 0086: scaffolding intelligente e automazione graduata

Date: 2026-07-24
Status: Accepted

Issue: WUL-499

Program line: post-0.8
Baseline commit: `2355a46a4dde63b1956a2298d99ef0b5c4208222`
Baseline status: candidato locale 0.8 provvisorio e immutabile per questo
programma

Related:
[ADR 0012](./0012-operator-reviewed-smart-import-from-patient-context.md),
[ADR 0042](./0042-document-driven-new-patient-review-and-prudent-therapy-persistence.md),
[ADR 0051](./0051-patient-import-decision-contract-between-review-and-persistence.md),
[ADR 0065](./0065-intended-purpose-and-claims-guard.md), [ADR 0073](./0073-treatment-reasoning-athena-boundary.md),
[ADR 0077](./0077-ai-provider-abstraction-and-egress-anonymization-boundary.md) e
[ADR 0084](./0084-document-diagnoses-review-only.md).

## Problema

MediFlow ha già funzioni locali per documenti, sintesi, terminologie e
ragionamento terapeutico. Ha anche contratti parziali per provider opzionali.
Queste funzioni non formano ancora un unico runtime conversazionale.

Serve un contratto comune che distingua:

- ciò che è operativo sulla baseline locale verificata;
- il comportamento che resta obbligatorio per ogni futura integrazione;
- le funzioni pianificate ma non consegnate;
- le azioni che MediFlow non deve eseguire in modo automatico.

Senza questa distinzione, una proposta può sembrare una decisione clinica, un
record derivato può sembrare una scrittura clinica e una tabella di
conversazioni può sembrare una inbox intelligente già operativa.

## Quadro decisionale

- **Esito:** adottare un contratto provider-agnostic per lo scaffold, con
  pipeline locale indipendente dai provider opzionali.
- **Ambito:** contratto e roadmap post-0.8. Questo ADR non aggiunge un nuovo
  runtime e non modifica il candidato 0.8.
- **Orizzonte:** integrazioni successive alla 0.8, separate per dominio.
- **Vincoli:** local-first, dati sintetici nel repository, provenienza,
  revisione umana e arresto in caso di ambiguità.
- **Stop immediato:** nessun egress implicito, accesso diretto del provider al
  database o applicazione automatica di diagnosi e prescrizioni.

## Fatti verificati sulla baseline locale 0.8

| Area | Stato implementato | Limite attuale |
| --- | --- | --- |
| Provider AI | `AIService` usa `ProviderAdapter`; Ollama è l'unico provider operativo. | Registry, binding per ruolo e provider cloud non sono consegnati. Il gate egress resta `closed_pending_redaction_lane`. |
| Document Ops | Allegati, OCR locale, classificazione, artifact di evidenza e sintesi documentale sono presenti. | L'upload nella scheda paziente è una base parziale. La sintesi salva proposte in `documentInsights`, non in `patients.diagnoses`. |
| Smart Import | Analizza fonti locali, confronta candidati con ICD-11 e catalogo farmaci e mostra una review selettiva. | La scrittura avviene solo dopo selezione esplicita nel flusso Smart Import. Non è una regola generale di automazione. |
| Identità da documento | Il contratto distingue CF paziente, medico, operatore e struttura e produce candidati con evidenza. | Non esegue da solo link, merge o creazione della scheda paziente. |
| Sunto clinico | Patient Insight seleziona fonti locali, applica priorità e recency, genera punti azionabili e salva `aiSummary`. | `aiSummary` è una proiezione derivata. Non modifica diagnosi, terapie o altri record clinici strutturati. |
| Atena | Treatment Reasoning usa il contratto `mediflow.treatment_reasoning.v1`, un runtime locale e un kill switch. | Le policy di scrittura previste sono `no_write`, `review_only` e `form_prefill_only`; gli intenti delle azioni restano un dominio distinto. |
| Conversazioni | Esistono tabelle e route CRUD per conversazioni e messaggi. | Non esistono ancora inbox intelligente, buffer effimero locale, chiarimento guidato o conversione confermata in record clinici. |

Le evidenze principali sono `lib/ai-service.ts`, `lib/ai-egress-gate.ts`,
`lib/domain/documents/document-synthesis-service.ts`,
`app/api/patients/[id]/smart-import/route.ts`, `lib/ai-summary-service.ts`,
`lib/treatment-reasoning-service.ts` e le route CRUD di conversazioni e
messaggi.

## Decisione

MediFlow adotta questa sequenza:

```text
pipeline locale -> proposta -> chiarimento -> anteprima
-> autorizzazione contestuale -> eventuale scrittura applicativa auditata
```

La pipeline locale resta operativa senza Codex, senza un modello esterno e
senza connessione Internet. Comprende le euristiche deterministiche, la
classificazione, la normalizzazione e i controlli di contratto disponibili per
la singola lane.

Un modello locale o esterno può aiutare solo quando la funzione e la policy lo
consentono. Il provider non diventa l'autorità sul dato e non ottiene un
accesso diretto al database.

Il livello di chiarimento è indipendente dal provider. Può essere testo, card o
visualizzatore, ma deve restare disponibile anche quando il modello non è
configurato.

## Contratto per dominio

### 1. Document Ops e import

- **Input:** allegati caricati o importati e testo ottenuto da una fonte
  locale verificabile.
- **Output:** testo normalizzato, classificazione, artifact di evidenza,
  elementi clinici candidati e confronti con terminologie o cataloghi
  configurati.
- **Provenienza e revisione:** ogni candidato indica fonte ed evidenza. Le
  diagnosi della sintesi restano in `documentInsights`. Smart Import resta una
  lane distinta con selezione e applicazione esplicite.
- **Provider:** euristiche locali sempre disponibili; Ollama opzionale per le
  lane configurate; Apple Vision è solo il fallback OCR macOS già governato.
  Altri provider richiedono un packet separato.
- **Privacy:** elaborazione locale per impostazione iniziale; nessun documento
  intero viene inviato a un servizio esterno in modo implicito.
- **Test richiesti:** fixture sintetiche per parsing, provenienza, deduplica,
  ICD-11, farmaco, principio attivo e posologia; falsifier per envelope
  ambiguo; prova che la sintesi non modifichi record clinici strutturati e che
  Smart Import applichi solo candidati e campi selezionati.

### 2. Derivazione e riconciliazione anagrafica

- **Input:** elementi identificativi estratti con contesto e ruolo della fonte.
- **Output:** candidati `review_identity`, `link_existing_patient` o
  `create_patient_candidate`.
- **Provenienza e revisione:** il candidato conserva l'evidenza. Link, merge e
  creazione richiedono conferma umana; un conflitto torna a
  `review_identity`.
- **Provider:** il matching deterministico resta locale. Un provider può
  proporre un candidato, ma non può decidere l'identità.
- **Privacy:** i dati identificativi non escono dal dispositivo senza un
  contratto di egress separato e una scelta esplicita.
- **Test richiesti:** CF con ruoli diversi, checksum non valido, omocodia,
  identità multiple, target assente e conflitti tra paziente e prescrittore;
  nessun link, merge o `create_patient` prima della conferma.

### 3. Sunto clinico

- **Input:** fonti locali selezionate, dati recenti, terapie attive,
  osservazioni, diario e documenti con provenienza.
- **Output:** quadro, attenzioni, prossimi passi, gap, fonti e limiti.
- **Provenienza e revisione:** ogni claim usa riferimenti ammessi oppure viene
  marcato come dato incompleto. `aiSummary` resta una proiezione derivata e
  rivedibile.
- **Provider:** oggi il percorso è locale. Un provider futuro può assistere la
  generazione, ma non decide e non scrive record clinici strutturati.
- **Privacy:** il contesto resta locale per impostazione iniziale e applica
  budget, esclusioni e minimizzazione.
- **Test richiesti:** priorità e recency, fonti stale o duplicate, claim senza
  fonte, contesto invariato, fallimento del provider e assenza di modifiche a
  record strutturati diversi da `aiSummary`.

### 4. Atena

- **Input:** contesto locale delle terapie, diagnosi, osservazioni, documenti e
  domanda dell'operatore.
- **Output:** bozza di ragionamento, evidenze, caveat, safety flag e azioni
  suggerite.
- **Provenienza e revisione:** i riferimenti devono appartenere alle fonti
  ammesse. L'output resta una bozza da rivedere.
- **Provider:** il runtime ATHENA-R1 locale già integrato resta dietro kill
  switch. Tool esterni e provider remoti non sono impliciti.
- **Privacy:** nessun prompt o output clinico grezzo entra nel repository o in
  log persistenti.
- **Test richiesti:** schema, task, evidence ref, kill switch, route locale,
  output non valido e write policy limitata a `no_write`, `review_only` o
  `form_prefill_only`; il prefill non salva, invia o conferma.

### 5. Inbox conversazionale

- **Input previsto:** racconto libero, nota incompleta o documento indicato
  dall'utente.
- **Output previsto:** buffer effimero locale, da definire nel packet della
  inbox, candidati strutturati e domande di chiarimento.
- **Provenienza e revisione:** nessun candidato diventa diario, task, proposta
  prescrittiva o paziente senza conversione confermata.
- **Provider:** la funzione deve funzionare con la pipeline locale; un provider
  resta un coadiuvante opzionale.
- **Privacy:** il buffer temporaneo deve avere durata, cifratura, cancellazione
  e confini di egress definiti prima dell'implementazione.
- **Test richiesti:** ambiguità, annullamento, scadenza del buffer, conferma del
  paziente o target, autorizzazione dell'anteprima esatta e mancata scrittura.
  Nella 0.8 non deve esistere una route raggiungibile che converta il contenuto
  conversazionale in un record clinico.

Questa funzione è **roadmap**. Non è una funzione live completa e resta fuori
dalla release 0.8.

### 6. Contratto provider-agnostic

- **Input:** task versionato, contenuto minimo necessario e policy della lane.
- **Output:** risposta strutturata, provider effettivo, modalità `local`, `lan`
  o `cloud`, stato attività e proiezione dello stato di autorizzazione ricevuta
  dalla lane applicativa.
- **Provenienza e revisione:** le superfici che invocano un provider, mostrano
  un suo output o dipendono da una sua azione devono indicare provider effettivo
  e stato runtime. Il provider non crea, eleva o conferma l'autorizzazione e non
  deve simulare una query, un accesso o una sessione.
- **Provider:** locali, LAN o cloud dietro lo stesso confine contrattuale.
  Oggi è operativo solo Ollama.
- **Privacy:** opt-in, minimizzazione, possibile pseudonimizzazione solo quando
  verificata per il flusso, audit locale e fallback review-only. Nessun claim
  di anonimizzazione garantita. La pseudonimizzazione non è mai sufficiente ad
  aprire il gate egress.
- **Test richiesti:** funzionamento senza provider, stato derivato dal runtime,
  gate egress chiuso per default, revoca, errore, degrado e assenza di accesso
  diretto al database. Configurazione, login, processo avviato o risposta valida
  non equivalgono ad autorizzazione.

Il contratto non consegna registry, selezione per ruolo o un secondo provider
operativo. La sostituzione del provider richiede ancora un packet runtime.
Un packet UI separato deve definire per web e Apple un indicatore testuale
sempre visibile con provider effettivo, modalità, autorizzazione applicativa e
attività. L'indicatore deve essere accessibile e non deve dipendere da loghi.

## Contratti dei tool clinici locali

WUL-499 riserva quattro nomi di contratto. Questi nomi non sono ancora
implementati nel runtime. I moduli di evidenza, terminologia e FHIR esistenti
sono basi tecniche, non prova che i quattro tool siano consegnati.

La prima implementazione deve essere un servizio applicativo interno, locale e
deterministico. I nomi `*.v1` identificano le sue interfacce versionate, non
tool invocabili direttamente dal provider. Un futuro adapter CLI o tool può
delegare allo stesso servizio, ma non aggiunge rete, accesso al database o
autonomia. Questa scelta evita IPC e orchestrazione senza un requisito
concreto.

Ogni futuro risultato usa lo stesso envelope minimo: `schemaVersion`,
`status` (`ok`, `review_required`, `blocked` o `error`), `data`, riferimenti di
provenienza e `issues` con codice, severità e percorso. Il log conserva solo
metadati redatti.

| Contratto | Input e output | Errori fail-closed | Consumer e autonomia |
| --- | --- | --- | --- |
| `evidence.extract.v1` | Fonte locale autorizzata -> fatti candidati e riferimenti. | Fonte assente, testo insufficiente, provenienza ambigua. | Document Ops, Patient Insight e Smart Import; estrae, non scrive. |
| `terminology.validate.v1` | Candidato, sistema e contesto -> match e issue. | Sistema non ammesso, fonte indisponibile, match ambiguo. | Smart Import, Atena e preflight di write; valida, non sceglie un codice ambiguo. |
| `fhir.project.v1` | DTO locale e profilo -> Bundle candidato. | Risorsa non supportata, mapping incompleto, profilo assente. | Export FHIR; proietta, non persiste e non usa la rete. |
| `fhir.validate.v1` | Bundle candidato e validator lock locale -> issue. | Validator o profilo incoerente, tentativo di rete, input non valido. | Review export; valida, non invia e non prova conformità FSE. |

Schema dettagliato, consumer invocabili ed error taxonomy eseguibile richiedono
un packet runtime separato. Finché manca, ogni chiamata nominale resta
`blocked`, non un fallback libero.

## Regola di ambiguità

Se un campo obbligatorio per l'azione proposta non è sostenuto da evidenza
sufficiente, MediFlow si ferma. Non inferisce il dato mancante, non sceglie un
codice e non scrive. Se la lane dispone del chiarimento interattivo, presenta
una domanda scritta mirata. Negli altri casi restituisce `review_required` con
il campo irrisolto e la domanda da mostrare.

Esempio: una descrizione compatibile con BPCO, senza diagnosi esplicita o grado,
produce una richiesta di chiarimento. Non produce una diagnosi o un codice
applicabile.

## Contratto per una futura scrittura

Una futura scrittura assistita richiede tutti questi elementi:

1. utente autorizzato e sessione valida;
2. autorizzazione esplicita one-shot, vincolata a utente, sessione, `actionId`,
   paziente, target, tipo di record, anteprima esatta e versione concorrente;
3. paziente, target e tipo di record inequivocabili;
4. anteprima completa dei campi che cambiano;
5. validazione di schema, terminologia e versione concorrente;
6. audit con provenienza, attore, target ed esito, senza contenuto clinico nei
   log tecnici;
7. transazione eseguita dall'applicazione, non dal provider.

L'autorizzazione scade o viene invalidata dopo annullamento, primo tentativo,
cambio del contesto o modifica dell'anteprima. Ogni mismatch fallisce chiuso.

Il flusso Smart Import esistente resta una lane applicativa specifica con
selezione esplicita. Questo ADR non lo trasforma in un'autorizzazione generale
alla scrittura tramite modello.

## Automazione graduata in roadmap

I packet futuri possono valutare questi livelli, in ordine:

1. proposta;
2. anteprima;
3. autorizzazione;
4. finestra di annullamento, quando il dominio la consente;
5. rollback definito per il tipo di record;
6. pannello audit.

Diagnosi, prescrizioni, identità paziente e altre azioni cliniche ad alto
rischio non sono auto-applicabili per impostazione iniziale. Un livello diverso
richiede policy, ADR, threat model, test e ratifica separati.

## Presidio

- script: `scripts/check-ai-clinical-write-gate.mjs` (`npm run check:ai-clinical-writes`).

Il gate rende eseguibili tre clausole di questo ADR: `aiSummary` resta una proiezione
derivata che non modifica record clinici strutturati (§3); le write policy di Atena
restano l'insieme chiuso `no_write` / `review_only` / `form_prefill_only` (§4); Smart
Import resta l'unica lane che scrive dati clinici, con selezione esplicita dell'operatore
e versione concorrente attesa, e non importa il percorso AI.

Il gate non copre le clausole che non hanno ancora un runtime: inbox conversazionale,
autorizzazione one-shot vincolata all'anteprima, rollback e finestra di annullamento
restano affidati ai packet futuri.

## Conseguenze

- La parte locale resta utilizzabile anche se nessun provider è disponibile.
- Document Ops, identità, sunto, Atena e provider mantengono ownership e test
  separati.
- La distinzione tra proiezione derivata e scrittura clinica diventa esplicita.
- La inbox conversazionale e la scrittura assistita possono evolvere senza
  ampliare implicitamente le funzioni 0.8.
- Ogni nuovo provider deve dimostrare il proprio stato e attraversare i gate
  della lane.

## Non-obiettivi

Questo ADR non:

- implementa la inbox conversazionale;
- apre il gate egress o aggiunge un provider cloud;
- abilita Codex Operator ad accedere o scrivere direttamente nel database;
- autorizza persistenza automatica di diagnosi, terapie o prescrizioni;
- promuove WUL-361 fuori dal proprio packet review-only;
- modifica l'attuale parser degli envelope AI;
- sostituisce i client Apple, la web app o la loro matrice di parity;
- dichiara compliance, anonimizzazione garantita o superiorità clinica.

## Stop rules

Fermare il packet se una modifica:

- introduce egress clinico implicito o aggira `ai-egress-gate`;
- permette a un provider di interrogare direttamente il database;
- applica un dato clinico ambiguo invece di chiedere chiarimento;
- applica diagnosi, prescrizioni o identità paziente per default;
- nasconde provider, autorizzazione, attività o provenienza;
- usa una risposta del modello come prova di autorizzazione;
- rimuove il fallback locale o rende un provider esterno necessario;
- tratta test backend come prova sufficiente della parity web/Apple.

## First Thin Slice

1. Mantenere questo ADR accettato e distinto dalla release 0.8, senza modifiche
   runtime nel packet documentale.
2. Allineare README e roadmap e verificare la topologia, distinguendo stato
   reale e futuro.
3. Aggiornare WUL-499 senza creare una issue duplicata.
4. Eseguire gate documentali e una verifica indipendente.
5. Aprire packet separati solo per gap confermati, con owner, threat model,
   test e criterio di promozione.

---
summary: "Run record CoS del programma provider intelligenti post-0.8, con stato reale, trust boundary, matrice superfici, packet e gate."
read_when:
  - "Valutando provider AI, egress, credenziali o parity intelligente dopo MediFlow 0.8."
  - "Preparando WUL-269, WUL-499, WUL-502, WUL-518 o WUL-522 senza ampliare la release 0.8."
---

# Provider intelligenti MediFlow post-0.8

Stato documento: `SECONDARY / RUN RECORD`

Run ID: `MFP-AI-COS-20260728-01`

Data: 2026-07-28

Modalità: `worktree / solo-verify`

Controller: `CoS Open Minis style`, GPT-5.6 Sol high

Verdetto primo ciclo: `PARTIAL`

Raccomandazione: `GO` per il successivo packet locale WUL-502;
`HOLD_IMPLEMENTATION` per provider cloud, broker credenziali e UX di consenso.

Questo run è solo post-0.8. Non modifica, promuove o pubblica il candidato 0.8.

## 1. Contratto del run

| Campo | Valore |
| --- | --- |
| Root programma | `<wul269-worktree>/medical-record-app` |
| Branch | `codex/WUL-269-post-0.8-ollama-locality` |
| Baseline immutabile | `2355a46a4dde63b1956a2298d99ef0b5c4208222` |
| Candidato 0.8 | `codex/mediflow-0.8-release-candidate-local`, pulito sulla baseline |
| Runtime HEAD prima del run record | `0043f487a55002c7adac014285a73fdc93f15c84` |
| Dati | Solo fixture sintetiche, metadati pubblici e prove senza prompt clinici |
| Esclusioni | PHI/PII, database reale, credenziali, push, PR, merge, tag, release e mutazioni Linear |
| Promotion rule | Un output locale è candidato. Servono diff, test e verifica indipendente sullo stesso HEAD |

RepoPrompt è stato usato per lookup, lettura e review del diff. Non sono stati
avviati subagent, swarm o Sol Ultra. GPT-5.6 Pro nella finestra incorporata è
stato usato solo per due decisioni ad alto rischio: gate iniziale e review
egress/privacy terminale.

## 2. Fonti e tracker recuperati

| Fonte | Uso nel run |
| --- | --- |
| Audit Open Minis `<historical-audit-task>` | Baseline clean-room e separazione dei piani di autorità |
| ADR 0086 | Contratto scaffold intelligente, accettato per il programma post-0.8 |
| WUL-269 | Packet locality/no-egress Ollama consegnato nel branch |
| WUL-499 | ADR e contratto provider; nessuna mutazione Linear |
| WUL-502 | Prossimo registry task-provider-modello, ancora non consegnato |
| WUL-518 | Codex Operator personale, owner-only e separato dal piano clinico |
| WUL-522 | Scaffold cloud ed egress, ancora chiuso |
| WUL-52, WUL-88, WUL-89, WUL-417, WUL-466 | Contesto esistente controllato per deduplica |

Non è stata creata alcuna issue. Stato Linear e stato runtime non sono
intercambiabili: una issue aperta può avere codice parziale; un ADR accettato
non dimostra un runtime.

## 3. CURRENT_STATE_MAP

### Baseline 0.8

- Ollama è l'unico provider generativo operativo.
- `AIService` e `OllamaProviderAdapter` servono le lane cliniche locali.
- Patient Insight, Smart Import, Document Synthesis, OCR e treatment reasoning
  hanno UI o servizi esistenti con kill switch e review umana.
- Il gate egress cloud resta chiuso.
- Non esistono registry provider, broker credenziali o provider cloud live.
- I client Apple non chiamano direttamente Ollama.

### Branch post-0.8 corrente

- ADR 0086 è `Accepted` solo per il programma post-0.8.
- Ollama è limitato a HTTP loopback e alla famiglia verificata `0.32.x`.
- Prima del payload: version, tags, show, preload senza prompt e verifica
  `/api/ps` sullo stesso digest.
- Dopo il payload: modello e marker remoti sono verificati di nuovo.
- Discovery mostra solo descrittori locali.
- Model pull è disabilitato nella lane clinica local-only.
- Nessun nuovo provider, segreto, schema, consenso o UI è stato aggiunto.

### Stato per superficie

| Superficie | UI intelligente esistente | Servizio/provider effettivo | Credenziali provider | Esecuzione e dati | Fallback/offline | Prova |
| --- | --- | --- | --- | --- | --- | --- |
| localhost | Impostazioni AI, Patient Insight, Smart Import, sintesi documentale, OCR, Atena | `AIService` → Ollama | Nessuna per Ollama locale | Da processo web a daemon loopback; contesto clinico solo dopo gate | Funzioni manuali disponibili; kill switch; errore AI non blocca la cartella | Codice, 11 test, smoke locale sintetico |
| localhost | Discovery modelli | `/api/ai/models` → `/api/tags` | Nessuna | Solo metadati modello | Lista vuota/errore; nessun pull | Guard statico e filtro locality |
| macOS | Stato funzioni AI e insight già prodotti; conversazioni AI dichiarate assenti | Home-base MediFlow; provider indiretto Ollama del nodo | Token pairing/sessione MediFlow, non credenziale AI | Il client non riceve grant Ollama e non accede a SQLite | Contenuti non-AI e dati già sincronizzati restano consultabili secondo il contratto paired | Sorgenti Swift e matrice parity |
| macOS | OCR fallback Apple Vision | Vision locale, solo fallback macOS | Nessuna | On-device; immagine nel processo autorizzato | Ollama primario; fallback prudente | ADR 0059 e route OCR |
| iPhone | Stato AI/insight read-only del paziente | API home-base; nessun adapter provider nel client | Pairing + sessione MediFlow | Elaborazione sul nodo home-base; nessun login provider incorporato | Nessuna AI diretta; app non deve dipendere dalla rete per il core locale disponibile | Sorgenti shared Apple |
| iPad | Stato AI/insight read-only, layout nativo | API home-base; nessun adapter provider nel client | Pairing + sessione MediFlow | Come iPhone; nessun accesso provider o SQLite host | Come iPhone | Sorgenti shared Apple |
| tutte | `engineering_operator` | Runtime prodotto assente | Nessuna credenziale prodotto | Nessun contesto clinico autorizzato | Nessun impatto sul prodotto | WUL-518 e audit |
| tutte | provider cloud clinici | Runtime assente; egress gate chiuso | Broker assente | Zero invocazioni autorizzate | Ollama/manuale | ADR 0077, WUL-522 |

La parity richiesta è di intenzione ed esito, non pixel-identica. Web mantiene
struttura accessibile nativa. macOS, iPhone e iPad devono usare interazioni
native e prove visuali correnti quando verrà aperto un packet UX.

## 4. Piani di autorità

| Piano | Grant ammessi | Grant vietati |
| --- | --- | --- |
| `clinical_application` | Input selezionato, proposta, provenienza, review e apply applicativo esplicito | Shell, filesystem host, SQLite diretto, scrittura clinica autonoma |
| `engineering_operator` | Owner-only, repository selezionato, read-only iniziale | Contesto paziente, credenziali cliniche, grant del piano clinico |
| provider on-device | Capability dichiarata della singola piattaforma | Eredità di grant home-base o cloud |
| provider home-base | Endpoint e capability del nodo paired | Accesso diretto al database o identità del client come grant provider |
| provider cloud | Solo payload deidentificato, consenso e policy espliciti | Egress predefinito, retention ignota, grant di altri provider |

Nessun provider eredita consenso, credenziali, retention o strumenti da un
altro piano.

## 5. Trust boundary

```text
utente e core manuale
  -> clinical_application [review-first]
      -> ProviderAdapter [nessun DB/shell/filesystem]
          -> loopback Ollama 0.32.x [L0 attested]
          -> home-base LAN [packet separato]
          -> cloud egress [CHIUSO]

owner
  -> engineering_operator [read-only, contesto selezionato]
      -X-> clinical_application
```

Il receipt L0 è effimero e contiene solo provider, versione, modello, digest,
classe endpoint e istante. Non contiene prompt o dati clinici. Un processo
ostile su localhost resta fuori dal threat model L0; non è lecito trasformare
questo limite in un claim di isolamento assoluto.

## 6. Confronto clean-room

| Pattern concettuale osservato | Adozione MediFlow | Vincolo |
| --- | --- | --- |
| Adapter provider | Sì, interfaccia interna | Nessun codice Open Minis copiato |
| Selezione provider/modello | Sì, tramite registry futuro | Non dedurre capability dal nome |
| Readiness e capability | Sì, manifest verificabile | Configurato non significa autorizzato |
| Login/account provider | Solo dopo verifica ufficiale per provider | Nessun login consumer generico |
| Fallback ordinato | Solo fail-closed e dichiarato | Mai trasformare failure in egress |
| Tool o plug-in esterni | Non nel piano clinico | Nessun accesso host implicito |

L'audit di riferimento non è una licenza di riuso. Codice, asset e componenti
GPL non entrano nel repository. Anche modelli e pesi Ollama conservano le loro
licenze specifiche; la licenza del runtime non autorizza automaticamente un
modello.

## 7. Auth, termini e App Store

| Provider | Flussi ufficiali rilevanti | Decisione MediFlow |
| --- | --- | --- |
| Ollama | Locale senza credenziale; sign-in può abilitare cloud; `OLLAMA_NO_CLOUD` richiede configurazione daemon | L0 usa evidenza runtime e non assume il flag |
| OpenAI clinical | API key e billing API | ChatGPT consumer non equivale a credito API |
| OpenAI operator | Codex supporta Sign in with ChatGPT nel client Codex | Valido solo per WUL-518, mai ereditato dal piano clinico |
| Anthropic clinical | API Console/key; OAuth Claude Code è specifico del client | Piano Claude consumer non equivale a API |
| Google Gemini | API key o OAuth con progetto Cloud | Piano consumer non è assunto come grant API |

Fonti ufficiali verificate:

- [Ollama API e modello locale](https://docs.ollama.com/api) e
  [disattivazione cloud](https://docs.ollama.com/faq);
- [OpenAI: ChatGPT e API hanno billing separato](https://help.openai.com/en/articles/8156019-is-api-usage-included-in-chatgpt-subscriptions-even-if-i-have-a-paid-chatgpt-account)
  e [Codex con piano ChatGPT](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan);
- [Anthropic: piano Claude e API separati](https://support.anthropic.com/en/articles/9876003-i-subscribe-to-a-paid-claude-ai-plan-why-do-i-have-to-pay-separately-for-api-usage-on-console)
  e [auth Claude Code](https://docs.anthropic.com/en/docs/claude-code/getting-started);
- [Gemini API key](https://ai.google.dev/gemini-api/docs/api-key) e
  [OAuth Gemini API](https://ai.google.dev/gemini-api/docs/oauth);
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).

Per Apple, un futuro provider terzo richiede disclosure di dati e destinatario,
permesso esplicito prima della condivisione, privacy policy con retention,
revoca e cancellazione, e verifica delle regole login. Un login provider non
deve diventare il login primario MediFlow per errore.

## 8. Commit e prove L0

| Commit | Contenuto |
| --- | --- |
| `70fb2b8d9` | ADR 0086 e documenti post-0.8 |
| `60ac147b7` | Contratto e test locality |
| `0bd93b1c9` | Enforcement adapter |
| `312479032` | Enforcement route e guard statici |
| `0043f487a` | Pull chiuso, preload/digest, log e schema drift |

Gate terminali:

- 11/11 test Ollama;
- typecheck Node 24.18.0;
- ESLint mirato senza warning;
- `check:never-regress` verde;
- attestazione live senza prompt su Ollama 0.32.5;
- chat live con sola fixture sintetica;
- GPT-5.6 Pro: primo `HOLD_FIX`, poi `GO`;
- candidato 0.8 ancora pulito sulla baseline.

## 9. Decision audit

| Decisione | Stato | Falsificatore |
| --- | --- | --- |
| Separare il programma dalla release 0.8 | Accettata | Una modifica nel worktree candidato |
| Accettare ADR 0086 prima del runtime | Accettata | Un overclaim di funzione live 0.8 |
| Limitare L0 a loopback e Ollama 0.32.x | Accettata | Endpoint LAN/cloud o versione non qualificata accettati |
| Preload senza prompt e stesso digest in `/api/ps` | Corretta | Payload clinico inviato prima della reservation |
| Disabilitare ogni model pull | Corretta | Qualunque fetch `/api/pull` dalla lane |
| Trattare marker schema-drift come remoto | Corretta | Tipo inatteso accettato come locale |
| Considerare localhost ostile fuori L0 | Aperta e dichiarata | Requisito futuro di identità forte del daemon |
| Persistenza receipt e consenso | Aperta | Qualunque write prima di ADR/schema dedicati |

Le decisioni aperte bloccano cloud e claim forti. Non bloccano l'uso locale
review-first appena verificato.

## 10. DAG dei packet

| Packet | Dipende da | Owner/path probabili | Falsificatore | Gate |
| --- | --- | --- | --- | --- |
| P0 ADR/run record | baseline | docs | Stato runtime confuso con roadmap | Gate doc |
| P1 WUL-269 locality | P0 | `lib/ai-providers`, route Ollama | Payload prima del gate o pull attivo | Test + live + review |
| P2 WUL-502 registry locale | P1 | nuovo worktree; provider/registry/AIService | Provider non registrato o fallback implicito | Unit + typecheck |
| P3 manifest/readiness/receipt | P2 | provider contracts, nessun DB | Capability dichiarata senza prova | Contract test |
| P4 WUL-522 egress scaffold | P3 + ADR | egress policy/deidentificazione | Egress senza consenso/retention | Security review |
| P5 credential broker | P4 | Keychain/server secret boundary | Segreto in UI, log o database clinico | Revoca + negative tests |
| P6 UX web/Apple | P3-P5 | file distinti per piattaforma | Pixel parity o stato ingannevole | A11y + screenshot + interaction |
| P7 WUL-518 operator | Contratto separato | worktree owner-only | Contesto clinico o write grant | Read-only proof |

Ogni packet usa un issue, un branch e un worktree dedicati. Un file ha un solo
owner per wave.

## 11. Classificazione release

| Orizzonte | Scope |
| --- | --- |
| `0.8` | Nessun elemento di questo programma |
| `post-0.8` | L0 Ollama, registry locale, manifest, readiness, receipt effimero e UX stato locale |
| `v1.0` | Cloud opt-in, deidentificazione, retention, BYOK/OAuth verificati, broker e consenso cross-surface |

## 12. Error ledger

| Evento | Contenimento |
| --- | --- |
| Codemap RepoPrompt non disponibile | Lettura file RepoPrompt; nessun risultato inventato |
| Worktree senza dipendenze | Toolchain del candidato usata read-only; nessuna installazione |
| Timeout di 1 secondo durante typecheck | Symlink temporanea rilevata e rimossa; run ripetuto |
| Fixture URL bloccate da never-regress | Sostituite con marker sintetici non-URL |
| Review Pro `HOLD_FIX` | Pull rimosso, digest reservation, marker e log corretti |

## 13. Next permitted action

Preparare un packet WUL-466 dalla HEAD verificata di WUL-418. Definire prima i
profili degradati e il contratto di fallback OCR multipiattaforma. Non cambiare
runtime, provider, credenziali, schema, UI o egress senza un packet separato.

Stop immediato se la baseline finale 0.8 diverge nei file toccati, se il
registry introduce fallback di rete o se una lane tenta di ereditare grant da
un altro piano.

## 14. Continuazione WUL-502

### 14.1 Identità

| Campo | Valore |
| --- | --- |
| Worktree | `<wul502-worktree>/medical-record-app` |
| Branch | `codex/WUL-502-post-0.8-provider-registry` |
| Base | `b09b538d8647760f1d5bfa94de8d84b19497712d` |
| Commit contratto | `4e2bb68f5` |
| Commit integrazione | `ac0322e43` |
| Controller | GPT-5.6 Sol High |
| Verificatore | RepoPrompt GPT-5.6 Sol XHigh, contesto fresco |
| GPT-5.6 Pro | Non usato: nessuna decisione oltre il livello Fable-class |

### 14.2 Esito

Il registry locale seleziona provider e modello dalla configurazione indicizzata
per task. I servizi applicativi non costruiscono più direttamente l'adapter
Ollama. La prima fase accetta solo Ollama su loopback e non applica fallback.

Il manifest distingue le capability di trasporto dalla capability del modello.
La ricevuta contiene solo metadati di selezione. Non contiene endpoint, prompt,
credenziali o dati clinici. La readiness del modello resta esplicitamente
richiesta e non viene dichiarata per inferenza.

### 14.3 Evidenza

- 23 test mirati: `PASS`;
- typecheck con Node 24.18.0: `PASS`;
- ESLint mirato con zero warning: `PASS`;
- `check-never-regress`: `PASS`;
- ricerca dei costruttori diretti di `AIService`: nessun bypass;
- review indipendente iniziale: `HOLD_FIX`;
- review indipendente dopo le correzioni: `GO`.

### 14.4 Decision audit

| Decisione | Stato | Falsificatore |
| --- | --- | --- |
| Default provider solo quando il valore è assente | Accettata | Stringa vuota sostituita in silenzio |
| Modello selezionato nel registry dalla mappa per task | Corretta | Factory pubblica accetta un modello libero |
| Fallback `none` e ricevuta immutabile | Corretta | Consumer modifica la ricevuta o cambia provider |
| Capability del modello non dedotta dal nome | Accettata | Manifest dichiara readiness senza attestazione |
| Capability specifica del modello | Aperta | Task OCR promosso senza prova `vision` |
| Provider remoti e consenso | Aperti | Qualunque egress prima dei gate dedicati |

Le decisioni aperte bloccano la promozione di nuovi modelli e ogni provider
remoto. Non bloccano il commit del registry locale.

### 14.5 Error ledger

| Evento | Contenimento |
| --- | --- |
| Tentativo iniziale con runner Vitest assente | Usato il runner `run-strip-types` canonico |
| Toolchain non visibile nel worktree | Symlink temporanea al toolchain esistente, poi rimossa |
| Primo comando aggregato senza `set -e` | Typecheck corretto e intera suite ripetuta con `set -e` |
| Review `HOLD_FIX` | Centralizzato il modello; provider vuoto ora fallisce; receipt congelata |

### 14.6 Verdetto

Packet WUL-502: `GO`.

Programma complessivo: `PARTIAL / HOLD_IMPLEMENTATION` per provider remoti,
consenso, capability specifiche del modello e UX multipiattaforma.

## 15. Continuazione WUL-418

### 15.1 Identità

| Campo | Valore |
| --- | --- |
| Worktree | `<wul418-worktree>/medical-record-app` |
| Branch | `codex/WUL-418-post-0.8-runtime-matrix` |
| Base | `18088c008` |
| Commit matrice | `cc6c036cd` |
| Controller | GPT-5.6 Sol High |
| Verificatore | RepoPrompt GPT-5.6 Sol XHigh, contesto fresco |
| GPT-5.6 Pro | Non usato: riconciliazione documentale verificabile |

### 15.2 Esito

La matrice canonica post-0.8 separa:

- stato operativo: `runtime`, `shadow`, `benchmark_only`, `hold`;
- readiness WUL-418: `revalidation_required` o `blocked`;
- fitting tecnico e serving promosso;
- fallback e authority plane di ogni task.

Le lane operative esistenti non sono state promosse. Restano utilizzabili sotto
i boundary review-first già presenti, ma nessun cambio di modello, provider o
claim è ammesso prima della ricertificazione completa.

### 15.3 Evidenza

- `git diff --check`: `PASS`;
- indice Markdown completo: `PASS`;
- claims guard: `PASS`;
- ricerca Foundation Models nel tree: nessuna implementazione;
- review indipendente iniziale: `HOLD_FIX`;
- review indipendente dopo la separazione stato/readiness: `GO`.

### 15.4 Decision audit

| Decisione | Stato | Falsificatore |
| --- | --- | --- |
| Separare call path esistente e readiness WUL-418 | Corretta | `runtime` letto come ricertificazione completa |
| Mantenere soglie qualità e risorse lane-specific | Accettata | Soglia universale senza benchmark |
| Isolare fallback e grant per task | Accettata | Fallback OCR ereditato da un'altra lane |
| Attestare capability specifiche del modello | Aperta | Capability dedotta dal nome |
| Profili degradati multipiattaforma | Aperta | Claim parity senza fallback verificato |

Le decisioni aperte bloccano nuove promozioni. Non bloccano la matrice di
governance.

### 15.5 Verdetto

Packet WUL-418: `GO`.

Programma complessivo: `PARTIAL / HOLD_IMPLEMENTATION`.

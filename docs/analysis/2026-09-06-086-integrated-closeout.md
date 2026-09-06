# MediFlow 0.8.6: candidato locale integrato

Data: 6 settembre 2026. Branch `codex/WUL-669-086-integrated-candidate`.
Base del programma: `b72ac713b624e7d771262e4e01c5c5e1f56f9ae2`.
Stato: candidato funzionale locale integrato e verificato; redesign visivo
macOS ancora aperto dopo la revisione dell'utente. Fermo prima della PR.
Nessun push, PR, tag o release.

Questo verbale aggiorna lo stato del candidato. Le prove precedenti della
[base funzionale](./2026-09-06-086-functional-closeout.md) e della
[promozione web](./2026-09-06-086-integrated-ui-verification.md) mantengono
il proprio commit e perimetro; non vengono attribuite retroattivamente al
candidato finale. I contratti dei componenti restano negli ADR pertinenti.

## Comportamento consegnato nel candidato

- La UI ordinaria usa B con barra superiore; Aspetto permette di scegliere
  A con barra laterale. Il confronto con Originale rimane nel solo launcher
  sintetico. Un clic apre la cartella; navigazione, compilazione progressiva,
  gerarchia del testo e slider sono condivisi dalle pagine applicative.
- La base funzionale conserva provenienza e recupero OCR, stato delle
  funzioni, onboarding locale, rinnovo dell'accesso, setup host Ollama e
  timestamp dell'export FHIR. Le prove e i limiti specifici restano nel
  verbale della base.
- Search WHO usa il sidecar locale scelto dall'utente: endpoint loopback
  fisso, attivazione esplicita, risultati limitati e validati, cache distinta
  dalla risposta diretta. URI e identità degli artifact accompagnano la
  selezione; audit e modifica web/native conservano la provenienza.
  [ADR 0115](../adr/0115-icd11-who-reference-data-adapter.md) e
  [setup](../icd-who-setup.md) ne definiscono il confine.

- La cartella Apple mostra una sezione alla volta; le bozze sopravvivono alla
  consultazione dei Documenti. Il testo digitato legge lo stato corrente e
  la trascrizione finalizzata Mac resta separata, con conferma prima della
  sostituzione. [Verbale Apple](./2026-09-06-086-apple-ui-verification.md).
- La modifica della sola diagnosi aggiorna il dirty state: l'uscita chiede
  conferma, l'annullamento conserva la compilazione e non effettua scritture.
  Il reset della provenienza quando si torna al testo libero rimane esplicito.

## Verifica finale

Ambiente web: Node 24.19.0, ABI 137, dipendenze fisiche nel worktree,
`env -i`, `MEDIFLOW_DATA_DIR` esplicita e fixture sintetiche. La suite unitaria
crea la propria directory temporanea; `MEDIFLOW_E2E_DISABLE_LEGACY_COPY=1`
impedisce al preparatore di copiare il database legacy. Nessun servizio WHO
viene abilitato per queste prove.

Sorgenti eseguibili finali: `a3e402f825dd778115fddb83cd789757e359a770`, worktree
pulito all'avvio della build. Il server standalone ha restituito
`codex/WUL-669-086-integrated-candidate@a3e402f825dd:clean` da
`/api/system/revision`. Le successive correzioni del verbale sono documentali.
Log finali: `/tmp/mf086-final-c6f84emr/logs/`; indice e ricevuta locali in
`tmp-086-integrated/`.

| Verifica sul candidato unificato | Risultato |
| --- | --- |
| Build webpack e postbuild standalone | PASS, Node 24.19.0 / ABI 137. |
| Build Xcode Debug macOS arm64 e iOS Simulator | PASS, Xcode 26.6 / SDK 26.5, firma disabilitata. |
| SwiftPM: Core provenienza, selezione, documenti, S7, layout, binding e VisitRecording | 128 eseguiti: 127 PASS, uno skip previsto per benchmark senza manifest, zero fallimenti. |
| Browser ordinario: UI, bozze, accesso, stato funzioni e onboarding | Nove scenari PASS nel primo lotto. La prova WHO di persistenza si è fermata prima dell'accesso per un marcatore di fixture mancante. |
| WHO: selezione, sostituzione, cifratura, rilettura e modifica anagrafica | PASS separato dopo il completamento del marcatore della fixture già sintetica e isolata. Query e risposte WHO simulate; API, cifratura e SQLite reali. |
| Suite unitaria conclusiva `npm run test:unit` | 3.185 eseguiti: 3.184 PASS, uno skip previsto, zero fallimenti; 70,6 s senza compilazioni concorrenti. |
| Lint, typecheck, never-regress, claims, Lume, OpenAPI, AnyDoc local-only e crosswalk Fabric | PASS finali. |
| Manifest e confine WHO, retirement Docker | Nove test script PASS. |

Tutti i dieci scenari browser previsti sono coperti dai due lotti, non da
un'unica esecuzione senza errori. Le sorgenti UI Apple e i test del progetto
Xcode sono identici a `f231d9a82`; il delta Core WHO è incluso nella build e
nelle prove SwiftPM qui sopra. Le due prove di bozza su iPhone/iPad restano
quelle del verbale Apple, non un nuovo run UI sul candidato integrato.

La prima suite integrata ha eseguito 3.185 test: 3.183 riusciti, uno skip
previsto e un errore nel fingerprint AST del controllo Next. Il solo delta
di configurazione esclude gli strumenti sintetici dal tracing, secondo ADR
0123. Dopo la verifica del diff, il fingerprint è stato riallineato; tutti
i 23 test del confine di accesso sono passati. Alias, inclusione dell'owner
e controlli negativi restano invariati. La ripetizione durante le build ha
incontrato un solo timeout di 1,5 secondi nell'avvio del processo Mini; nessun
timeout o codice di autenticazione è stato modificato. La ripetizione senza
compilazioni concorrenti è passata integralmente. Il primo timeout è compatibile
con il carico concorrente, ma non costituisce una misura generale di prestazioni.

Il guard egress ha inoltre richiesto una sola eccezione per il test nativo di
selezione: host UUID su `.invalid`, sessione effimera e URLProtocol che intercetta
ogni richiesta, compresi gli host sconosciuti. L'eccezione è limitata a quel
file e alla sola interpolazione; non abilita un endpoint dell'applicazione.

## Revisione visiva macOS ancora aperta

L'utente osserva che l'app Mac rimane sostanzialmente simile alla precedente.
La rifinitura verificata qui cambia soprattutto navigazione interna e gestione
delle bozze; non soddisfa ancora il redesign visivo complessivo richiesto.
Restano da ripensare rapporto tra navigazione e lista pazienti, gerarchia
della cartella, accesso alle sezioni e strumenti di scrittura. I test passati
non costituiscono accettazione estetica e questa lane non viene dichiarata chiusa.

## Limiti e promozione

- WHO non è provisionato: digest immagine, snapshot, accettazione della
  licenza, riavvio offline e ripristino restano da registrare. Nessuna prova
  contro un catalogo installato; lookup e cross-check puntuali sono fuori
  da questa implementazione Search. Il manifest non equivale all'attivazione.
- Prove su simulatori e Mac locale non attestano pairing, dispositivi fisici,
  installazione esterna, firma, notarizzazione o distribuzione Apple.
- La matrice regolatoria rimane un dossier tecnico da sottoporre alla
  revisione competente; `legalVerdict: not_assessed`. Non attesta conformità
  o adozione organizzativa.
- Resta documentato l'[incidente di inizializzazione del database standard](./2026-09-06-086-functional-closeout.md#incidente-nella-verifica-del-binding)
  avvenuto nella verifica precedente. Nessun record clinico letto o riportato;
  `quick_check` prova l'integrità strutturale, non l'assenza di modifiche.
  Non esiste una fotografia precedente sufficiente e non è stato tentato
  un ripristino. Il reader iniettato ora evita quell'import del database.

La consegna richiesta si ferma alla patch locale revisionabile. Le issue
non sono dichiarate chiuse e non sono state modificate su GitHub o Linear.

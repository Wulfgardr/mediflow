# MediFlow 0.8.6: candidato locale integrato

Data: 6 settembre 2026. Branch `codex/WUL-669-086-integrated-candidate`.
Base del programma: `b72ac713b624e7d771262e4e01c5c5e1f56f9ae2`.
Stato: verifica finale in corso. Nessun push, PR, tag o release.

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

La cartella Apple e la regressione sulla modifica di una sola diagnosi sono
in verifica finale; la loro integrazione verrà registrata prima della chiusura.

## Verifica finale

Ambiente web: Node 24.19.0, ABI 137, dipendenze fisiche nel worktree,
`env -i`, `MEDIFLOW_DATA_DIR` esplicita e fixture sintetiche. La suite unitaria
crea la propria directory temporanea; `MEDIFLOW_E2E_DISABLE_LEGACY_COPY=1`
impedisce al preparatore di copiare il database legacy. Nessun servizio WHO
viene abilitato per queste prove.

Log finali: `/tmp/mf086-final-c6f84emr/logs/`; indice e ricevuta locali in
`tmp-086-integrated/`. I risultati conclusivi saranno aggiunti dopo il freeze
dei sorgenti. Non si deduce il successo da una sola compilazione.

La prima suite integrata ha eseguito 3.185 test: 3.183 riusciti, uno skip
previsto e un errore nel fingerprint AST del controllo Next. Il solo delta
di configurazione esclude gli strumenti sintetici dal tracing, secondo ADR
0123. Dopo la verifica del diff, il fingerprint è stato riallineato; tutti
i 23 test del confine di accesso sono passati. Alias, inclusione dell'owner
e controlli negativi restano invariati. La ripetizione finale resta distinta.

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

# Proposta terapeutica: composizione e prove

Part of WUL-787. Unità 8 dell’addendum Punto d’inchiostro, filone W della 0.9.1.

Il ragionamento terapeutico segue il registro Terapie dentro la disclosure comune
«Proposte», chiusa all’apertura. Aprirla non genera contenuti; richiuderla conserva
la preparazione e il risultato. A funzione spenta restano solo il prerequisito e
«Apri le funzioni cliniche». Il modello usa la riga del `FunctionModelPicker`
esistente. Preparazione e conferma hanno il ruolo secondario comune; le cause
della disabilitazione sono adiacenti e collegate con `aria-describedby`.

La proposta usa la matita, il tratteggio e i riferimenti alle fonti. Il pannello
terapeutico non si duplica nel Riepilogo. Conferma di paziente e ambulatorio,
consenso, scelta del modello, controller, attualità delle fonti, provider e
assenza di applicazione del risultato conservano il percorso esistente.
Non cambia il contratto API (`no contract impact`).

## Revisioni e superficie

- Base e tutte le catture prima: `0a1980f323d62b4a7c2e1f01e0950a3ac5da218f`.
- Fix applicativo: `6f94f57b939d25c05d6dd4c323eb6b02ac1b2eb6`.
- Tutte le catture dopo e build: `be6ab1d43ad59c1ff06667ce6621ac7d2d58f2e2`.
  Questa revisione corregge soltanto un tipo nella prova E2E rispetto al fix.
- Le successive modifiche riguardano test, inventario ed evidenze: i due file
  applicativi restano identici alla revisione delle catture dopo.
- Node 24.21.0, ABI 137; `npm ci` reale nella worktree dedicata e nella sorgente
  sparse di build. Nessuna build o esecuzione nella checkout primaria.
- Misure solo con l’harness E2E Chromium. Dati inventati e directory temporanee,
  con copia legacy disabilitata; nessuna apertura di archivi clinici reali.
- Trasporto della proposta simulato: le prove non attestano inferenza ATHENA
  reale né una nuova ammissione clinica.

Prima e dopo hanno revisioni applicative differenti, esplicitate nel manifest.
Ciascuna serie usa un solo SHA e lo stesso schema di fixture per ogni stato;
non sono immagini attribuite retroattivamente allo SHA finale della PR.

## Difetto, fix, falsificazione

Sulla base le tre prove pertinenti falliscono: manca la disclosure chiusa,
la funzione spenta conserva pulsanti e modello, la conferma usa il pulsante
pieno locale. Il fix supera le sette prove di composizione dei cinque stati.

Rimuovendo temporaneamente entrambi i file applicativi del fix, quattro prove
tornano rosse: le tre precedenti e la matita della proposta. Ripristinando il fix,
le otto prove mirate, compresa quella touch, passano. Nessuna modifica al modello
formale o ai controlli clinici è stata necessaria.

## Verifiche

- E2E: 47 casi distinti verificati, compresi i 25 di Terapie già integrata,
  i cinque stati della proposta, disclosure/tastiera/bozza, fonti, payload strict,
  cambio ambulatorio che annulla la conferma, annullamento e kill switch.
  Primo run esteso: 45 verdi e un errore nella vecchia attesa geometrica;
  recupero: prova strict e nuovo caso touch, 2/2 verdi.
- La ricetta comune misura 40 px con puntatore e almeno 44 px al tocco.
  La vecchia prova chiedeva 44 px anche con puntatore: ora distingue i due casi,
  mantenendo i controlli su fuoco, limiti del viewport e bersaglio cliccabile.
  Il nuovo caso touch verifica 1440, 768, 390 e 320 px.
- `npm run test:unit`: rosso, come sulla base. Primo gruppo: 7.765 test,
  7.723 passati, 28 falliti, 14 saltati, senza nuovi fallimenti.
  Poiché il runner si ferma al primo gruppo rosso, i due gruppi seriali residui
  sono stati eseguiti separatamente con gli stessi argomenti: 61/61 e 66/66 verdi.
  [Elenco completo e confronto dei rossi](./unit-preesistenti.md).
- `test:inventory-browser`: verde, tutte le quattro ricette del gruppo.
- Lint, typecheck, test-selection e i suoi 141 test: verdi dopo le correzioni.
- Never-regress, claims, type-scale, lume-tokens e relativo test, motion-budget:
  verdi. Crosswalk Fabric (check e test), function-models e treatment-reasoning:
  verdi.
- Build di produzione: verde dalla sorgente sparse pulita, con la sola esclusione
  della fixture SQLite Swift prevista dal progetto; manifest Node/ABI, controllo
  standalone e preparazione del runtime completati.
- Nessun file della copertura formale è modificato. È stato comunque eseguito
  `verify:therapy-status`: modello corrente verde, 5.903.794 stati distinti,
  28.149.669 generati e coda vuota; mutanti, testimoni e prove controller/HTTP
  qualificati. [Risultato strutturato e limiti finiti](./formal-result.json).

Il controllo d’inventario iniziale ha rilevato la nuova fixture di supporto non
registrata; l’esclusione motivata nomina entrambi gli spec che la consumano.
Il primo tentativo nella worktree dev incontrava anche `EISDIR` sugli output
Next temporanei: arrestato il server posseduto e rimossi solo quegli output,
il controllo ordinario passa. Sono rilavorazioni risolte, non deroghe ai test.

## Catture

[Manifest con revisione e SHA-256 di tutte le 120 immagini](./captures.json).
Giorno e Grafite, stati spento/pronto/in corso/proposta/errore: 1440, 768, 390 e
320 px, più zoom Chromium reale 200% e 400%. Lo zoom usa `tabs.setZoom/getZoom`,
verifica `innerWidth` e produce PNG del viewport fisico 1440×1000, verificati.
Le catture zoom mostrano la porzione di pagina raggiunta tramite scorrimento;
non sono una riduzione artificiale dell’immagine.

- Spenta, Grafite 390: [prima](./captures/prima-grafite-390-spenta.png), [dopo](./captures/dopo-grafite-390-spenta.png).
- Pronta, Giorno 1440: [prima](./captures/prima-giorno-1440-pronta.png), [dopo](./captures/dopo-giorno-1440-pronta.png).
- In corso, Grafite 768: [prima](./captures/prima-grafite-768-in-corso.png), [dopo](./captures/dopo-grafite-768-in-corso.png).
- Proposta, Giorno 1440: [prima](./captures/prima-giorno-1440-proposta.png), [dopo](./captures/dopo-giorno-1440-proposta.png).
- Errore, Giorno zoom 200%: [prima](./captures/prima-giorno-zoom-200-errore.png), [dopo](./captures/dopo-giorno-zoom-200-errore.png).

## Scelte di design e limiti

Il prerequisito spento resta dentro «Proposte», inizialmente chiusa, applicando
insieme D6 e D14. I comandi restano secondari anche quando pronti, per coesistere
con Nuova voce e con il form Terapie senza un secondo principale.
Non restano dubbi di design aperti nel perimetro locale di questa unità.

Sviluppo assistito: GPT 6.1 Sol, effort High. Rilavorazioni: data della fixture
incompatibile con il controllo di attualità, alias del tipo estratto, attesa
desktop precedente alla ricetta comune e registrazione della fixture di supporto.
Non sono disponibili consumi attribuibili al solo contributo.

## Correzione review P2: gerarchia dei titoli

La disclosure «Proposte» resta h3; «Ragionamento terapeutico» diventa h4,
conferma del contesto e quattro sottotitoli della proposta diventano h5.
I selettori CSS seguono i nuovi livelli, conservando tipografia e spaziature.

Il test E2E della gerarchia completa usa `getByRole('heading', { level })`:
rosso su `2b387c2fa`, verde con il fix, rosso reintroducendo temporaneamente
h3 sul pannello. Dopo il ripristino, tutti i 23 casi dei tre file E2E interessati
sono verdi, incluse 60 catture sintetiche, tastiera, touch e zoom reale.

Verifiche locali con Node 24.21.0: inventario browser, lint, typecheck,
guard di selezione, claims, dashboard, schema writer, scritture AI, confine DB,
error leak, never-regress, crosswalk Fabric, Apple QA, MLX, OpenAPI, schema drift,
audit, Lume, scala tipografica e movimento. Crosswalk Fabric, Treatment Reasoning
e function-models verdi anche nei rispettivi test.
La suite unit completa ha 7.765 casi nel primo gruppo: 7.748 passati,
3 falliti, 14 saltati. Gruppi seriali residui: 61/61 e 66/66 verdi.
I tre errori macOS e il confronto aggiornato con main sono riportati
[separatamente](./unit-preesistenti.md#verifica-della-correzione-p2).

Sviluppo assistito: GPT 6.1 Sol, effort Medium. Rilavorazione: adeguamento
dei livelli semantici e dei selettori CSS; nessun cambiamento al contratto clinico.


## Correzione della selezione E2E dopo la CI

Il caso Treatment Reasoning di `ordinary-chatgpt-four-functions.spec.ts`
tentava «Prepara proposta» senza aprire «Proposte», chiusa per impostazione
iniziale. Ora apre la disclosure con il ruolo button e verifica
`aria-expanded` prima di raggiungere i comandi. Anche gli altri tre spec che
usano il pannello verificano lo stato accessibile dopo l’apertura, compresa
l’interazione da tastiera. Le asserzioni su source bindings, trace remoto,
consenso e assenza di scritture restano intatte; nessun runtime è modificato.

La precedente selezione locale copriva Terapie, composizione, payload strict e
kill switch, ma ometteva il consumatore trasversale ChatGPT. I 47 casi dichiarati
non erano l’intero insieme dei consumatori del pannello: mancava la ricerca per
identificativo prima della scelta degli spec. La selezione di questa correzione
è ricavata dal contenuto, includendo tutti i quattro file trovati:

```bash
grep -rlE 'treatment-reasoning-panel|TreatmentReasoningPanel|treatment-proposal-disclosure' e2e --include='*.spec.ts'
```

La ricerca più ampia di `treatment-reasoning-panel`, `Prepara proposta` e
`Conferma e genera proposta` in `e2e`, `tests` e nei test di componenti,
librerie e script trova anche comandi di Smart Import e Document Synthesis,
oltre a controlli statici del sorgente: non attraversano questa disclosure.

Verifiche locali prima del push, con Node 24.21.0: 28/28 casi dei quattro
spec verdi, senza retry; `test:inventory-browser` verde con tutte le quattro
ricette; lint e `git diff --check` verdi. Verdi i 17 guard di selezione test,
claims, dashboard, schema writer, scritture AI, confine DB, error leak,
never-regress, crosswalk Fabric, Apple QA, MLX, OpenAPI, schema drift, audit,
scala tipografica, token Lume e movimento.

Sviluppo assistito: GPT 6.1 Sol, effort Medium. Rilavorazione: estensione della
selezione E2E al consumatore ChatGPT omesso e verifica di `aria-expanded`.

## Timeout CI delle catture del selettore — 23 ottobre 2026

Il [job cancellato al limite di 35 minuti](https://github.com/Wulfgardr/mediflow/actions/runs/39918541045/job/120298054848)
eseguiva la head PR `a7b585b952553beb1dbb30ff6fcc9e57549937d2` tramite il merge
di prova `30b908c041b7`. I dodici casi di cattura di `choice-field.spec.ts`
fallivano anche al retry: 24 tentativi, 1.134,5 secondi complessivi di test
falliti, escluso il riavvio dei worker. Non erano limitati ai quattro viewport
Giorno: comprendevano anche Grafite e i due zoom reali.

La causa appartiene a #622: lo spec entrava in Terapie e cercava `Cambia`
nel selettore terapeutico senza aprire la nuova disclosure `Proposte`,
inizialmente chiusa. L'attesa fallisce in `chooseLongName`, non nella gerarchia
dei titoli. `choice-field.spec.ts` era identico su main e sulla PR.

Confronto locale con dati inventati e copia legacy disabilitata:

- Main `18c0a179b`: spec completo, 15/15 verdi in sviluppo (1,6 minuti).
  Anche il successivo controllo sul bundle standalone production passa 15/15.
- PR originale `a7b585b95`: tre timeout anche in sviluppo prima
  dell'interruzione del primo run; run completo in produzione: 12 falliti,
  3 passati, 9,7 minuti senza retry. Tutti i rossi attendono il pulsante
  `Cambia` nascosto, con il timeout ordinario di 45 secondi.
- Correzione: verifica `aria-expanded=false`, apre `Proposte` dentro
  `#terapie`, verifica `aria-expanded=true`, poi esercita il selettore
  esistente. Nessuna modifica ai componenti, ai timeout o alla quarantena.
- Spec corretto sullo stesso bundle production: 15/15 verdi, 1,5 minuti.
  La shard completa esercita nuovamente tutti i quindici casi dopo il
  ripristino della falsificazione.
- Falsificazione: togliendo soltanto il click la nuova asserzione osserva
  `aria-expanded=false`. Rimuovendo poi tutte le quattro righe del fix,
  il caso Giorno 1440 riproduce il timeout originale sul pulsante `Cambia`.
  Ripristino completo: lo stesso caso passa in 5,6 secondi.

Le build production isolate partono da sorgenti pulite, con la sola
esclusione della fixture SQLite Swift prevista dalla CI. Node 24.21.0,
ABI 137, Playwright 1.58.2 e Chromium bloccato 145.0.7632.6, verificato dal
browser avviato. Il bundle PR resta attribuito ad `a7b585b95`: il nuovo diff
contiene soltanto il percorso E2E e questo verbale.

Consumatori cercati con `grep -rl` per `TreatmentReasoningPanel`,
`treatment-reasoning-panel` e il modulo CSS, poi seguendo la composizione in
Terapie. Sono verdi tutti i sette spec pertinenti: `choice-field`,
`treatment-proposal-composition`, `treatment-reasoning-fabric-review`,
`treatment-reasoning-kill-switch`, `ordinary-chatgpt-four-functions`,
`therapy-composition` e `disclosure`: **83 casi distinti**, senza retry.
I due test unitari consumatori diretti passano 7/7.

Prima del push: inventario browser con tutte le quattro ricette, lint,
typecheck e guard di repository verdi, inclusi selezione test, claims e
self-test, dashboard, schema writer, scritture AI, confine DB, error leak,
never-regress, crosswalk Fabric, Apple QA, MLX, OpenAPI, schema drift e audit.
Verdi anche scala tipografica, token Lume, movimento, function-models e
treatment-reasoning. Accettazione UI production 6/6, harness browser ChatGPT
e smoke del catalogo home-base verdi.

Il caso del profilo account `account-profile.spec.ts:80` fallisce in production
su entrambe le revisioni con `Network.getResponseBody: No resource with given
identifier found` durante `response.json()` di `/api/auth/check`. Su main in
sviluppo passa 3/3; su main in production il controllo combinato termina con
17 passati e questo solo fallimento. Il caso passa nel vecchio job Ubuntu:
la riproduzione locale non prova un difetto Linux. È separato dal timeout
delle scelte e tracciato in [issue #625](https://github.com/Wulfgardr/mediflow/issues/625).

### Shard completa e budget

`npm run test:e2e -- --shard=1/2`, un worker e retry ordinario invariato:
207 casi selezionati, **16 minuti e 40 secondi** misurati con orologio monotono.
Esito originale conservato: 192 passati, 3 falliti, 3 instabili, 9 saltati;
exit code 1. Tutti i quindici casi `choice-field` sono verdi. Non si dichiara
verde l'intera shard.

Rossi e recuperi osservati:

- `account-profile.spec.ts:80`: errore Chromium sul corpo di `auth/check`,
  riprodotto anche al retry e su main production; issue #625.
- `function-status.spec.ts:93` e `:169`: il preflight richiede una directory
  dentro `os.tmpdir()`, diversa da `/private/tmp` su questo Mac. Il primo run
  non ha eseguito i corpi dei due test. Una nuova fixture sintetica nel percorso
  richiesto supera lo spec completo 4/4, senza retry. Nessun guard modificato.
- `account-profile.spec.ts:54`: `route.fetch` con `ETIMEDOUT` sul loopback,
  verde al retry.
- `disclosure.spec.ts:105`, Giorno 390: `page.goto` con
  `ERR_CONNECTION_TIMED_OUT` sul loopback, verde al retry e nel run consumatori.
- `document-upload-ocr.spec.ts:83`, mixed: `AnyDoc same-response observation`
  con `net::ERR_ABORTED`; classificato instabile dal report. Il test e la
  quarantena restano invariati. I casi protected/corrupt che erano falliti
  nella vecchia CI passano in questo run locale.

I nove skip derivano dai vincoli già presenti: clinical scales, i due casi
di riavvio delle preferenze e i sei casi official UI; questi ultimi sono
eseguiti nel loro passaggio production esplicito, 6/6 verdi.

Sommando le durate misurate di installazione/build, shard, accettazione UI,
inventario browser, harness ChatGPT, catalogo home-base e intero recupero WHO,
il costo locale è **19 minuti e 48 secondi**, con oltre 15 minuti rispetto al
limite di 35. È una somma conservativa di passaggi svolti anche in parallelo,
non un nuovo timeout. Non comprende provisioning del runner Linux e upload
artefatti: il budget della nuova CI deve ancora essere confermato sul nuovo
commit. Nessun merge eseguito.

Sviluppo assistito: GPT 6.1 Sol, effort High. Rilavorazioni: ripresa dei run
interrotti, isolamento dei database dei run concorrenti, porta dell'accettazione
UI adeguata al suo contratto. Consumi non attribuibili al singolo contributo.

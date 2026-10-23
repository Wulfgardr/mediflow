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

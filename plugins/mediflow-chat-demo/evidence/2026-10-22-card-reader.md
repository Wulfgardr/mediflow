# ADR 0160 — unità 2c, scheda sintetica

Revisione correttiva della head `3e4e0d7344fa3dd461c173412e2227de217dd2c9`,
in risposta alla [review Astra](https://github.com/Wulfgardr/mediflow/pull/613#pullrequestreview-5615652483)
ancorata a `d634853ef`. Base broker: `46f4c1789` (#611). Part of WUL-788.
Implementazione GPT-6.1 Sol, High; nessuna ulteriore delega, nessun merge.
La review indipendente del nuovo diff resta distinta da questi risultati.
La correzione successiva del budget parte dalla head `d3d0c2c4b` ed è stata
eseguita con GPT-6.1 Sol, effort Medium; nessun merge.

## Riproduzioni, correzioni e falsificazioni

Le prove sono state introdotte ed eseguite prima delle correzioni, con Node
**24.21.0**, `npm ci` reale nei due package root e `MEDIFLOW_DATA_DIR` sintetico
creato con `mktemp -d`. Runner neurale e osservazione dell’installazione sono
simulati soltanto nei test; broker e preparazione sono quelli reali.

| Rilievo | Prova rossa iniziale | Correzione e prova successiva |
| --- | --- | --- |
| P1 revoca | Due frame NDJSON `prepare`/`revoke` nello stesso `stdin.write`; la preparazione riusciva dopo la conferma di revoca. | Tentativo registrato prima dell’attesa; ogni revoca incrementa subito l’epoca. Ricontrollo sincrono dell’epoca subito prima dei byte, senza `await`. Test stdio verde, inclusa revoca durante runner lento. Ripristinare l’owner precedente fa fallire l’asserzione sul tentativo revocato. |
| P2 gesto forgiato | `prepare` e `share` inviati via `window.parent.postMessage` dal frame consegnavano la scheda senza clic. | Challenge distinta per tentativo, 30 s, monouso, e chiave della vista emessa una sola volta al bootstrap. Solo il listener `isTrusted` del controllo firma la challenge con HMAC-SHA-256; il tool riceve challenge e firma, mai la chiave. Messaggi forgiati anche con challenge nota, firma errata, nonce vecchio/scaduto, replay anche su una nuova preparazione e rilettura della risorsa sono negati. Rimuovere la verifica della firma fa fallire la prova reference. |
| P2 nuovo turno | Trattenere la risposta HTTP di `prepare`, notificare un nuovo turno e rilasciare la risposta riabilitava la vecchia vista. | Bootstrap riconosciuto separatamente; nuovo risultato o tool input invalida subito l’epoca. Risposta tardiva inerte, scheda nascosta e stato del nuovo turno. Prove reference verdi per entrambe le notifiche; ignorarle fa fallire entrambi i mutanti. |
| P2 budget | Aggiungere 2200 ms alle sole risposte `share` lasciava verdi **60/60** esecuzioni: `shareMs` 2336–2860 ms, mentre i gate misuravano soltanto la scelta. | `usefulMs = readyMs + shareMs`; la consegna include visibilità e due frame di rendering. Il tempo umano tra scelta e clic è escluso. Lo stesso ritardo fa fallire il gate caldo `warm useful view <=2s p95` dopo 30 aperture fredde + 30 calde. Il mutante è nel controllo negativo, insieme al blocco UI da 150 ms. |

Le prove di sicurezza vivono in `test/card-protocol.test.mjs` e
`test/card-reference.mjs`; quest’ultimo esegue gli scenari avversariali anche
nel comando ordinario. I mutanti temporanei di sicurezza sono stati ripristinati
prima della consegna. Quello delle prestazioni è permanente in
`scripts/falsify-card-performance.mjs`, selezionato dalla CI esistente.

## Risultati della revisione

- Broker **116/116**. Plugin **16 pass, 0 fail, 1 TODO** (carico esteso).
  Stdio reale, frame in entrambe le direzioni, errori e stderr controllati;
  la fixture con sentinella identificativa continua a essere bloccata.
- Reference originale ext-apps, bridge e sandbox invariati: **30 renderer
  freddi + 30 caldi**, più messaggi forgiati, nuovo turno/tool call con risposta
  trattenuta e risposta di condivisione tardiva dopo chiusura. Giorno/Grafite a
  **390/768/1440 px effettivi**, tastiera, Reduce Motion, valori approvati
  invariati, niente resize/scroll al clic.
- **Tre budget completi consecutivi verdi**, 30 aperture fredde e 30 calde
  ciascuno: **180 aperture senza task oltre 50 ms**. È conservato anche il
  task di esattamente 50 ms osservato nel primo budget. Le soglie, l’osservatore
  e gli scenari avversariali sono invariati.
- p95 della **vista utile completa**, nei tre budget: **331.3/322.7 ms**,
  **316.1/318.2 ms**, **331.0/301.8 ms** (fredda/calda). Feedback p95 massimo
  **48.9 ms**, interazioni **15.7 ms**, preparazione simulata **0.92 ms**.
  Bundle gzip invariato: **161817 byte**.
- Il precedente esito rosso, con un long task di **53 ms**, rimane nel campo
  `before` del report numerico. La profilazione di un nuovo superamento ha
  individuato **51.6 ms** nel task del renderer, ma solo **1.9 ms di CPU**:
  circa **50.3 ms** prima del ricalcolo sintetico dell’hover. Il campionamento
  nativo del renderer con il codice applicativo originario mostra
  `GetCurrentKeyModifiers → SkyLight → WindowServer/TCC`, con inizializzazione
  e IPC sincroni. Nel trace HMAC occupa **0.005 ms**, parsing al massimo
  **13.0 ms**, layout **2.0 ms**. La causa osservata è nel browser headless
  macOS, non nella verifica del nonce o nel rendering dei dati.
- L’harness usa ora il Chromium completo fornito da Playwright in modalità
  headless nuova (`channel: 'chromium'`), stessa versione **145.0.7632.6**.
  [Playwright documenta la distinzione dal precedente headless-shell](https://playwright.dev/docs/browsers#chromium-new-headless-mode).
  Host ext-apps, sandbox, CSP e codice applicativo sono invariati. I tentativi
  di differire SDK e firma non risolvevano la pausa nativa e sono stati
  ripristinati. Questo risultato qualifica il reference con il browser
  dichiarato; non dimostra la correzione di headless-shell su ogni macOS.
- Controlli negativi: lavoro sincrono da **75 ms** rilevato dal gate long task
  **>50 ms**; blocco UI reale da 150 ms rilevato dal budget feedback;
  consegna reale rallentata di 2200 ms rilevata dal budget della vista utile.
- Selezione test **140/140**, inventario **COMPLETE**. Lint e typecheck
  root/plugin passati; verifica mirata finale dei file modificati passata.
  Never-regress, claims e import headless passati. Headless **292/292**,
  intelligent-host MCP **34/34**, Mini **21/21**.
- Build plugin, browser smoke del demo originale e sua falsificazione del
  tool-result passati. Reference/prestazioni del demo originale e i suoi **sei controlli negativi**
  passati, distinti dai budget della scheda.

## Confine e riapertura

Un nonce restituito in `prepare` da solo non prova il gesto: il frame può
leggerlo. La chiave del bootstrap rimane nella closure del controllo come
chiave HMAC non estraibile e il bundle rimuove subito il proprio script dal
DOM. Il listener usa il metodo di firma nativo acquisito al bootstrap, genera
la firma soltanto dopo `isTrusted` e ricontrolla l’epoca dopo la firma asincrona.
La chiave non viene restituita da `prepare` né inviata ai tool; una firma
osservata non approva il nonce di una preparazione successiva. Il server rifiuta una seconda lettura della risorsa nella stessa
sessione MCP. Per riaprire serve una nuova sessione (su stdio, riconnettere il
plugin). Questo costo di riapertura è esplicito e non è ancora qualificato
sui desktop. La risorsa contiene asset statici e la chiave, mai dati clinici.

**L’host che controlla caricamento e renderer resta fuori dal confine**, come
da ADR 0160: può osservare la chiave e i byte. Questa prova copre messaggi
forgiati verso il tool `share` dopo il bootstrap fidato; non attesta il gesto contro un
host ostile, non autentica il medico e non qualifica la retention. Nessun
archivio reale, identificativo reale, Touch ID o writer è stato coinvolto.

## Limiti di integrazione e di qualifica

La precedente build Web resta bloccata dalla guardia preliminare:
`Build input metadata: private file is reachable`. Non si dichiara verde.
La suite unitaria root completa non è stata ripetuta senza un motivo nuovo:
l’esecuzione precedente documentata sulla PR resta **7708 pass, 29 fail,
14 skip**, con gruppi successivi **61/61** e **66/66** eseguiti separatamente.
I fallimenti Treatment Portable e prerequisiti Mac restano fuori dal diff.

**Carico esteso (100 eventi, 30 terapie, 10 documenti), GLiNER reale,
10.000 caratteri, avvio freddo server/modello, confronto nativo, import,
scritture, ricomposizione e ammissione clinica NON qualificati.** R/L su Codex
e Claude Desktop non sono eseguiti qui: il reference host non li sostituisce.
La PR non chiude WUL-788 e non viene unita.

Report numerico: [card-reference-summary.json](card-reference-summary.json).
I report completi e le catture sono negli artifact CI `dist/card-evidence`.
Istruzioni: [CARD-READER.md](../CARD-READER.md).


### Confine del contesto dopo review #615

HMAC e nonce proteggono `share`, non `ui/update-model-context`. Il bridge
accetta messaggi arbitrari dal frame; codice che lo controlla può inviare
byte propri o già approvati. Il broker non espone dati non approvati in
risorse, risultati, `structuredContent` o `_meta`. La CSP della risorsa
ammette soltanto il bundle locale con hash per istanza, gli stili necessari
e il font incorporato; non script remoti, eval o script inline aggiunti.

La consegna ora richiede `deliver` monouso sul tentativo corrente. Una
risposta `share` trattenuta oltre chiusura, revoca o nuova preparazione
fallisce chiusa. La finestra fra consumo di `deliver` e accettazione del
contesto da parte dell'host resta distribuita: una chiusura successiva al
consumo non può annullarlo. ADR 0160 descrive il limite; non è una prova
di invio a un LLM desktop né di ammissione clinica.


Prova della correzione: Node 24.21.0, directory dati temporanee sintetiche.
La regressione derivata dalla riproduzione indipendente della review
[5618565317](https://github.com/Wulfgardr/mediflow/pull/615#pullrequestreview-5618565317)
è rossa su `2906f0271`: `no late context after owner invalidation`, con un
update inatteso. Mancano inoltre `attemptId` e CSP. Dopo il fix passano le
20 regressioni del reference e gli 11 test di protocollo (compresi nei
20 pass + 1 TODO preesistente del plugin); broker 116/116, selezione completa
e 47 test delle guardie di selezione, build e typecheck plugin, lint e guardie
never-regress/claims. La falsificazione rimuove il controllo di `deliver`,
rimuove la CSP e introduce dati non approvati in `_meta` di `prepare`:
tutti e tre i mutanti rendono rosse le rispettive regressioni; i sorgenti
ripristinati sono verdi. Lo script mantiene anche i controlli negativi precedenti.

Budget e soglie sono invariati. Su 30 avvii freddi e 30 caldi del reference,
p95 vista utile 273,1/268,5 ms, feedback 30,3 ms, interazioni 15,1 ms,
preparazione con runner simulato 0,96 ms, gzip 162.121 byte e zero long task
attribuiti alla vista oltre 50 ms. Sono prove sul reference fissato, non su
un LLM o un desktop qualificato; il carico esteso dell'ADR resta distinto.

Anche i tre controlli negativi di prestazione sono rilevati: long task >50 ms,
feedback del clic e ritardo di consegna che supera il p95 caldo di 2 s.
Nessuna soglia è stata allargata.

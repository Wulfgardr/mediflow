# ADR 0160 — unità 2c, scheda sintetica

Revisione correttiva della head `3e4e0d7344fa3dd461c173412e2227de217dd2c9`,
in risposta alla [review Astra](https://github.com/Wulfgardr/mediflow/pull/613#pullrequestreview-5615652483)
ancorata a `d634853ef`. Base broker: `46f4c1789` (#611). Part of WUL-788.
Implementazione GPT-6.1 Sol, High; nessuna ulteriore delega, nessun merge.
La review indipendente del nuovo diff resta distinta da questi risultati.

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
- p95 della **vista utile completa**: **238.2 ms fredda / 233.6 ms calda**;
  feedback **46.4 ms**, interazioni **15.2 ms**, preparazione del broker con
  runner simulato **1.05 ms**. Bundle gzip **161817 byte**.
- **Il gate reference complessivo finale NON è verde:** un long task attribuito
  al widget di **53 ms** viola la soglia invariata di 50 ms. Tutte le 60 aperture
  e le asserzioni funzionali sono completate; i budget di vista utile, feedback,
  interazioni, preparazione e bundle sono rispettati. La causa del long task
  non è stabilita: non viene escluso come rumore né cancellato dal report.
- Due run intermedi avevano rilevato 1 e 3 long task da 55–59 ms. Dopo la
  separazione dell’avvio SDK e del montaggio UI, un run aveva zero long task;
  il successivo run sulla versione finale HMAC ne rileva uno da 53 ms.
  Il risultato finale resta quello non verde; non si dichiara la qualifica.
- Controlli negativi: blocco UI reale da 150 ms rilevato dal budget feedback;
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
forgiati dal frame dopo il bootstrap fidato; non attesta il gesto contro un
host ostile, non autentica il medico e non qualifica la retention. Nessun
archivio reale, identificativo reale, Touch ID o writer è stato coinvolto.

## Limiti di integrazione e di qualifica

Oltre al gate long task della scheda sopra riportato, la build Web è stata
rieseguita e resta bloccata dalla guardia preliminare:
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

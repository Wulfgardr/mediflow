# ADR 0160 — unità 2c, scheda sintetica

Base: `46f4c1789` (#611). Implementazione GPT-6.1 Sol, High, senza ulteriore
delega; review indipendente richiesta sulla PR. Part of WUL-788.

## Risultato verificato

Adapter separato dal telecomando, un tool app-only, consenso esplicito nella
vista e payload dal reader monouso del broker. Risorsa statica senza fixture,
nessun dato clinico in metadati/errori, errori fissi anche a livello protocollo.
Liste paginate senza cardinalità fissate nella vista. Il demo già configurato
conserva entrypoint e manifest. Nessuna modifica all'archivio reale.

- `npm ci` reale su entrambi i package root, Node 24.21.0; directory dati
  sintetiche create con `mktemp -d`.
- Plugin: **14 pass, 0 fail, 1 TODO** (carico esteso non ammesso). MCP stdio
  reale e tutti i frame intercettati; fixture con sentinella rifiutata e
  assenza nei canali, consenso mancante/scaduto/negato, revoca, risposta tardiva
  e turno successivo. Errori e stderr controllati; nessuna evidenza simulata
  attivata nell'entrypoint ordinario.
- Reference ext-apps: **30 renderer freddi + 30 caldi**, server già avviato;
  runner neurale simulato, broker/preparazione reali. Giorno/Grafite a
  **390/768/1440 px effettivi**, tastiera, Reduce Motion, payload invariato,
  niente resize/scroll al clic, risposta trattenuta e poi ignorata dopo chiusura.
- p95 vista fredda **141.7 ms**, calda
  **145.8 ms**, feedback **27.7 ms**,
  interazione **15.2 ms**, preparazione della scheda con
  runner simulato **0.9 ms**; nessun long task attribuito
  al widget oltre 50 ms. Bundle gzip **161386 byte**.
- Controllo negativo: 150 ms di blocco nel vero handler UI fa fallire il budget
  di feedback. Demo originale: browser smoke, falsificazione tool e sei
  controlli negativi delle prestazioni passati, oltre ai suoi test di protocollo.
- Lint e typecheck root/plugin passati. Guardie never-regress, claims e import
  headless passate. Headless **292/292**, intelligent-host MCP **34/34**,
  Mini **21/21**.

## Suite unitaria e limite di integrazione

Eseguito `npm run test:unit` completo come comando. Il primo gruppo termina
con **7.708 pass, 29 fail, 14 skip** su 7.751 test: 25 fallimenti di Treatment
Portable (`artifact_tampered`), tre prerequisiti delle sorgenti Mac non presenti
nell'ambiente, un timeout di `run-native-probe` SIGINT. I due gruppi successivi,
non raggiunti dal runner dopo il fallimento, sono stati eseguiti separatamente:
**61/61** e **66/66**. Non si dichiara verde la suite complessiva.

I 25 fallimenti Portable restano riproducibili nel controllo mirato con una
directory temporanea canonica; il probe nativo passa isolato. I file interessati
sono fuori dal diff. Nessuna protezione viene modificata per farli passare.
`npm run build` Web si arresta nel controllo preliminare con
`Build input metadata: private file is reachable`; nessuna build Web dichiarata
riuscita. La build del plugin passa. CI e review della PR restano prove distinte.

## Qualifica esclusa

**Il carico esteso ADR (100 eventi, 30 terapie, 10 documenti) NON è qualificato.**
Il broker #611 ammette 1 evento, 2 terapie e 2 misure. Per decisione del
coordinatore i budget sono vincolanti su questa scheda; fixture estesa e TODO
sono pronti per l'unità separata del broker. Non viene iniettato un risultato
esteso al posto dell'uscita approvata.

Non sono qualificati GLiNER reale, il carico da 10.000 caratteri, avvio freddo
del processo/modello, confronto nativo, import, scritture, Touch ID o
ricomposizione. **R/L su Codex e Claude Desktop non eseguite qui**: il reference
usa l'ingresso esplicito app-only e bridge/sandbox originali, non la selezione
modello del basic-host. Non estende il verdetto ai desktop.

Report numerico sintetico: [card-reference-summary.json](card-reference-summary.json).
I report completi e le sei catture sono negli artifact CI `dist/card-evidence`.
Istruzioni: [CARD-READER.md](../CARD-READER.md).

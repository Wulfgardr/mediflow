# Diagnostica Linux WUL-787: tre invocazioni residue

R6 prepara soltanto tre invocazioni seriali e quattro casi nuovi. Official non viene rieseguita: il riuso prospettico riguarda una proprietà circoscritta osservata nella run R5, distinta dagli esiti che il nuovo piano dovrà acquisire. Non è un gate di accettazione del prodotto o delle PR.

## Piano chiuso e stop

1. Una invocazione con i soli due consumer `web-auth-recovery` fissati nel manifest: rinnovo esplicito di sessione condivisa e recovery fallita seguita da nuovo gesto esplicito.
2. Baseline Per data: solo `cattura Misure giorno 320`, geometria prevista prima dell'assert originale; nessun fix CSS.
3. Baseline AnyDoc: solo il caso originale su focus/viewport e l'osservatore passivo già preparato.

Worker 1, retry 0; timeout originali invariati, baseline repeat 1. Nessun nuovo trace, caso, cattura, suite, Official RED/GREEN/rimozione o riparazione automatica. Il driver programma direttamente i consumer e le due baseline; non intercetta l'eccezione della vecchia fase Official per proseguire.

Entrambi i consumer devono passare senza errori globali, primari o secondari. Consumer FAIL o qualsiasi guasto tecnico, di fixture, qualità o cleanup interrompe prima di un'altra invocazione. Per data assertion originale FAIL, con diagnostica e cleanup validi, può lasciare eseguire AnyDoc indipendente, mantenendo exit finale 1. Dopo AnyDoc cleanup e STOP; nessuna quarta invocazione.

Il classifier R5 è interamente byte-identico, incluse le funzioni Official inattive. R1-01/R1-02 e R4-01 restano invariati: cause, primario e secondari conservati; marker delle sole operazioni diagnostiche aggiunte bloccanti anche senza attachment; firma nativa PW1.58.2 `Tearing down "<fixture>" exceeded the test timeout of <ms>ms.` diagnostica e bloccante. Un normale timeout o una assertion originale prima della sonda non diventano automaticamente errore diagnostico. Con compatibilità AnyDoc stabilita, completezza e restauro sono obbligatori; pending, dropped, troncamento, observerErrors o conflitto di ownership impediscono la continuazione. Nessuna whitelist del troncamento delle nuove osservazioni.

## Evidenza Official riusata, non un nuovo outcome

Fonte: [run 40111903083, attempt 1](https://github.com/Wulfgardr/mediflow/actions/runs/40111903083), diagnostica [b56923cd0591a69611f9c81f47578a70866ff861](https://github.com/Wulfgardr/mediflow/commit/b56923cd0591a69611f9c81f47578a70866ff861), tree `47612f88e36a9d615ad41db40fd38ec5da33e089`, app W347 `347699434b321d5576d4e9debd706cc142d1f9fe` / tree `34b50b7940e4e59466f3c67fa31b2c87412ef8c9`.

In quella singola esecuzione controllata, il caller con UNA assertion nativa PIN ha evitato il ramo isVisible-true/isEnabled e completato lo sblocco osservabile: receipt autentica rilasciata da pin-ready-assertion, query Rinnova=false, zero isEnabled, lock 1/login 1 e assertion originali di navigazione/console. Questo è il solo passaggio accettato per riuso. Il caso Playwright è passato senza errori/retry; la fase e l'intera run restano **FAILURE**, `accepted=false`, osservazione `complete=false`, `truncated=true`. Il gate R5 non è cambiato né applicato retroattivamente.

Gli hash di caller/helper/fixture/observer e dei report/capture/transition sono in `manifest.json.reusedOfficialEvidence`. Caller GREEN: `068d2e9e032be7fe06b2c4f972b4c2897e555a8fcb7a813228a3e29f57aaf281`. Il taglio dei frame del GET auth/check limita i metadati causali; non viene dichiarata completezza diagnostica globale. Non sono accettate atomicità, copertura di tutti gli interleaving, quiete futura, causa della CI storica, accettazione prodotto/PR o riuso del payload. PIN-enabled può coesistere con un nuovo pending o un errore: il helper globale non è stato corretto. R3 run40103571025 rimane FAILURE, lock totale 3/checkpoint 1/login 0, mai EXPECTED_RED.

La futura summary conserva `reusedEvidence` separata dagli `outcomes` delle sole invocazioni eseguite nel nuovo run. Official non produce un outcome PASS fittizio e non conta fra i quattro casi nuovi. Nessun download del vecchio artifact, lettura di dossier privati o nuova validazione storica è necessario per eseguire R6. I tre sorgenti Official pubblicabili restano byte-identici come storia attribuita, senza essere copiati nel runtime; il caller Official originale non viene sovrascritto.

## Runtime, output e cleanup

Ingresso push limitato a `codex/WUL-787-linux-diagnostics-20261024`, repository prevista, `contents: read`; nessun PR/dispatch o modifica dei gate esistenti. Diagnostica e sorgente app pulita sono checkout distinte. Il payload R5 non è disponibile: una futura run richiede una nuova build W347 e nuova qualificazione, senza riuso binario dichiarato.

Ubuntu 24.04 x64 nativo, Node 24.21.0/ABI137, PW1.58.2/Chromium bloccato con identità effettiva. Unica npm ci, installazione browser e build completa con prebuild/build/postbuild, guard e smoke bundled originali inclusi; static-routes e qualificazione source-runtime/ledger PRIMA degli overlay. Nessun guard/permission allargato. Hash del ledger e identità HTTP restano quelli qualificati anche nelle tre invocazioni.

I consumer usano spec/helper originali senza overlay Official e verificano la pulizia delle sorgenti nel finally, anche su FAIL, senza riscrivere byte identici o rimuovere file non posseduti. Per data e AnyDoc applicano soltanto i cinque overlay W/shared invariati, dopo qualificazione. Outcome baseline salvato prima dei guard; cleanup tenta sempre stopServer e restore dei soli overlay posseduti, controllando hash e Git clean. Errori di fase e cleanup restano concatenati; nessun successo implicito.

Per data conserva geometria anche in PASS/non-riproduzione o geometria diversa, senza applicare fix. AnyDoc mantiene stessa gesture, Promise e connessione, senza refocus o seconda tastiera; osservazione passiva. Assenza dell'evento pubblico non prova assenza CDP, adozione/forwarding non sono osservati separatamente. Una assertion originale pre-probe resta FAIL/incompleta nel suo perimetro.

Dati sintetici separati per build e ciascuna invocazione, legacy-copy disabilitato, fixture DB nativa esclusa dalla checkout runtime. Output JSON/HTML/catture esterni e distinti, `PLAYWRIGHT_JSON_OUTPUT_FILE` esplicito. Upload della sola evidence sintetica necessaria; esclusi DB, cache, dipendenze, payload, checkout e ambiente completo. Del ledger solo hash. Cleanup solo dei gruppi di processi e file posseduti, mai kill per porta. SIGKILL può impedire finally/upload.

Refs WUL-787. Preparazione R6 assistita da GPT-6.1 Sol, effort High, service tier default. Riuso circoscritto deciso dal coordinatore dopo parere indipendente Astra High. Le prove pregresse rimangono attribuite ai propri byte e perimetri; le nuove statiche non attestano l'esecuzione. Review integrale, accettazione e qualsiasi commit/push/run restano al coordinatore. Nessuna qualifica clinica, delle PR632/633 o della CI storica è dichiarata.

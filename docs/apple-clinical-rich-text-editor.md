# Editor clinico Apple: rientri e strutture annidate

Il contributo WUL-589 aggiunge **Aumenta rientro** e **Riduci rientro** alla
barra del blocco attivo dell'editor condiviso Mac/iPhone/iPad.

- Una voce di elenco può diventare sottovoce della voce precedente nello
  stesso elenco. Le sottovoci esistenti seguono il blocco.
- Ridurre il rientro promuove una sottovoce al livello superiore; le voci
  successive dello stesso sottoelenco rimangono sotto la voce promossa,
  mantenendo ordine e contenuto. Al livello principale la voce diventa
  un paragrafo e l'elenco viene separato nei punti necessari.
- Paragrafi e titoli possono essere racchiusi in citazioni annidate e poi
  riportati al livello precedente.
- Elenchi annidati, anche misti puntati/numerati, e citazioni con più blocchi
  diventano modificabili. La struttura conserva identità dei blocchi,
  testo, stili inline, interruzioni di riga e riferimenti testuali.

Il modello dell'editor conserva il percorso dei contenitori separatamente
al testo. Il salvataggio continua a passare dal renderer e dal percorso
di conferma esistenti: non sono introdotti writer o salvataggi automatici.
Nessun impatto sui contratti API o sulla selezione degli allegati referenziati.

## Formati Web e limiti

I comandi Web correnti espongono H2/H3, paragrafi, elenchi, stili inline e
rientri tramite `execCommand`. Chromium può produrre una sottolista come
figlia diretta di un altro elenco, dopo una voce. L'editor Apple accetta
questa forma bilanciata nella proiezione modificabile: senza modifiche
restituisce gli stessi byte; dopo una modifica la sottolista viene annidata
nella voce precedente, mantenendone contenuto e livello.

La prima voce di ogni livello non può aumentare il rientro, perché non ha
una voce precedente cui collegarsi. Il comando è disabilitato; non vengono
inventate voci padre vuote. Una sottolista diretta prima di qualsiasi voce
rimane preservata. Anche il markup malformato prodotto da alcuni comandi
Web rimane preservato, così come H1 e contenuti inline non decodificabili.
I contenuti preservati non accettano i comandi di rientro e sopravvivono
alle modifiche dei blocchi vicini.

I comandi Apple si applicano al blocco corrente: non è introdotta una
selezione unica attraverso più campi di testo.

## Prove del contributo

Su dati esclusivamente sintetici, con Xcode 26.6:

- `swift test --package-path native/MediFlowMac --filter 'ClinicalRichText|ClinicalInline'`:
  50 test superati, inclusi round-trip delle 40 fixture Web, trasformazioni
  e conservazione del contenuto, stili e binding del campo durante i rientri.
- `node scripts/run-strip-types.mjs --test lib/clinical-rich-text.test.ts`:
  7 test superati con Node 24.21.0 e directory dati sintetica esplicita.
- Build Debug arm64 degli scheme `MediFlowMacApp` e `MediFlowMobileApp`
  (iOS Simulator), senza firma: riuscite.
- Guard della struttura Apple e degli entitlement di rete: superati.

Queste prove attestano modello, binding e compilazione. Interazione nell'app,
accessibilità sul dispositivo e round-trip con l'host restano da verificare;
non sono state eseguite installazioni o scritture su archivi clinici.

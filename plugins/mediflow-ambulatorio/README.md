# MediFlow Ambulatorio per Codex

Una chat per visita. «Visita» acquisisce il dettato e individua i PDF del paziente. «Fine visita» prepara il Dossier verificato e lo deposita nella cassetta cifrata. Le proposte cliniche attendono la revisione del medico in «In arrivo», secondo [ADR 0190](../../docs/adr/0190-mandato-agenti-e-cassetta-della-visita.md).

## Installazione

Servono Codex con i comandi `codex plugin`, Node 24, Python 3.9 o successivo e `pdftotext` (Poppler) nel PATH di Codex. La configurazione va fatta da una checkout MediFlow della stessa revisione, disponibile in un percorso stabile fuori da iCloud. Il server MCP si avvia tramite un launcher privato creato dal comando di configurazione e usa il client agenti e il verificatore di quella checkout.

Dalla radice di MediFlow, con l'indirizzo dell'istanza locale al posto dell'esempio:

```sh
npm ci
npm run prepare:dependencies
node plugins/mediflow-ambulatorio/start.mjs configura http://127.0.0.1:3000
codex plugin marketplace add .
codex plugin add mediflow-ambulatorio@mediflow
```

Il comando di configurazione accetta dopo l'origine una cartella PDF assoluta in sola lettura. Se omessa usa `~/Downloads`. Dopo la cartella puoi elencare i CF dei prescrittori, se noti da una fonte autorizzata. I CF configurati valgono per il filtro locale. In MediFlow imposta il CF del medico nel profilo per il controllo del browser. Il token viene scritto dal collegamento MCP dopo l'approvazione in MediFlow.

Apri una nuova chat Codex da una cartella qualsiasi. Al primo uso abilita la skill Ambulatorio dalla lista delle skill o richiamala esplicitamente. Se necessario, autorizza il server del plugin secondo le impostazioni di Codex per la cartella. Con MediFlow aperto e sbloccato, crea in **Impostazioni → Agenti** un mandato per OpenAI che autorizzi il passaggio dei dati clinici al fornitore. Scrivi «Collega MediFlow» in Codex, confronta il codice visualizzato e approvalo in MediFlow, quindi scrivi «Fatto». Per ogni visita apri una chat e detta «Visita…». Il plugin chiede conferma se il CF manca, è invalido o è ambiguo. Con «Fine visita» usa la ricevuta di deposito per ritrovare la visita in «In arrivo».

## Dove restano i dati

La configurazione, le credenziali e l'archivio delle visite del plugin risiedono in `~/.mediflow-ambulatorio`, con directory 0700 e file clinici e credenziali 0600. L'archivio locale del plugin conserva dettati, PDF e versioni del Dossier in chiaro con quei permessi. La cassetta MediFlow riceve buste cifrate. I testi clinici della chat e dei PDF accettati possono passare al servizio Codex autorizzato dal mandato.

La finestra temporale seleziona i candidati. Il filtro ammette un solo CF paziente, esclude i CF dei prescrittori riconosciuti e gli hash già assegnati nella giornata. Un candidato ricavato dai PDF richiede conferma. Il Dossier si verifica sui PDF originali copiati localmente, con hash, identità, parser v1 e citazioni. Il deposito blocca la versione verificata. Un retry riusa l'identificativo e le buste salvate.

Il plugin porta dal kit Python solo il riconoscimento del dettato, la selezione dei PDF e la generazione della nota. Questa scelta conserva i controlli già esercitati nel kit e rende installabile la visita da una chat qualsiasi. Il server TypeScript chiama il client agenti condiviso per il collegamento e il deposito. La verifica usa il parser MediFlow della checkout configurata. Il kit originale, il suo progetto Codex e il suo file di deposito restano fuori da questo percorso.

La prova tecnica usa dati sintetici. Per replicarla, usa un archivio MediFlow sintetico e una cartella PDF di prova. Configura il plugin con una `HOME` di prova e installalo in una `CODEX_HOME` temporanea. Avvia Codex con entrambe le variabili da una cartella di lavoro vuota.

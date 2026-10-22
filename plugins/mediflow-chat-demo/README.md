# MediFlow — ambiente dimostrativo nella chat

Prima unità sperimentale di [WUL-788](https://linear.app/wulfgardr/issue/WUL-788).
Un lettore MCP Apps inline mostra una persona, tre voci con fonti e due terapie
**interamente inventate**, in sola lettura. Non accede al runtime clinico,
agli archivi, alle chiavi o ai servizi di MediFlow. Nessuna scrittura clinica.

Il tool `mediflow_chat_demo_open` accetta solo `{}` e restituisce sempre
`{"status":"demo_view_ready"}` come testo. La risorsa
`ui://mediflow-chat-demo/reader` usa `text/html;profile=mcp-app`. HTML, CSS,
JavaScript e Newsreader sono incorporati nella build; nessuna CDN. La build
ricava i colori dai token Lume attivi e incorpora il font locale con licenza
OFL. Testata e prosa seguono [Punto d’inchiostro](../../docs/design/punto-inchiostro/01-specifica.md).

Il server è separato da `mediflow-synthetic` (ADR 0140) e dal telecomando
`mediflow-local-ui` (ADR 0159). Dipendenze e lockfile sono propri: MCP SDK
1.31.0, MCP Apps 1.7.5, OpenAI Extensions 0.1.0. Il runtime MCP production
non cambia. Le sole estensioni server aggiungono la presentazione inline;
la vista non usa aggiornamenti del contesto, messaggi alla chat, upload,
appshot o stato widget. Il bundle SDK comprende API ulteriori, che questa
app non invoca.

## Preparazione

Dalla radice del pacchetto, con Node 24:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run typecheck
npm test
npm run test:falsification
npm run test:browser
```

La prova browser richiede il Chromium di Playwright 1.58.2; se manca:
`npx --no-install playwright install chromium`. Non viene scaricato durante
l’avvio del pacchetto. `npm start` è un MCP stdio, non una pagina Web.
Per costruire dai sorgenti servono anche i token e il font della repository;
il server avviato legge soltanto il proprio `dist/app.html` e la propria
configurazione dimostrativa `.local/`.

## Due esiti diversi

**R** richiede il rendering inline in una conversazione del client reale.
Una ricevuta testuale, uno screenshot del browser o un host di riferimento
non bastano. **L** richiede che quella vista carichi direttamente una
sentinella generata in RAM dal servizio loopback, assente dal bundle e da
ogni risultato MCP. Non c’è ripiego tramite tool o servizio remoto.

Gli indicatori compaiono solo dopo prove distinte:

- «Vista collegata»: handshake MCP Apps completato.
- «Servizio sintetico raggiungibile»: risposta `/health` con identità della
  stessa istanza di servizio indicata nella risorsa UI.
- «Sessione dimostrativa autorizzata»: ammissione esplicita della singola
  vista e lettura della fixture riuscite.

Il servizio ascolta solo su `127.0.0.1`, su porta assegnata dal sistema.
Non è un proxy. Espone solo `/health`, `/admit`, `/fixture`, `/session` e
`/revoke`, senza body, query o destinazioni libere. Origine e Host devono
corrispondere esattamente; nessuna wildcard, cookie, `Origin: null` ammessa,
header del vecchio PNA o modifica ai controlli CSP/LNA del browser.
La risorsa dichiara esclusivamente la porta loopback in `connectDomains`.

Una sessione sintetica dura al massimo un minuto, è vincolata a origine e
istanza della vista, e resta solo in memoria. Un nuovo frame non eredita
l’autorizzazione. Blocca, teardown, pagina nascosta, scadenza o errore del
collegamento cancellano il contenuto locale; un contatore di generazione
respinge risposte tardive. La verifica periodica rileva la revoca o la
scomparsa del servizio entro tre secondi più il timeout di richiesta di
cinque secondi. Il servizio nega comunque subito la lettura non autorizzata.
Non è autenticazione clinica né prova d’identità affidabile contro l’host.

## Claude Desktop: prova locale reversibile

La [guida ufficiale](https://claude.com/docs/connectors/building/mcp-apps/getting-started)
descrive il percorso stdio locale. Prima di modificare
`claude_desktop_config.json`, crearne un backup datato. Aggiungere soltanto
questa entry a `mcpServers`, preservando ogni altra impostazione:

```json
{
  "mediflow-chat-demo": {
    "command": "/absolute/path/to/node-24",
    "args": ["/absolute/path/to/mediflow/plugins/mediflow-chat-demo/src/stdio.mjs"]
  }
}
```

Caricare la nuova configurazione al prossimo riavvio volontario di Claude;
non terminare sessioni attive. Nel tab **Chat**, scrivere:

> Usa soltanto mediflow-chat-demo. Chiama mediflow_chat_demo_open con {} e apri la sua vista MCP Apps inline. Non usare altri strumenti e non creare un artefatto alternativo.

Se richiesto, consentire la visualizzazione di questa app sintetica.
Deve apparire nella conversazione la carta «MediFlow — ambiente dimostrativo»
con Elena Vela, fonti inventate, terapie e selezione Giorno/Grafite. Aprire e
chiudere una voce di cronologia. Chiudere e riaprire la vista: l’ammissione
precedente non deve essere già attiva.

Per L:

1. Aprire «Dettagli della prova» e leggere l’origine **effettiva** della vista.
   In DevTools verificare anche l’iframe e la richiesta Network.
2. Premere «Verifica il servizio sintetico». Al primo avvio l’allowlist è
   vuota: il servizio nega l’origine senza concedere accesso.
3. Nel terminale, dalla directory del pacchetto:

   ```sh
   node scripts/origins.mjs inspect
   node scripts/origins.mjs allow-observed 'ORIGINE_ESATTA_DEL_FRAME'
   ```

   Il secondo comando accetta solo un’origine non opaca già osservata dal
   servizio. Confrontarla con il frame reale prima di ammetterla. Non usare
   l’origine dell’host di riferimento per Claude. L’osservazione non concede
   accesso da sola. Il file `.local/allowed-origins.json` contiene la sola
   origine esplicitamente ammessa e viene riletto a ogni richiesta.
4. Ripetere la verifica, poi «Autorizza questa dimostrazione». Solo al
   successo compaiono il terzo indicatore e il contenuto sintetico locale.
   «Blocca la dimostrazione» deve cancellarlo. Ripetere la verifica per
   una nuova sessione; la sessione scaduta non viene recuperata.
5. Se non arriva alcuna richiesta, controllare DevTools per CSP, LNA,
   mixed content o blocco del client. Se l’origine è `null`, fermare L e
   documentare il diniego. Non aggiungere wildcard, tunnel o disabilitazioni
   del browser. `.local/last-request.json` conserva solo l’ultima richiesta:
   sequenza, metodo, rotta allowlisted, origine canonica e stato HTTP.
   Non conserva body, sentinella, token o diagnostica arbitraria.

Per revocare tutte le origini, scrivere `[]` nel file di allowlist. Per
rimuovere il demo, togliere **soltanto** `mcpServers["mediflow-chat-demo"]` se
è ancora l’entry installata da questa prova, oppure ripristinarne soltanto
il valore precedente dal backup. Preservare le modifiche concorrenti alle
altre entry e impostazioni. Non sovrascrivere l’intero file con il backup.
Il processo termina con la chiusura della connessione del client, ritirando
sessioni e listener propri. Nessun archivio o plugin clinico va modificato.

## Prove e limiti

[Esiti del 22 ottobre 2026](./evidence/2026-10-22.md). Le catture del reference
host documentano la superficie SDK, senza attribuirle gli esiti del desktop.
La prova automatica usa un host simulato e il bridge SDK pubblicato. Verifica
le sole notifiche tecniche, origine osservata, CORS, sessione, blocco, risposta
tardiva, due temi e impaginazione a 320/390/768/1440 con testo 100/200/400%.
La scala del testo non certifica ogni combinazione di zoom del browser,
VoiceOver o input nativo.

La falsificazione modifica una copia temporanea del modulo server per
inserire la sentinella nel risultato tool reale: la medesima prova MCP deve
fallire per divulgazione. Il mutante viene rimosso e il suo output non viene
stampato. La CI dedicata esegue tutte le prove; il selettore della repository
ne verifica l’appartenenza alla suite.

Anche con L positivo, contenuto e DOM sono nel renderer dell’host. Questa
unità non certifica assenza di copie, diagnostica, screenshot o retention del
fornitore, né l’esclusione assoluta dalla richiesta al provider. Non ha
osservato i payload interni del provider. Nessun dato reale è ammesso. Un
futuro client clinico richiede l’ADR e prove distinti; pubblicazione nelle
directory, login, consenso clinico, voce e scritture sono fuori da questa unità.

# Impostazioni: prove residue della 0.9.1

Refs WUL-787. Chromium, produzione standalone, Node 24.18.0 ABI 137,
loopback porta 3000, archivio sintetico dedicato. Nessun dato clinico reale.

Base: `dad877af34028b579894e301e1d69ff947263c1a` (`origin/main`).
Le acquisizioni della base usano gli stessi test aggiuntivi del candidato.
Le prove delle PR precedenti sono riusate per gli stati già qualificati.

| Riga | Prova riusata | Integrazione mirata |
| --- | --- | --- |
| W-18a Backup | #666, prodotto 4908f242, 72+72 frame; #694 per le conferme comuni | Avviso completo al 400% mediante scorrimento, controllo delle singole righe, parola di conferma e annullamento nei due temi. |
| W-19b Profilo | #669, prodotto 2cb07eb, guardia e galleria c021 | Ritorno browser e blocco: difetto riprodotto sulla base, bozza in memoria vincolata ad account e generazione archivio; rilettura obbligatoria prima di salvare. |
| W-19e Compliance | #670, prodotto 1588d668, titoli e disclosure | Dettagli delle sei evidenze nei due temi e sei dimensioni. |
| W-19f Diagnostica | #670, prodotto 1588d668, controlli e rilettura 503 | Messaggi WHO, controlli non eseguiti/in corso/riusciti/falliti, aggiornamenti nei due temi e sei dimensioni. |
| W-19k Fabric | #678, prodotto b862, letture e supplemento 400% | Ingressi dal redirect /settings/ai per tutti i sei stati, 1440/768/390/200% nei due temi. |
| W-19l Governance | #678, prodotto b862, letture e tastiera | Quattro stati a 1440/768/390/200% nei due temi. |
| W-20c Repertori | #676, prodotto f660, letture e zero osservato | Panoramica, selezione cataloghi da tastiera, zero e letture fallite nelle dimensioni mancanti. La panoramica corrente ha selezione dei cataloghi, senza un filtro testuale separato. |

Il flusso di backup e recupero non cambia. Nessun ripristino eseguito:
la POST è intercettata e vietata. Al 400% il testo supera l'area utile:
le catture consecutive attestano ogni riga a 1440×1000. Un frame aggiuntivo
con viewport 1440×2160 mostra l’intero avviso nei due temi, sempre al 400%.

La bozza Profilo resta soltanto nella memoria del documento browser. Il blocco
smonta la pagina e nasconde i campi; lo sblocco rilegge il profilo, riprende
la bozza soltanto per lo stesso account e archivio e disabilita Salva fino
alla rilettura esplicita. Abbandono confermato e stato salvato eliminano la bozza.
Ricaricamento completo e chiusura del browser non sono persistenza della bozza.
Non cambiano writer, versioni opache, autenticazione o trasporto.

Prodotto verificato: `561437529dad275e3abbd99a0203cfc382f43565`, build
`rX4GjEBWp-ZUJDmE4E9QG`. [Esiti](esiti.json), [642 coppie con SHA e SHA-256](catture.csv),
le 1.284 immagini restano nell'archivio locale delle prove,
verificabili con gli SHA-256 del CSV; qui sono conservati solo gli esempi
sotto. I commit successivi del dossier non cambiano il prodotto.

17/17 prove aggiuntive production e 1/1 regressione Profilo PASS senza retry;
20/20 test unitari PASS, nessuno skip. Lint, tipi, build e controllo del
bundle standalone, scala tipografica, selezione dei test, invarianti e claim PASS.
Le sette righe sono chiuse sul prodotto Web sintetico verificato. La CI
sulla head della PR resta un requisito distinto, consultabile nella
[PR #722](https://github.com/Wulfgardr/mediflow/pull/722).

Esempi: [Profilo prima](prove/prima/profile/profilo-ritorno-giorno-1440.png),
[Profilo dopo](prove/dopo/profile/profilo-ritorno-giorno-1440.png),
[avviso intero Grafite 400%](prove/dopo/backup/avviso-grafite-400-intero-1440x2160.png).

I rossi intermedi sono conservati nel dossier locale originale del run
`/tmp/mf-settings-closure-20261030`: ammissione build respinta per la fixture
SQLite tracciata, risolta usando lo stesso sparse checkout della CI;
14 preflight respinti dagli spec che vietavano la porta 3000, prima di entrare
nella UI; due perdite di bozza Profilo e sconfinamento Fabric di 14 px sulla
base; confronto testuale troppo stretto sul simbolo dell’avviso 503, corretto
nel selettore; guardia delle credenziali sullo username sintetico letterale,
corretta nella fixture. Nessun rosso finale locale o deroga introdotta.

La verifica di Profilo copre anche lettura negata, cambio autorità fra schede,
continua/abbandona, salvataggio e rilettura. La prova nuova di ritorno e blocco
non invia PUT. La memoria scarta bozze di account o generazioni di archivio
diversi. Nessuna persistenza dopo chiusura o ricaricamento completo.

Provider, cataloghi e aggiornamenti sono simulati; non sono attestati inferenza,
rete regionale o installazioni reali. Le misure temporali dei controlli sono
latenze sintetiche, senza conclusioni sulle prestazioni dei servizi.

Sviluppo assistito: GPT 6.1 Sol, effort High, senza delega. Rilavorazioni:
prove aggiuntive separate dalle coperture già valide. Le acquisizioni sono
state eseguite sulla porta 3000; dopo la review le guardie degli spec
rifiutano di nuovo quella porta, come nel resto della suite isolata. Consumi non attribuibili.

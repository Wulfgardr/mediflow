# MediFlow 0.8.6 — configurazione guidata e parità desktop

Data: 7 settembre 2026. Requisiti accolti; implementazione e verifica in corso.
Base della ricognizione: `58ea22e1575ae041af5311a963f0303c1301b6a4`.
Questo piano attua la richiesta dell'utente del 7 settembre e aggiorna il
perimetro della 0.8.6. La precedente dichiarazione di sviluppo concluso resta
storica. Non attesta una release, un connettore operativo o parità già raggiunta.

## Risultato richiesto

L'utente deve poter configurare MediFlow senza conoscere l'architettura dei
servizi: scegliere un preset, collegare il proprio account o un modello locale,
decidere quali funzioni usare e riconoscere dove saranno elaborate le fonti.
Gli stessi servizi e contratti devono servire localhost, macOS, Windows e
Linux, con equivalenza funzionale verificata. Mini e headless raggiungono le
stesse capacità ammesse attraverso i rispettivi canali autorizzati; non
acquisiscono per questo le conferme riservate alla UI o accesso diretto al DB.
iOS e iPadOS restano un filone successivo per questa nuova configurazione.

La pubblicazione resta subordinata alle verifiche del pacchetto finale, alla
risoluzione dei rilievi di sicurezza, a CI verde e ai gate sotto. Non si
trasferiscono le prove di una piattaforma o di un vecchio SHA alle altre.

## Riallineamento serale: requisiti e consegna

La ricognizione serale usa il candidato locale
`1672cb3cc27ee144539d068a435ca149b81bd208`. Il progetto Linear è stato portato
in lavorazione e le issue WUL-669–688 sono state aggiornate con avanzamenti e
residui. Nessuna è stata chiusa durante il riallineamento. Il
[contratto comune su Linear](https://linear.app/wulfgardr/document/mediflow-086-contratto-operativo-issue-e-definition-of-done-533669b0b37b)
include anche gli ampliamenti della giornata:

| Issue | Risultato da consegnare |
| --- | --- |
| [WUL-689](https://linear.app/wulfgardr/issue/WUL-689) | Account ChatGPT e connettore qualificato; accesso e catalogo non equivalgono a inferenza disponibile. |
| [WUL-690](https://linear.app/wulfgardr/issue/WUL-690) | Anteprima e import atomico delle esenzioni, con errori, revisione e provenienza. |
| [WUL-691](https://linear.app/wulfgardr/issue/WUL-691) | Preset, preferenze per esperienza e scelta occasionale del modello vicino a Genera. |
| [WUL-692](https://linear.app/wulfgardr/issue/WUL-692) | Persistenza, recupero e verifica desktop dell'aggiornamento AIFA. |
| [WUL-693](https://linear.app/wulfgardr/issue/WUL-693) | Fonte corretta, schema e import del repertorio di protesica. |
| [WUL-694](https://linear.app/wulfgardr/issue/WUL-694) | App Mac, Windows e Linux installate e provate dalla stessa revisione. |
| [WUL-695](https://linear.app/wulfgardr/issue/WUL-695) | Documentazione, screenshot, siti e release sorgente coerenti con il freeze. |
| [WUL-696](https://linear.app/wulfgardr/issue/WUL-696) | Mini con trasporto Supervisor e stato operativo realmente osservato. |

WUL-631 resta il distinto percorso degli adapter API nella roadmap 1.0.
La nuova integrazione ChatGPT personale non ne dimostra la chiusura.

### Gerarchia della cartella e delle scale

Le nuove indicazioni si applicano dopo lo studio dei riferimenti pertinenti
di Breccia e Personal Aesthetic Studio. Per ogni riferimento si distinguono
ciò che è stato osservato, il principio ricavato e l'applicazione alla schermata;
un titolo di video non prova che il contenuto sia stato esaminato.

- **Documenti:** caricamento, lista con informazioni essenziali e sintesi
  documentale. In assenza di file, spiegare che non ci sono documenti e offrire
  il caricamento. Dopo l'importazione, mostrare cronologia e comandi utili.
  Togliere dal primo livello hero Fabric, riquadri duplicati e avvisi ripetuti,
  mantenendo conferme, currentness e informazioni necessarie per la scelta.
- **Scale:** rendere leggibili catalogo, selezione rapida, compilazione MMSE
  e ritorno alla lista. Eliminare cornici annidate, ombre e metadati duplicati;
  distribuire i comandi in modo coerente. Questa revisione non cambia quesiti,
  scoring, versioni, licenze o distinzione fra zero e risposta mancante.
- **SISS/FSE:** la successiva precisazione dell'utente chiarisce che la voce
  trascritta come «CFS» si riferisce a questa sezione, non a una nuova scala di
  fragilità. Rivederne presentazione e navigazione entro il contratto esistente.
- **Organizzazione:** riepilogo con quadro clinico, terapie, timeline, elementi
  da rivedere e spunti dai documenti. Anagrafica, clinica e amministrazione
  devono essere riconoscibili e raggiungibili separatamente. Le esenzioni
  appartengono all'amministrazione; il riferimento all'invalidità non introduce
  da solo un nuovo workflow di pratiche.
- **Leggibilità:** contatori visibili e allineati al titolo, geometria condivisa,
  spaziature coerenti e testi lunghi senza sovrapposizioni. Conservare diario,
  terapie e navigazione già apprezzati, correggendo i difetti puntuali.
- **Superfici:** alleggerire ultime voci e timeline con separatori discreti;
  linee e marcatori hanno senso soltanto se collegano elementi riconoscibili.
  Il dialogo di uscita perde la fascia decorativa blu, non la protezione delle
  modifiche non salvate.
- **Follow-up e agenda:** rendere possibile l'aggiunta dal follow-up mediante
  il writer previsto. L'agenda può essere contestuale; un eventuale opt-in deve
  avere una scelta e un comportamento espliciti, senza nascondere impegni già
  presenti.

### Accettazione comune del pacchetto

Ogni funzione e superficie richiesta deve avere una prova sullo SHA dichiarato
oppure un blocco ancora aperto. La matrice distingue implementato, provato,
manuale per contratto e bloccato; una funzione richiesta assente non diventa
non applicabile per completare la tabella. Un browser nella VM collegato al
server del Mac non è una prova dell'app installata nel guest.

Prima della consegna: review del delta di sicurezza, regressioni pertinenti,
percorsi ordinari e recupero, UI con stati vuoti/densi, luce/buio, tastiera,
focus, reflow e zoom 200%. Devono restare consultabili fonti e modello effettivo
dei risultati, senza promettere il ragionamento interno del modello.
Il dossier GDPR/AI Act richiede aggiornamento dei flussi e revisione competente;
non deriva da una suite verde. Il registro deslop distingue interventi,
conservazioni e rinvii motivati, senza una quota arbitraria di cancellazioni.

La revisione dell'utente comprende immagini annotate separatamente, breve
registrazione con dati fittizi e app navigabili. Seguono documentazione e siti
allineati, CI verde sull'esatto head da integrare, merge verificato e release
sorgente `v0.8.6` come Latest. La GitHub Release osservata durante la ricognizione
è `v0.8.2`: i sorgenti `0.8.5` non attestano una release pubblicata con quel tag.

Restano decisioni e prove necessarie: termini e provisioning WHO; fonte del
repertorio protesico; isolamento dell'esecuzione ChatGPT; equivalenti desktop
per dipendenze Apple; condizioni e revisione del dossier applicabile.
Le lane implementano risultati indipendenti; l'integrazione e le prove pesanti
vengono coordinate. Nessuna scadenza operativa sostituisce questi gate.

## Fasi esecutive

| Fase | Consegna concreta | Accettazione prima di passare oltre |
| --- | --- | --- |
| 1. Impostazioni leggibili | Preset in apertura; schede distinte per funzione; provider e modello visibili; sezioni brevi; dettagli tecnici richiudibili; navigazione centrata e sempre raggiungibile. | Configurare una bozza, riconoscere stato e prossima azione, ritornare alla panoramica; tastiera, focus, tema chiaro/scuro, zoom e larghezze 320–1440; raggio controlli coerente, nessun testo coperto. |
| 2. Connessioni e scelta per funzione | Connessione/disconnessione ufficiale ChatGPT, logo e stato account; cataloghi reali locali/remoti; preferenza predefinita per ogni esperienza, disattivazione indipendente e scelta per la singola esecuzione. | Accesso, rilettura, riavvio, scadenza/revoca, quote, annullamento e conflitto di configurazione. Una modifica non cambia il modello di un'operazione già iniziata; nessun ripiego implicito. |
| 3. Percorsi documentali e sintesi | Importazione da file con avanzamento; quadro paziente e sintesi documenti con comando Genera e selettore; risultato con fonti consultabili. | PDF testuale/scansione/misto e file errato; risultato strutturato, collegato alla sorgente corrente; annullamento/lock/cambio paziente scartano completamenti tardivi. Prove locali e remote con sole fonti sintetiche. |
| 4. Cataloghi e fonti | Un pannello per WHO ICD-11, aggiornamento AIFA, import esenzioni e protesica; fonte, versione, ultimo aggiornamento e azione di recupero. | Setup pulito e ricerca WHO riuscita; aggiornamento AIFA verificato prima della sostituzione; import locali con anteprima, errori per riga, duplicati, rollback e provenienza. |
| 5. Parità desktop e canali | Inventario unico di funzioni e prove per Web, app macOS, entrypoint Windows/Linux, Mini e headless; medesimo risultato applicativo e policy. | Stesso SHA e fixture, installazione/avvio ordinario per ogni target, controllo del trasporto, operazioni riuscite e denial previsti. Un wrapper o una compilazione del core non prova un'app completa. |
| 6. Consegna | Review sicurezza del delta, CI finale, screenshot aggiornati, README, rapporto, siti, PR/merge e tag/release `v0.8.6`. | Tutte le celle obbligatorie con ricevuta o blocco esplicito risolto; screenshot di configurazioni realmente funzionanti; SHA di CI, merge e release riconciliati. |

Le fasi 1 e la ricognizione delle fonti della fase 4 procedono in parallelo.
Le fasi 2–3 condividono il contratto di esecuzione e vengono integrate in
sequenza. La fase 5 usa il pacchetto risultante; non ripete suite costose a ogni
cambiamento di testo. Le VM sono nuovamente disponibili per i test richiesti;
il volume Xcode può essere montato quando serve. Non è un'attestazione della
toolchain o di un nuovo test già eseguito.

### Revisione dell'utente prima della conclusione

Preparare una pagina locale con screenshot reali e annotazioni affiancate dei
cambiamenti, mantenendo gli originali. Aggiungere una breve registrazione di
navigazione e configurazione dei modelli sul solo database dimostrativo; una
generazione entra nel video soltanto dopo il suo esito reale. Riportare SHA,
ambiente e funzioni effettivamente provate. Lasciare disponibili localhost e
le applicazioni macOS, Windows e Linux verificate, incluse le VM dedicate,
per la prova diretta dell'utente prima della pubblicazione. La registrazione
non deve contenere login, credenziali, dati personali o altre applicazioni.

## Come si presenteranno le impostazioni

**Funzioni intelligenti.** In alto: configurazioni consigliate e connessioni,
con distinzione tra «Sul computer · Ollama» e «Online · OpenAI / ChatGPT».
Ogni esperienza ha una scheda con scopo, abilitazione, modello predefinito,
stato e azione utile. Estrarre testo, riconoscere una scansione, riassumere e
consultare un catalogo sono operazioni distinte: non tutte richiedono un LLM.
Budget tecnici, registro, diagnostica e dettagli delle policy restano nelle
sezioni avanzate. Il testo informativo non viene ripetuto su ogni riga.

**Cataloghi e fonti.** Quattro schede: WHO ICD-11, farmaci AIFA, esenzioni,
ausili di protesica. Ogni scheda mostra la fonte, versione/ambito, stato della
consultazione e aggiornamento/importazione. Le fonti caricate dall'utente
devono conservare autore, territorio, validità e licenza ove disponibili.

**Accanto a Genera.** Un selettore propone solo modelli ammessi per quella
funzione, raggruppati per elaborazione locale/online. «Usa il predefinito» resta
l'opzione iniziale. La scelta occasionale non riscrive le preferenze globali;
cambiare il predefinito è un gesto separato. Prima dell'invio remoto sono
visibili provider, modello e fonti incluse.

**Dentro il risultato.** «Fonti e dettagli» espone documenti/pagine o voci
usate, modello effettivo, data, operazione, avvertenze e parti non supportate
dalle fonti. Non promette pesi causali o ragionamento interno del modello.
Un eventuale riepilogo esplicativo è distinto dalle citazioni verificabili.
Anche una sintesi può omettere o introdurre informazioni: resta una proposta
da rileggere, senza salvataggio clinico automatico.

Il Personal Aesthetics Studio è una biblioteca di riferimenti per questo
progetto. La richiesta privilegia l'organizzazione delle impostazioni Codex:
indice stabile, gruppi chiari, controlli accanto alla loro funzione. Non
importiamo palette, font o proporzioni di un sito promozionale nel prodotto.
I token Lume e il raggio di sistema restano la base del confronto.

## Contratti da completare prima dei nuovi writer

1. **Account ChatGPT.** L'accesso ufficiale separato ha letto account e modelli,
   ma non è ancora un connettore canonico MediFlow. Occorrono owner del processo
   e delle credenziali, stato minimo senza token nel browser, cancellazione,
   revoca, riavvio e isolamento dell'esecuzione. Il catalogo non prova idoneità
   clinica; abbonamento personale, API a pagamento e contratti organizzativi
   restano distinti. Le condizioni sui dati precedono l'uso di dati reali.
2. **Preferenze per esperienza.** L'host pubblica un catalogo versionato di
   opzioni ammesse. La UI invia una scelta identificata da quel catalogo; non
   fornisce endpoint, prompt, credenziali o policy arbitrarie. Il servizio
   ricontrolla capability, sessione, consenso, versione e binding prima della
   chiamata. Nessun cambio di provider silenzioso dopo errore o quota esaurita.
3. **Configurazione guidata host.** ADR 0122 oggi riserva l'ammissione Ollama al
   comando host e vieta alla UI di invocarne il controllo. Il percorso «un
   click» richiede un emendamento e un servizio nominato con conferma specifica;
   non si collega direttamente una route al comando privilegiato esistente.
4. **Cataloghi.** Download AIFA e provisioning WHO usano sorgenti fisse ammesse,
   limiti, verifica della risposta, staging e sostituzione atomica. Non sono
   fetch verso URL liberi né scritture cliniche. Il formato ufficiale effettivo
   viene confrontato con il parser prima dell'importazione.
5. **Parità.** Apple Vision e ATHENA/MLX sono dipendenze specifiche del Mac nella
   base corrente. La parità richiesta riapre questi due punti: serve una
   realizzazione equivalente qualificata sugli altri target. Non basta
   nascondere una funzione, simulare disponibilità o dare lo stesso nome a
   un percorso con contratto diverso.

Questi punti richiedono ADR mirati secondo CONTRIBUTING prima di cambiare i
confini interessati. Le correzioni di presentazione possono procedere sui
servizi attuali senza introdurre nuova autorità.

## WHO e AIFA: chiarimento del percorso

La decisione vigente è WHO **locale**, con immagine ufficiale e dataset
versionato. La documentazione WHO consente il container su Mac, Windows e
Linux, richiede l'accettazione della licenza e descrive il funzionamento
offline dopo il primo caricamento. Non occorre presumere un account API
individuale per questo percorso. La modalità API remota con credenziali è
distinta e non viene attivata come fallback.
Fonte: [installazione WHO in container](https://icd.who.int/docs/icd-api/ICDAPI-DockerContainer/),
consultata il 7 settembre 2026. Setup guidato, consenso alla licenza, verifica
ricerca, riavvio e ripristino devono essere provati prima di dichiararlo pronto.

Per AIFA si verifica l'anagrafica ufficiale di medicinali/confezioni e la
relazione con ATC. Il codice AIC della confezione e la classificazione ATC
hanno ruoli diversi; non vanno sostituiti l'uno con l'altra. Esenzioni e
protesica restano importazioni esplicite da fonte scelta dall'utente, con
tracciato documentato e anteprima; un file trovato sul disco non è già
autorizzato come catalogo pubblicabile.

## Stato iniziale e registro prove

| Area | Evidenza iniziale | Resta da dimostrare |
| --- | --- | --- |
| Impostazioni | Demo `39d281eeda5a`, catalogo Ollama letto e connessione riuscita; QA locale 12 stati. | Nuova gerarchia, selezione per esperienza e parità delle superfici. |
| ChatGPT | Accesso ufficiale dedicato, piano Pro e 8 modelli letti; nessuna inferenza. | Integrazione prodotto, isolamento, scelta, esecuzione sintetica e ciclo completo account. |
| Sintesi documenti | Selezione/capture/ingest ordinari riusciti; preview `503`; composizione sintetica 6/6. | Stadio dell'errore e risultato ordinario con provider reale. |
| WHO | Adapter locale e piano di provisioning, immagine individuata. | Consenso licenza, installazione, dataset e ricerca reali. |
| AIFA/esenzioni/protesica | Importatori e cataloghi da censire rispetto ai file correnti. | Fonte ufficiale, aggiornamento in un click e percorsi di importazione completi. |
| Desktop/Mini/headless | Prove storiche distinte già conservate. | Inventario feature-per-target e verifica sul pacchetto finale. |

Per ogni consegna si registrano: requisito, owner, commit, ambiente, comando,
input sintetico, esito, log privato e limite del claim. Gli esiti storici e i
tentativi falliti restano conservati nella
[verifica di rilascio](./2026-09-07-086-release-verification.md).

### Prima revisione visiva e acquisizione AIFA, 7 settembre

La build `999ce4546e946455d290d6e05ccd4c8c23d42663` porta preset in apertura,
pannelli distinti, navigazione centrata e preferenze delle quattro funzioni
prima dei dettagli tecnici. Le tre pagine AI sono state controllate in 24 stati:
quattro larghezze, 320–1440 px, e due temi. Il controllo locale non ha rilevato
sovrapposizioni, overflow orizzontale o errori console. Gli screenshot reali
sono conservati con annotazioni separate nella revisione privata dell'utente.
Una registrazione di 15 secondi mostra la connessione Ollama e la navigazione
su un database fittizio indipendente; non contiene inferenze o scritture cliniche.
Questa è un'anteprima, non il pacchetto conclusivo multipiattaforma.

Il candidato AIFA `95904ea565a74135f63b14e014c82f4297166d56`, integrato nei
commit `8c45f99b7` e `a353c9ee0`, ha acquisito una volta il feed ufficiale:
82.431.762 byte, 159.929 confezioni, zero righe rifiutate, 17,97 secondi per
download e importazione. La rilettura in un processo nuovo ha confermato il
manifest, il conteggio e ricerche AIC/ATC/principio attivo; integrità SQLite
`ok`, nessuna violazione delle chiavi esterne. Il coordinatore ha verificato
il database isolato e rieseguito i 14 test sintetici, tutti riusciti.
La prova reale riguarda downloader e writer: il percorso HTTP/UI nella build
integrata, il riavvio dell'app e gli altri sistemi operativi restano da provare.
Un errore diagnostico successivo all'importazione è conservato; la verifica è
stata completata con sole letture, senza ripetere acquisizione o scrittura.


### Aggiornamento AIFA dal percorso ordinario

La build `30143ca333af403ad7ab5ab6a758c5a05a66f53a` ha completato il percorso
UI su un database fittizio separato: accesso ordinario, un clic su «Aggiorna da
AIFA», POST `200` in 16,50 secondi e rilettura automatica GET `200`. Risultato:
159.929 confezioni, zero righe rifiutate; impronta del file
`24112417b204b9cb76a40437c6d226c19a1a3092325b7e99e538cdbe205a4c0d`.
Una lettura SQLite indipendente conferma conteggio, integrità e chiavi esterne;
conteggi e impronte delle quattro tabelle cliniche presenti restano invariati.

È conservato il precedente errore `400` della build `b96507d9e30b`: la route
confondeva uno stream vuoto con un payload. La correzione verifica EOF senza
contenuti, con lettura limitata e cancellabile; qualsiasi byte resta rifiutato.
Il coordinatore ha rieseguito gli 11 test mirati, tutti passati. La prova UI
copre l'host macOS; non chiude i gate Windows/Linux o il riavvio applicativo.

La prova storica della sintesi documentale sulla build `b96507d9e30b` resta non riuscita:
selezione, cattura ed estrazione `200`, proposta `503`. Una diagnostica separata
con modello locale ha osservato una versione obbligatoria dell'output omessa.
Questo non attribuisce retroattivamente la causa del `503` ordinario. Il
formato di generazione vincolato allo schema, documentato in ADR0102, è stato
poi integrato e verificato come descritto sotto.

### Sintesi ordinaria riuscita e revisione visiva

La build `3a762bb30f086ea2d7fb0189ad258b509f4f22c9` ha completato una
generazione ordinaria su un PDF fittizio: selezione esplicita dell'ambulatorio,
conferma dell'utente, estrazione e proposta HTTP `200` in 29,67 secondi.
Ollama `qwen3.5:35b-a3b` ha restituito riepilogo e citazione; il formato è
vincolato allo schema interno fisso e i validatori host restano invariati.
Il coordinatore ha rieseguito 22 test mirati prima della prova reale.

La rilettura SQLite indipendente conferma integrità, assenza di violazioni FK
e conteggi/digest invariati per pazienti, diario, allegati e terapie. La
receipt mantiene `reviewOnly=true`, `applyPolicy=none`, `writesPerformed=0`.
L'esito non attesta correttezza clinica, causalità del modello o assenza di
scritture intermedie/alle altre tabelle; le precedenti prove fallite restano
conservate.

La revisione locale ora contiene sette screenshot originali, quindici
annotazioni separate e il filmato di navigazione di 15 secondi. Le nuove
catture mostrano AIFA e la proposta realmente ottenuta su `3a762`. Il filmato
rimane quello della build `999ce`, senza generazioni; le fonti sono indicate
separatamente. Non è la prova finale delle applicazioni desktop.

Le rifiniture `782386a01` e `4c4f261d4` portano riepilogo, modello e citazioni
prima dei dettagli tecnici e uniformano i comandi dei repertori. Sei test
esistenti, lint mirato e build webpack/TypeScript/standalone sono riusciti.
Il controllo visivo di questo ultimo delta e la nuova registrazione sono
in attesa dello sblocco del Mac; gli screenshot precedenti non ne attestano
il render. Il pacchetto conclusivo resta subordinato ai gate delle sei fasi.

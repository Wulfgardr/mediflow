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

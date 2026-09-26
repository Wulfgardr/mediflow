# Future 0.9.x: matrice del cambiamento da riesaminare

Data: 26 settembre 2026. WUL-738. Baseline tecnica
`6c212221a98f9b8e45cc1d243226d0adb41770bd`. Stato: **ricerca candidata,
revisione competente non eseguita**. Il coordinatore ha preparato la matrice;
Luna Medium Fast ha raccolto cinque schede ufficiali, senza decidere applicabilità.

Questa analisi riguarda solo ciò che le versioni future cambierebbero rispetto al
[dossier corrente](./2026-09-06-086-regulatory-evidence.md), compreso il raccordo
del 23 settembre. Non riapre i criteri 0.9.0, non adotta procedure e non ammette
un deployment. Le demo di questa tranche usano esclusivamente dati inventati,
non inviano dati e non modificano cartelle.

## Fonti e calendario da conservare

Il [registro delle fonti](./2026-09-26-09x-regulatory-sources.json) contiene
identificatori, URL, data di lettura e limiti. Non confondere testo normativo,
consolidamento documentale, guida e scelta organizzativa.

| Fonte | Versione osservata e punti pertinenti | Limite della lettura |
| --- | --- | --- |
| [GDPR, reg. 2016/679](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02016R0679-20160504) | Artt. 5, 6, 9, 12–22, 24–25, 28, 30, 32, 35, 44–49; applicazione dal 25 maggio 2018. | Copertura del consolidamento/corrigendum da riconciliare; il tentativo diretto del coordinatore ha restituito la verifica del browser. Non attestata una nuova lettura integrale. |
| [AI Act, consolidato 27 luglio 2026](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02024R1689-20260727) | Emendamento 2026/1744 osservato; artt. 2–4, 6, 50, 111, 113 e allegati I/III. Art. 113: applicazione generale 2 agosto 2026, scaglioni ed eccezioni distinti; sezioni 1–3 del capo III dal 2 dicembre 2027 per allegato III e 2 agosto 2028 per allegato I, salvo art. 6(5). | Non riutilizzare il vecchio calendario. Il consolidato è documentale: gli atti in GU sono autentici. Non deduce la classe del prodotto. |
| [EHDS, reg. 2025/327](https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX:32025R0327) | Artt. 1–2, 23–30, capo IV e art. 105. Fasi generali 26 marzo 2027, 2029 e 2031 da collegare alla disposizione concreta. | La presenza di un export FHIR non prova appartenenza al perimetro EHR, conformità dei componenti o autorizzazione all'uso secondario. |
| [CRA, reg. 2024/2847](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02024R2847-20241120) | Artt. 2–3, 13–14, 72. Calendario rilevato: capo IV 11 giugno 2026; art. 14 11 settembre 2026; applicazione generale 11 dicembre 2027. | Consolidamento con corrigenda 2025 e modifica EHDS da riconciliare puntualmente; nessuna esenzione o applicabilità automatica all'open source. |
| [MDCG 2019-11 rev.1](https://health.ec.europa.eu/document/download/b45335c5-1679-4c71-a91c-fc7a4d37f12b_en?filename=mdcg_2019_11_en.pdf) | Guida giugno 2025: §§3, 4.2.1, 7–8; qualificazione per funzione, regola 11 e moduli. Riferimenti normativi MDR/IVDR. | Guida non vincolante; non attribuisce a MediFlow una classe, una certificazione o un'esenzione. |

## Scenari da valutare separatamente

| Scenario | Ruoli e dati da accertare prima dell'uso | Responsabile della decisione aperta |
| --- | --- | --- |
| Professionista autonomo | Finalità, categorie di dati sanitari/identificativi, base art. 6 e condizione art. 9, destinatari, conservazione e copie per ciascun trattamento. | Leonardo per lo scenario concreto; consulente privacy competente da nominare per la revisione. |
| Attività per una struttura | Titolare effettivo, istruzioni, autorizzazione di dispositivo/archivio/backup/provider, separazione dal contesto autonomo. | Referente autorizzato del titolare e DPO/consulente della struttura: identità non ancora assegnate. Leonardo raccoglie l'incarico. |
| Pubblicazione del sorgente | Contenuto distribuito, licenza, manutenzione, eventuale attività commerciale e ruoli del distributore/produttore. Nessun archivio sanitario nel sorgente. | Leonardo con revisore competente per la distribuzione prevista. |
| Prodotto distribuito o servizio | Destinazione d'uso dichiarata, installazione, utenti, supporto, moduli, provider e trasferimenti effettivi. | Leonardo definisce lo scenario; revisore privacy/regolatorio competente da nominare. |

La decisione di prodotto resta a Leonardo. Le caselle “da nominare” sono lacune,
non persone o incarichi inferiti. Consenso, cifratura, pseudonimizzazione, uso
locale e opt-out dall'addestramento non sostituiscono le determinazioni sopra.

## Matrice del delta tecnico e delle prove mancanti

Le righe seguenti sono **analisi tecnica del coordinatore**: le norme indicate
sono riferimenti da valutare, non una conclusione sulla loro applicabilità.
Per ogni riga valgono scenario e responsabile della tabella precedente.

| Cambiamento / finalità e utilizzatore | Output, automazione e dati | Riferimenti da valutare | Evidenza tecnica preparata / decisione ancora necessaria |
| --- | --- | --- | --- |
| 0.9.1 servizi condivisi; medico e client autorizzati | Letture/proposte e, solo in futuro, comando clinico nominato. Dati della cartella; distribuzione dell'autorità tra processi. | GDPR 25/32; ruoli e registro del trattamento. | Non implementato qui. Serve prova dell'autorità unica, minimizzazione per client, revoca, audit e rollback sul candidato accettato WUL-573/585. HOLD dell'ammissione dei nuovi client. |
| 0.9.2 Rust/IPC; stesso uso dichiarato | Trasferimento tecnico di una sola operazione, senza nuova finalità clinica presunta. Dati e segreti attraversano confini da definire. | GDPR 25/32; change control MDR/IVDR se il modulo risultasse pertinente; CRA nel contesto distributivo. | Nessuna riscrittura o IPC anticipati. Serve contratto WUL-706, prova equivalente e rollback; la scelta del linguaggio non è un'esenzione né prova di sicurezza. |
| 0.9.3 accesso/correzione; operatore autorizzato | Anteprima e correzione proposta; originale preservato. Dati personali e informazioni su terzi. | GDPR 12–22, 5/9/32; politica di conservazione e copie. | WUL-739 simula identità, perimetro, versione e policy; non adotta una policy. Mancano verifica identità reale, classi/copertura export, vincoli di conservazione e risposta completa del titolare. HOLD invio/purge. |
| 0.9.3 confronto terapie/follow-up; medico | Evidenze, discordanze, scadenze e proposta manuale. Nessuna prescrizione o chiusura automatica; dati sanitari. | MDR/IVDR e MDCG per destinazione d'uso del modulo; GDPR accuratezza/minimizzazione. | WUL-740/741/742 verificano stati sintetici. Mancano valutazione clinica indipendente, finalità definitiva e servizio autorizzato. HOLD claim di beneficio clinico e applicazione alle cartelle. |
| 0.9.4 modelli/documenti; medico revisore | Proposte derivate da fonti; modelli locali/remoti futuri. Dati sanitari minimizzati, eventuali provider. | AI Act: distinguere fornitore del modello, fornitore del sistema e utilizzatore; GDPR 28/35/44–49; MDCG per funzione. | WUL-743 prepara 12 casi di sviluppo, senza modello o giudizio clinico. Servono corpus adjudicato/riservato alla valutazione, ruoli/contratti, aggiornamento modello e condizioni del canale effettivo. HOLD deployment e claim di accuratezza. |
| 0.9.5 FHIR/SMART/passaggio; medico e destinatario esplicito | Derivato esportabile solo dopo revisione, permessi e destinazione; dati sanitari e identificativi. | GDPR finalità/destinatari/trasferimenti; EHDS EHR da accertare; contratti dei profili. | WUL-744 verifica fonti e byte del validator; WUL-745 compone un riepilogo sintetico. Non provano terminologie, IPS valido, target ingestion, FSE o accesso istituzionale. HOLD di tali claim. |
| 0.9.6 app/installer/CLI; utenti sui target nominati | Distribuzione ed esecuzione dello stesso confine; credenziali, archivi e copie locali. | CRA per scenario commerciale/esclusioni; GDPR 25/32; EHDS se pertinente. | Inventariati entrypoint e harness esistenti. Servono prova sul pacchetto esatto, target reali, aggiornamento/recovery, responsabilità di supporto. Nessun nuovo claim multipiattaforma. |
| 0.9.7 coorti descrittive e futuri effetti esterni | Conteggi di attività; in futuro dati aggregati/secondari o scritture esterne. Nessun punteggio di rischio individuale qui. | GDPR finalità/minimizzazione/DPIA e rischio di reidentificazione; EHDS uso secondario se pertinente. | WUL-747 verifica denominatori sintetici, ignoti e correzioni. Aggregazione non implica anonimato; mancano politica per piccoli numeri/query, finalità autorizzata e regole di estrazione. Effetti esterni restano bloccati da WUL-624/597. |

## Esito e ripresa

Proseguibile: sperimentazione locale sui casi inventati e preparazione delle
prove nominate. Non è emesso un GO per uso clinico, distribuzione, trattamento
per la struttura o invio a provider. Nessuna nuova funzione è qualificata
automaticamente dalla revisione umana o dal fatto che non scriva dati.

Prima di un successivo incremento runtime, aggiornare la riga con destinazione
d'uso concreta, candidato immutabile, scenario/ruoli, esito della revisione
competente e decisione datata. La matrice resta candidata fino ad allora;
WUL-738 non è chiusa da questo documento.

# MediFlow v0.6.0

> Cartella clinica territoriale local-first.
> Dati vicini al medico, flusso rapido, privacy come impostazione di base.

![Render reale del cockpit Kree8 senza dati paziente](./screenshot.png)

_Render reale dell'interfaccia attuale, catturato su un database temporaneo vuoto senza dati paziente._

## Perché MediFlow

MediFlow nasce dal lavoro reale con i pazienti, non da un esercizio teorico.

Una cartella clinica deve aiutare chi cura a ritrovare informazioni, seguire
terapie, annotare decisioni, conservare documenti e mantenere continuità, senza
trasformare ogni gesto in burocrazia digitale.

Nel contesto territoriale italiano questo bisogno è ancora più evidente: il tempo è poco, i dati sono sensibili, i percorsi sono spesso frammentati e gli strumenti disponibili non sempre rispettano il modo in cui il lavoro clinico viene davvero svolto.

MediFlow prova a rispondere a questo spazio: una base locale, leggibile,
prudente e modulare per la gestione quotidiana dei pazienti. La priorità non è
fare scena, ma ridurre attrito: aprire la scheda, capire dove si è, rivedere una
fonte, distinguere una terapia da una prestazione prescritta, preparare il
passaggio giusto senza confondere supporto operativo e integrazione
istituzionale.

Non nasce per sostituire i canali istituzionali, né per promettere integrazioni che non sono ancora dimostrate. Nasce per dare ordine, continuità e controllo al lavoro clinico di tutti i giorni.

## L'idea

MediFlow è una web app locale per gestire dati clinici, terapie, note e documenti.

Il principio guida è **local-first**: il dato resta vicino a chi lo produce e lo usa. Il cloud non è un requisito per lavorare, e l'architettura è pensata per ridurre al minimo la dipendenza da servizi esterni.

La direzione è quella di uno strumento:

- sobrio nell'interfaccia;
- esplicito nei confini;
- prudente nell'uso dell'AI;
- rispettoso della privacy;
- adatto a crescere senza diventare opaco.

## Cosa trovi oggi

In questa versione MediFlow include:

- **web app locale** come superficie primaria di lavoro sul Mac;
- **Kree8 cockpit** come root web live, con una direzione visuale unica e senza selector persistiti;
- **database SQLite cifrato**, con approccio zero-knowledge;
- **backup, audit e contratto `/api/v1`** resi più chiari ed espliciti;
- **AI locale** per insight e OCR, senza egress di default;
- **import documentale reviewable**, con Smart Import prudente, artifact `parse/evidence`, ancore fonte e benchmark di assorbimento evidenza;
- **prescrizioni di prestazione** separate dalle terapie farmacologiche, con item codificabili e matching repertorio preparato in modo bounded;
- **modalità `home-base` read-only-first** per client Apple paired, con primi
  write versionati e documentati;
- **bundle macOS home-base** come nodo locale packaged, con gestione esplicita
  del backend web production e del proxy TLS;
- **client iPhone/iPad paired non-AI** con consultazione/cache cifrata e primi
  workflow online versionati sui moduli core;
- **boundary SISS/FSE realistico**: handoff contestuale e percorso prescrittivo `webapp-assisted`, non integrazione regionale nativa già risolta;
- **cockpit Kree8 unico** come direzione visuale stabile su `main`.

## Direzione attuale

La traiettoria di MediFlow è semplice da leggere:

- rendere più solida la gestione locale del dato;
- mantenere AI e import documentale sempre rivedibili dal medico;
- far crescere i client Apple attorno al Mac come `home-base`;
- trattare i percorsi regionali con precisione: handoff e `webapp-assisted`
  quando sono il perimetro reale, integrazione più profonda solo dopo canali e
  scenari qualificati.

## Confini dichiarati

MediFlow non vuole raccontare più di quanto possa dimostrare.

- **Nessun cloud obbligatorio**: il default resta locale.
- **Nessuna app iPad/iPhone dichiarata come già completa**: la direzione multi-device esiste, ma il perimetro operativo attuale è `home-base + paired client`, con approccio read-only-first, cache cifrata e write online limitati a profilo/status, diario, terapie, checkup e osservazioni.
- **Nessuna integrazione SISS/FSE certificata dichiarata senza prove**: il percorso attuale è contestuale e `webapp-assisted`, usando i canali ufficiali; MediFlow non dichiara sincronizzazione FSE, writeback regionale o invio prescrittivo diretto.
- **Nessuna delega cieca all'AI**: l'AI locale può aiutare, ma non sostituisce revisione, giudizio clinico e responsabilità professionale.

## Perché open source

MediFlow nasce come progetto personale, ma ha senso solo se può diventare una base aperta, verificabile e migliorabile.

Open source, in questo caso, significa soprattutto:

- codice leggibile;
- documentazione chiara;
- confini dichiarati;
- nessuna promessa vaga;
- possibilità di controllo da parte di chi usa lo strumento.

## Documentazione

- [FAQ](./docs/FAQ.md)
- [Stato del sistema](./docs/STATE_OF_THE_SYSTEM.md)
- [Roadmap](./docs/ROADMAP.md)
- [Compliance](./docs/COMPLIANCE.md)
- [Document map](./docs/README.md)

## Avvio rapido

```bash
git clone https://github.com/Wulfgardr/mediflow
cd mediflow
npm install
./Start_MediFlow.command
```

Apri `http://localhost:3000`.

## Licenza

MIT License.

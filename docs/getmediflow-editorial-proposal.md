# getmediflow: proposta di sito e percorso documentale

Stato: proposta editoriale locale del 5 settembre 2026. Non modifica il
contratto clinico né annuncia una release. Il nome getmediflow è un titolo di
progetto: non attesta la disponibilità o la registrazione di un dominio autonomo.

## Idea guida

**Ritrova il filo.**

Il sito presenta un problema comprensibile prima di nominare la tecnologia:
la continuità della cura fra note, documenti e cose da fare. Il dettaglio tecnico
entra per scelta del lettore. Il tono resta concreto; il movimento spiega
passaggi, non attribuisce poteri al prodotto.

## Percorso della pagina

| Capitolo | Domanda del lettore | Risposta e interazione |
| --- | --- | --- |
| Apertura | A cosa serve? | Cartella territoriale, informazioni, fonti e prossimi passi. |
| Il perché | Quale problema affronta? | Tre passaggi selezionabili: persona, fonte, prossimo passo. |
| Dentro MediFlow | Quali strumenti contiene? | Codifiche e scale; dettagli espandibili su condizioni e limiti. |
| Fabric | Cosa fa l'AI? | Quattro percorsi selezionabili, proposta e revisione umana visibili. |
| Sotto il cofano | Come è costruito? | Due livelli: parole semplici oppure host, API, AIP, MCP e SQLite. |
| Stato | Posso adottarlo ora? | Candidatura, prove disponibili e gate aperti; link alle fonti. |
| Repository | Come approfondisco o contribuisco? | Accesso al codice e alla documentazione pubblica. |

## Forma

Tipografia ampia, blu deciso, fondo bianco, accento arancio e verde acceso nel
capitolo Fabric. Icona Filo originale del progetto. Nessun volto, dato paziente
o schermata clinica reale. I diagrammi sono illustrativi, non simulano una
sessione clinica né una generazione AI live.

Le transizioni rispettano `prefers-reduced-motion`; un controllo consente di
fermare le animazioni. Interazioni accessibili da tastiera, layout adattabile,
testo principale leggibile. La proposta non dichiara conformità di accessibilità
senza un audit dedicato.

## README e documenti: una sola progressione

- **README**: perché, capacità, dati, avvio, dettagli tecnici espandibili e limiti.
- **start-here.md**: tre livelli di lettura e piccolo glossario operativo.
- **docs/README.md**: mappa delle fonti autorevoli, senza duplicare ogni contratto.
- **repository-topology.md**: dove vive il codice e cosa resta fuori dal runtime.
- **STATE_OF_THE_SYSTEM.md**: fotografia verificabile, distinta da roadmap e vecchie ricevute.
- **release-085-readiness.md**: evidenze e gate del candidato, inclusi i canali Apple.
- **ADR, specifiche e guide profonde**: mantenute; il sito rimanda a esse invece di riscriverne il significato.

## Cosa non cambiare per fare marketing

Nessuna promessa di parità completa Apple, adozione clinica validata, conformità
FHIRv2 o integrazione regionale certificata. Provider esterni spenti per
default; configurazione locale e prova hardware restano requisiti espliciti.
I link alla main pubblica possono precedere la candidatura non ancora inviata.

## Passaggio successivo alla proposta

Valutare il racconto e i testi nel sito privato. Dopo approvazione, scegliere
l'audience di pubblicazione e l'eventuale dominio; non renderlo pubblico per il
solo fatto che la proposta è ospitata. Il sito rimane separato dalla cartella
clinica e non riceve dati o credenziali del runtime.

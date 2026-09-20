# Inizia qui

MediFlow nasce per tenere vicine la storia del paziente, le fonti da cui la
ricostruiamo e le attività ancora da seguire. È un gestionale aperto e gratuito:
si può partire dalla cartella e restare lì, senza attivare alcuna funzione AI.

## Capire il prodotto

Diario, documenti, terapie e misure rispondono a esigenze diverse. Il testo
conserva il contesto; i dati strutturati aiutano a cercare e scambiare le
informazioni; il documento originale permette di tornare alla fonte. La
modularità serve a far convivere questi strumenti senza imporre quelli che
non occorrano.

Il [README](../README.md) presenta il progetto e l’avvio dai sorgenti; il
[contratto prodotto](../PRODUCT.md) ne precisa finalità e confini. La 0.8.6 è
pubblicata come codice sorgente per il runtime locale/headless sul Mac, con
browser localhost. Non è una distribuzione di app native complete né una
qualifica all’impiego clinico.

## Capire come aiuta nel lavoro

Una terapia descritta in un referto o un controllo rimasto fra le attività
aperte sono informazioni utili solo se si riesce a ritrovarle nel loro
contesto. Le funzioni intelligenti possono aiutare in questo passaggio, ma
richiedono configurazione e revisione: non sostituiscono la fonte né decidono
che cosa scrivere nella cartella.

Il filo è sempre lo stesso: riprendere **la persona**, con diagnosi, terapie,
misure e contesto; consultare **la fonte**, anche dopo un’estrazione o una
sintesi; preparare **il prossimo passo**, senza confonderne la proposta con
l’esecuzione.

Il [walkthrough](./walkthrough.md) segue il percorso operativo. La
[matrice AI](./ai-runtime-serving-matrix.md) distingue implementazioni, prove
controllate e sviluppi; [privacy e governance AI](./privacy-and-ai-governance.md)
chiariscono perché un controllo tecnico non esaurisca la responsabilità d’uso.

## Capire come è costruito

Il nodo che conserva i dati autorevoli e ospita i servizi è la **home base**.
La struttura che coordina le funzioni intelligenti è la **Fabric**: permette
di non usarle o di scegliere strumenti diversi per funzioni diverse, entro il
catalogo e l’autorità dell’host. Le preferenze non rendono ammissibile qualunque
modello e non attivano implicitamente servizi esterni.

Alcune funzioni si possono raggiungere senza passare da ogni schermata: è
l’accesso **headless**, che conserva autenticazione, permessi e controlli del
sistema, senza aprire il database agli agenti. La guida iniziale orienta il
profilo di lavoro; scegliere una modalità non equivale a collegare un agente
o abilitare un modello.

La [topologia dei dati](./topologia-dati-flussi.md) segue le informazioni; la
[topologia repository](./repository-topology.md) indica dove vive il codice.
Per contribuire, parti da [architettura](../ARCHITECTURE.md),
[sicurezza](../SECURITY.md), [contribuzione](../CONTRIBUTING.md) e contratto del
componente. L’[indice canonico](./README.md) precisa quale documento prevalga
per ciascun tema.

La [readiness 0.8.5](./release-085-readiness.md) conserva le prove e le condizioni
aperte di quella fase. Non è un’attestazione della release successiva: codice
presente, comportamento verificato e disponibilità per un impiego concreto
restano piani diversi.

# Inizia qui

MediFlow è una cartella clinica territoriale: raccoglie informazioni e le rende
consultabili nel tempo. Serve a lavorare su una storia clinica, con le fonti e
le azioni ancora da seguire nello stesso contesto.

## Primo livello: il bisogno

Una visita non esaurisce il percorso di una persona. Restano esami, documenti,
terapie, appuntamenti e decisioni da rivedere. MediFlow parte da questa
continuità, descritta nel [contratto prodotto](../PRODUCT.md).

Per una prima lettura bastano il [README](../README.md), lo
[stato della candidatura](./release-085-readiness.md) e i
[limiti noti](./known-limitations.md). Non è necessario conoscere API o modelli AI.

## Secondo livello: come lavora

- La **cartella** conserva la storia e le modifiche versionate.
- Una **fonte** è il documento o dato a cui tornare quando si verifica un'informazione.
- Una **proposta** è un risultato preparato per essere rivisto; non è una modifica già eseguita.
- La **home base** è il nodo autorevole che ospita dati e servizi.
- **Fabric** coordina capacità intelligenti con regole definite dal sistema locale.
- **Headless** espone alcune capacità senza attraversare ogni schermata, conservando i confini di accesso.

Il [walkthrough](./walkthrough.md) mostra il percorso end-to-end. La
[topologia dati](./topologia-dati-flussi.md) spiega dove passano le informazioni.

## Terzo livello: come si costruisce

Leggi [architettura](../ARCHITECTURE.md), [sicurezza](../SECURITY.md) e
[contribuzione](../CONTRIBUTING.md), poi il contratto del componente interessato.
La [mappa canonica](./README.md) indica quale documento prevale sul tema;
l'[indice](./markdown-index.md) aiuta a trovare i file.

Non confondere tre stati: codice presente, comportamento verificato e capacità
pronta per un uso reale. Il primo si vede nei sorgenti; il secondo richiede
prove sul codice corrente; il terzo comprende ambiente, responsabilità e gate
di distribuzione o adozione pertinenti.

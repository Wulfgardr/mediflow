# Inizia qui

MediFlow è il gestionale open source per i pazienti dell’ambulatorio. Raccoglie
la storia clinica, organizza documenti e terapie, tiene vicine misure e attività.

## Capire il prodotto

Si parte dalla cartella. Diario, dati strutturati e documenti permettono di
lavorare anche senza intelligenza artificiale. Il testo conserva il contesto;
le codifiche aiutano a organizzare e scambiare le informazioni.

Il [README](../README.md) presenta le capacità e l’avvio. Il
[contratto prodotto](../PRODUCT.md) ne definisce finalità e confini.

## Capire come aiuta nel lavoro

Una terapia può essere descritta in un referto; un controllo può perdersi
tra le attività. Le capacità intelligenti aiutano a recuperare gli elementi
utili senza separare i dati dalle fonti. Richiedono configurazione e revisione.

- **La persona**: riprendere diagnosi, terapie, misure e contesto.
- **La fonte**: consultare l’originale anche dopo un’estrazione o una sintesi.
- **Il prossimo passo**: ritrovare ciò che serve a pianificare un’attività.

Il [walkthrough](./walkthrough.md) descrive il percorso operativo.
La [matrice AI](./ai-runtime-serving-matrix.md) distingue capacità disponibili,
prove controllate e sviluppi. [Privacy e governance AI](./privacy-and-ai-governance.md)
spiegano il rapporto tra controlli tecnici e responsabilità d’uso.

## Capire come è costruito

La **home base** è il nodo che conserva dati e servizi. **Fabric** coordina
le capacità intelligenti; **headless** permette di usare alcune funzioni senza
attraversare ogni schermata. Questi accessi passano dai controlli del sistema.

La [topologia dei dati](./topologia-dati-flussi.md) mostra il percorso delle
informazioni. La [topologia repository](./repository-topology.md) spiega dove
vive il codice. Per contribuire: [architettura](../ARCHITECTURE.md),
[sicurezza](../SECURITY.md), [contribuzione](../CONTRIBUTING.md) e contratto del
componente. L’[indice canonico](./README.md) indica quale fonte prevale.

La [readiness 0.8.5](./release-085-readiness.md) raccoglie evidenze e gate aperti.
Codice presente, comportamento verificato e disponibilità per l’uso concreto
sono stati distinti; la documentazione li mantiene visibili.

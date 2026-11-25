# ADR 0203: Pacchetti di prestazioni per diagnosi nel modulo Lombardia

Data: 2026-11-25. Stato: **Proposed**.
Riferimenti: WUL-921, WUL-922, [ADR 0158](./0158-territorial-packs.md), [ADR 0170](./0170-territorial-service-extension-points.md), [ADR 0177](./0177-moduli-di-giurisdizione.md).

## Contesto

Nel controllo delle malattie croniche le prestazioni ricorrenti si ricompongono a mano a ogni visita. Un pacchetto lega una diagnosi ICD-11, i codici del nomenclatore regionale lombardo (`REGIONAL_PRESTAZIONI`), la periodicità, l'esenzione e il quesito. Per ADR 0158 e ADR 0177 il nucleo resta indipendente dal territorio: codici regionali ed esenzioni appartengono al modulo Lombardia (`lom`).

## Decisione

1. **Collocazione.** Contratto, validazione, contenuti e generazione stanno in `lib/territorial/lombardia/service-packages/`. Il nucleo non importa questo modulo.
2. **Tabelle di riferimento versionate.** `assets/reference-data/lombardia/` contiene il nomenclatore regionale in vigore dal 01/10/2025 (Allegato 3 della DGR XII/4956/2025, 2058 codici) e le prestazioni comprese nelle esenzioni 013 e 023, visita di controllo inclusa, dell'Allegato 8 al DPCM 12/01/2017 (versione regionale del 30/10/2026), con indirizzo e impronta SHA-256 dei file d'origine in `manifest.json`. `scripts/lombardia-reference-tables.ts` le legge.
3. **Stati di approvazione nei tipi.** Un pacchetto è `draft_pending_approval` («Bozza da approvare») oppure `approved` con medico e data («Approvato da <medico> il <data>»). L'approvazione si registra nel contenuto del pacchetto nel repository: il modulo non espone una funzione che approva. La generazione accetta nei tipi solo `ApprovedServicePackage` e a runtime risponde `PACKAGE_NOT_APPROVED` a una bozza.
4. **Fonti.** Una fonte è un documento (`documento`: titolo, sezione o pagina, data, indirizzo, stato) oppure una decisione del medico (`decisione_del_medico`: medico, data, che cosa ha deciso, nessun indirizzo). Una scelta che nessun documento indica, come una cadenza decisa dal medico, cita la decisione e non un documento che non la dice. Ogni voce cita almeno un documento.
5. **Validazione.** `validateServicePackage` rifiuta un pacchetto o una voce senza fonte valida, un documento senza sezione, data valida o indirizzo, una decisione senza medico o data valida; un codice assente o inattivo nel catalogo; un'esenzione assente dal catalogo o che non comprende la prestazione della voce. La «visita di controllo» che l'Allegato 8 mette in un'esenzione lasciando il codice al prescrittore copre tutte le visite di controllo del nomenclatore (descrizione «VISITA … DI CONTROLLO»), non le prime visite.
6. **Composizione e storico (WUL-922).** I moduli di complicanza si attivano dai codici ICD-11 del paziente (codice o sue sottocategorie) e si compongono sul pacchetto base: aggiungono prestazioni o abbreviano la periodicità di una voce già presente, unendo condizioni e fonti. `generatePackageServiceRequests` è una funzione pura: confronta ogni voce con lo storico e restituisce solo ciò che è «Mai eseguita» o «Scaduta da N mesi»; mette fra le escluse ciò che è ancora valido o già prescritto o prenotato. Una prestazione annullata non esclude la proposta. L'esenzione si applica solo se l'assistito la possiede.
7. **Nessuna scrittura clinica.** La creazione delle prescrizioni e la ricetta nel SISS restano al gesto del medico nella futura vista.

## Conseguenze

- Il primo pacchetto (diabete mellito tipo 2 con moduli renale, cardiologico ed epatico) è approvato da Leonardo il 25/11/2026, con la visita endocrinologica di controllo, la glicemia e l'esame urine ogni 12 mesi decisi da lui. Ogni modifica successiva, compreso un riallineamento ai set minimi regionali, torna a lui per una nuova approvazione.
- Un test fa fallire la CI se un codice di prestazione, un'esenzione o un codice ICD-11 usati da un pacchetto non esistono nelle tabelle del repository.
- La vista della visita leggerà diagnosi, esenzioni e storico delle prestazioni del paziente, chiamerà `generatePackageServiceRequests` e mostrerà la proposta modificabile prima del salvataggio con `lib/service-prescription-write.ts`.

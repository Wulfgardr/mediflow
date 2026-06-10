# SISS Prescrittivo Live Inspection: Presentation Brief

Data: 2026-05-20
Scope: `mediflow_private` only

Questo brief aggiorna la parte di presentazione dopo la lettura live del modulo
prescrittivo SISS. Il focus e solo web app: niente screenshot iOS/iPadOS in
questa revisione.

## Asset

- Mock web senza dati clinici:
  [mock-siss-prescription-webapp.html](./mock-siss-prescription-webapp.html)
- Screenshot browser interno:
  [assets/2026-05-20-mediflow-web-mock-prescrittivo-empty.jpg](./assets/2026-05-20-mediflow-web-mock-prescrittivo-empty.jpg)

Il mock visualizza una superficie MediFlow proposta per accompagnare il percorso
`webapp-assisted`: selezione ricetta specialistica, priorita `P`, nessuna
esenzione, ricerca testuale `visita cardiologica`, lista candidati coerente con
il comportamento osservato e ledger tecnico redatto delle chiamate.

## Riposizionamento

Prima della sessione live, MediFlow descriveva il prescrittivo SISS soprattutto
come boundary: contesto paziente locale, handoff alla webapp ufficiale, niente
pretesa di integrazione certificata nativa.

Dopo la lettura live, il racconto diventa piu operativo:

1. l'atto resta nel canale regionale ufficiale;
2. MediFlow puo pero modellare la sequenza come state machine osservabile;
3. la ricerca prestazione produce candidati e codici, non semplice testo libero;
4. priorita, esenzione, quantita, note e vincoli sono validazioni intermedie;
5. registrazione, NRE/IUP e promemoria PDF sono il confine finale della webapp
   regionale, da riconciliare localmente solo come ricevuta/documento.

## Storyboard Web

1. **Contesto locale**
   Mostrare MediFlow come workspace clinico locale, con nessun dato paziente nel
   mock e con boundary SISS esplicito.

2. **Preparazione ricetta**
   Stato iniziale: codice fiscale non valorizzato nel mock, canale
   `Specialistica`, priorita `P - Programmata`, esenzione non selezionata.

3. **Ricerca catalogo**
   La ricerca `visita cardiologica` non produce un singolo match: il popup /
   lookup contestuale restituisce opzioni specialistiche vicine, tra cui
   cardiochirurgia, cardiologica di controllo, prima visita cardiologica con ECG
   e possibili varianti riabilitative.

4. **Scelta prestazione**
   La scelta diventa un oggetto codificato: codice prestazione, branca,
   quantita, occorrenze, note e flag di validazione.

5. **Ledger tecnico**
   Affiancare alla bozza un registro tecnico redatto: identificazione assistito,
   contesto operatore/timbro, lookup catalogo, note, PNG/LA, massimo prestazioni,
   registrazione e promemoria.

6. **Handoff ufficiale**
   Il pulsante `Apri webapp SISS` rimane un handoff: la registrazione effettiva e
   la generazione dei riferimenti ufficiali non avvengono nel mock MediFlow.

7. **Riconciliazione locale**
   Dopo la registrazione reale, MediFlow puo archiviare evidenza documentale,
   stato, timestamp e riferimenti redatti, senza importare cookie, token o
   session storage.

## Slide da Aggiornare

- Sostituire la slide generica "SISS handoff" con "Prescrittivo SISS come
  workflow osservabile".
- Usare lo screenshot web come visuale principale.
- Evitare screenshot mobile in questa iterazione.
- Separare sempre:
  - `osservato nel portale`
  - `rappresentabile in MediFlow`
  - `atto certificato nel canale regionale`
  - `riconciliazione locale post-atto`

## Note di Sicurezza

L'asset non contiene dati assistito, NRE, IUP, cookie, token, header di sessione
o dump storage. La mappa tecnica privata collegata puo contenere identificativi
originali solo dove servono a ricostruire il processo osservato; gli artefatti
riutilizzabili di sessione restano esclusi.

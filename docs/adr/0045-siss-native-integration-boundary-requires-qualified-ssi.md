<!-- Codex: created 2026-04-15 -->
# ADR 0045: L'integrazione nativa SISS oltre il `portal-handoff` richiede boundary `SSI` qualificato e scenari approvati

Date: 2026-04-15  
Status: Accepted

## Problema

Dopo `WUL-178`, MediFlow ha un prototipo utile ma onesto: launcher contestuale
dal paziente verso `Menu SISS`, `Ricetta`, `FSE` e `Anagrafe`, con backend
locale che prepara il contesto ma senza dichiarare una vera integrazione
certificata.

Il passo successivo richiesto e piu ambizioso: usare il backend SISS per
portare dentro MediFlow parti piu profonde del prescrittivo, della consultazione
FSE, dell'anagrafe regionale o di altri moduli territoriali, idealmente con UI
piu dedicata della web UI regionale.

Il rischio e confondere due piani distinti:

1. il fatto che il SISS supporti davvero `A2A`, `Web Application` e servizi di
   cooperazione
2. il fatto che MediFlow possa gia usare quei canali solo leggendo la
   documentazione pubblica, senza qualifica `SSI`, provisioning ARIA e scenari
   approvati

## Contesto

- Il `Modello Architetturale` SISS distingue chiaramente modalita `A2A`,
  `Web Application`, `Porta Delegata` e `Porta Applicativa`.
- La pagina `Scenari di Integrazione` chiarisce che gli scenari sono la base di
  validazione degli applicativi di terze parti e che non sono ammesse modalita
  alternative non documentate o non approvate.
- Le `Linee Guida Regionali` e la `Procedura di Qualificazione Scheda Sanitaria
  Informatica (SSI)` stabiliscono che, per `MMG/PDF`, solo i prodotti
  positivamente qualificati possono essere utilizzati.
- La pagina `Service Provider di MMG/PDF` mostra che il territorio ricade in un
  ciclo di provisioning e gestione operativa governato da ARIA.
- Il portale pubblico documentale espone segnali concreti di integrazioni
  profonde (`Credenziali API SISS`, `Modulo Prescrittivo Regionale`,
  scenari/SEB FSE, scenario cooperativo SGDT/PAI), quindi il backend regionale
  non si esaurisce nel solo portale.

## Opzioni

1. Trattare la documentazione pubblica come sufficiente per partire subito con
   una UI custom MediFlow contro il backend SISS.
2. Fermarsi al `portal-handoff` e rinunciare a priori a qualsiasi integrazione
   piu profonda.
3. Distinguere nettamente:
   - `portal-handoff` producibile subito
   - integrazione nativa/wrappata documentata ma subordinata a `SSI`
     qualificata, provisioning e scenari approvati

## Trade-off

- Opzione 1:
  - Pro: accelera apparentemente il lavoro user-facing.
  - Contro: confonde fattibilita tecnica con fattibilita reale/regolata;
    espone MediFlow al rischio di costruire un frontend non validabile.
- Opzione 2:
  - Pro: zero rischio di overreach.
  - Contro: rinuncia anche ai percorsi ufficiali che, se presi sul serio,
    potrebbero diventare una vera integrazione nel medio termine.
- Opzione 3:
  - Pro: mantiene valore operativo oggi e apre un percorso serio verso
    l'integrazione nativa reale.
  - Contro: impone una fase documentale e di qualificazione prima del runtime.

## Decisione

Adottiamo l'opzione 3.

Per MediFlow vale quindi questa regola:

- il `portal-handoff` resta il boundary operativo disponibile oggi
- ogni integrazione SISS/FSE oltre quel boundary richiede un percorso
  `SSI/A2A` esplicito, fondato su scenari approvati, documentazione tecnica
  pertinente e qualifica/provisioning compatibili con il contesto `MMG/PDF`

Questa decisione non afferma che MediFlow debba per forza diventare una `SSI`
qualificata autonoma; afferma pero che non possiamo progettare la prossima
integrazione reale come se tale boundary non esistesse.

## Conseguenze

Positivo:

- il team smette di confondere `esiste una modalita tecnica` con `e gia
  implementabile in produzione`
- `WUL-180` diventa una mappa di fattibilita vera, non un catalogo di desideri
- `WUL-177` e `WUL-179` possono sincronizzare documentazione utile senza creare
  il falso presupposto che il solo corpus sblocchi il runtime

Negativo:

- il prossimo step non e ancora codice integrativo sul backend SISS
- alcuni desideri prodotto restano sospesi finche non scegliamo un target
  preciso e un percorso di qualifica coerente

## First Thin Slice

1. Formalizzare il boundary nel documento
   [docs/siss-ssi-a2a-feasibility.md](../siss-ssi-a2a-feasibility.md).
2. Riallineare la baseline SISS e il piano attivo per evitare ambiguita.
3. Usare il corpus documentale sincronizzato per scegliere una sola capability
   da perseguire davvero oltre l'handoff:
   - `Modulo Prescrittivo Regionale` via webapp ufficiale
   - `FSE` scenario-specific
   - `SGDT` solo nel perimetro `PAI`
4. Non introdurre runtime code verso SISS certificato finche i prerequisiti
   sopra non sono chiari.

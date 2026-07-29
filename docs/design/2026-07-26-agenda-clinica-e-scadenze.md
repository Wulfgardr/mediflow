# Agenda clinica: dai controlli alle scadenze terapeutiche

Data: 2026-07-26
Stato: **intento di prodotto**, dettato da Leonardo e trascritto qui. Non e'
implementato. Le note tecniche sono mie e verificate sul codice attuale.

## Da dove si parte

L'agenda nasce legata a Zimbra ed e' destinata a essere rimossa o rimodellata.
Il punto non e' sostituire un connettore con un altro: e' che una agenda
appesa a un calendario aziendale risponde alla domanda sbagliata. Dice quando
c'e' un appuntamento, non quando **una decisione clinica scade**.

## Cosa deve diventare

Una vista omogenea che tiene insieme quattro famiglie di scadenze, oggi sparse
o assenti:

1. **Visite di controllo.** Gia' esistono come `checkups` e l'agenda le legge.
2. **Rivalutazioni.** Il momento in cui un quadro va riguardato, che oggi non ha
   una collocazione propria.
3. **Fine di una terapia.** Una copertura antibiotica prescritta il giorno X
   finisce il giorno Y. Quel giorno Y oggi non esiste da nessuna parte se non
   nella testa di chi ha prescritto.
4. **Sospensione di un farmaco.** Un cardiotropo va sospeso prima di un
   determinato esame. Serve il promemoria della sospensione **e** quello della
   ripresa, perche' il rischio clinico sta in entrambi gli estremi.

La frase che riassume l'intento, nelle parole di Leonardo: sapere **quando ho
prescritto qualcosa e quando lo devo rimuovere.**

## Perche' non e' un calendario

Un appuntamento e' un evento: ha una data e la si onora o si sposta. Una
scadenza terapeutica e' la **conseguenza di una decisione gia' presa**, e non
puo' essere spostata senza rivedere la decisione. Sono due oggetti diversi e
vanno mostrati insieme ma non confusi: la vista e' una, la semantica no.

Ne segue che la sorgente di verita' resta MediFlow. EventKit e' una
**proiezione**: l'agenda puo' comparire nel calendario ordinario perche' e'
comodo vederla accanto al resto, ma il calendario non e' il posto dove quelle
scadenze vivono, e non deve poterle contraddire.

## Come atterra sul codice esistente

Verificato leggendo il codice attuale.

- `AgendaWorkspaceModel` (`ClinicalWorkspaceViews.swift`) oggi legge solo
  `fetchScopedCheckups` piu' i pazienti per risolvere i nomi. Le scadenze
  terapeutiche non passano di li'.
- Le terapie hanno gia' un proprio percorso, `fetchScopedTherapies` e la
  sezione per paziente, ma nessuna nozione di **fine**: il modello porta stato,
  dosaggio, motivazione, non una data di scadenza.
- Quindi il primo passo non e' interfaccia: e' che una terapia possa dichiarare
  quando finisce, e che una sospensione possa dichiarare quando comincia e
  quando rientra.
- La rotta `/api/v1/network/checkups` esiste e ha la sua capability
  (`network.replica.readonly-agenda`). Una agenda che mostra anche terapie
  attraversera' anche `network.replica.readonly-therapies`: il cancello
  proattivo introdotto oggi va esteso di conseguenza, altrimenti la vista
  supera il proprio gate e fallisce sulla seconda lettura. E' lo stesso difetto
  gia' trovato su Agenda e Diario globale con `includeDeleted`.

## Vincoli che valgono comunque

- **Nessuna scadenza clinica puo' essere inventata dall'interfaccia.** Se la
  data di fine non e' stata dichiarata da chi prescrive, l'agenda dice che non
  c'e', non la deduce dalla posologia.
- **Uno stato non letto non e' uno stato vuoto.** Vale qui come nelle tre viste
  corrette oggi: se l'archivio delle terapie non e' stato letto, l'agenda non
  puo' dire che non ci sono scadenze.
- **EventKit chiede un permesso.** L'agenda deve funzionare per intero senza
  quel permesso, e la proiezione sul calendario deve essere una scelta
  esplicita, non il modo in cui la funzione si accende.
- **Niente PHI nel calendario di sistema senza una decisione esplicita.** Un
  evento EventKit e' leggibile da altre app e puo' finire in sincronizzazioni
  fuori dal controllo dell'archivio. Il titolo di default non deve contenere
  nome del paziente ne' farmaco.

## Domande aperte, che sono di prodotto e non mie

1. La rivalutazione e' un tipo di controllo o un oggetto a se'?
2. La fine terapia e' un campo sulla terapia o un evento separato che la
   referenzia? La seconda regge meglio le proroghe, la prima e' piu' semplice.
3. La sospensione periprocedurale lega farmaco ed esame: l'esame e' un
   `checkup` o una prestazione?
4. La proiezione EventKit e' per singolo paziente, per ambulatorio, o unica?

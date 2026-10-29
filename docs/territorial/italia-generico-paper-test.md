# Prova sulla carta: Italia generico

Data: 2026-10-29. Scenario documentale per WUL-764, circa due pagine.
Esito: i punti proposti in [ADR 0170](../adr/0170-territorial-service-extension-points.md)
possono descrivere un profilo nazionale senza dipendenze lombarde. È una
verifica di separazione concettuale, non una prova eseguibile né un secondo
modulo rilasciato. ADR 0170 resta Proposed.

## Prima pagina: profilo senza servizi regionali

Si assume un'installazione con preset già ammesso `core+it`, Lombardia disattiva.
Il nucleo conserva identità locale, dati clinici, servizi, autorizzazione,
audit e conservazione. Il profilo Italia propone requisiti nazionali per
FSE 2.0/INI e ricetta dematerializzata SAC. Non dichiara che un singolo medico
possa collegarsi direttamente all'INI o al SAC. Il percorso effettivo,
l'ammissione del chiamante e gli schemi correnti sono non documentati per
questa installazione ipotetica e devono essere acquisiti prima di un adapter.

La base nazionale è distinta dal modo di raggiungerla. Il progetto CNR FSE9
descrive l'evoluzione delle specifiche di interoperabilità dei FSE tramite
INI e dei relativi contenuti semantici; non concede un'API a MediFlow.
[Fonte istituzionale CNR FSE9](https://www.icar.cnr.it/progetti/fse9-sviluppo-ed-evoluzione-tecnico-funzionale-del-fascicolo-sanitario-elettronico-in-ottica-fse-2-0/),
consultata il 29 ottobre 2026, pagina HTML senza versione o paginazione.
Il decreto 30 dicembre 2020, art. 3, nel testo modificato il 1 dicembre 2022,
descrive l'accesso dell'assistito al SAC anche tramite SAR per consultare
ricette e promemoria. Non è il contratto di emissione per un gestionale.
[Fonte MEF, articolo 3](https://def.finanze.it/DocTribFrontend/getAttoNormativoDetail.do?ACTION=getArticolo&articolo=Articolo+3&codiceOrdinamento=200000300000000&id=%7BC1D8F507-9B7E-47F0-8BA5-62CBD111E2B6%7D),
consultata il 29 ottobre 2026, testo HTML senza paginazione.
Queste fonti ancorano il perimetro nazionale; non definiscono trasporti,
ruoli, consensi o stati di errore completi per un adapter nuovo.

| Punto | Contributo ipotizzato Italia generico | Elemento che non deve entrare nel nucleo |
| --- | --- | --- |
| Identità operatore | Riferimento all'operatore autorizzato per il canale nazionale scelto; requisiti effettivi non documentati | Carta Operatore SISS, ruolo 6/56, struttura ARIA |
| Identità assistito | Identificatori del profilo Italia e verifica della corrispondenza locale, senza fusione automatica | Censimento NPIA o anagrafe lombarda come prerequisito universale |
| Cataloghi | Sistemi di codifica/versioni richiesti dal profilo nazionale; selezione e licenze da documentare | DDC obbligatorio per ogni prescrizione italiana |
| Prescrizione | Contratto astratto prepara/consegna/verifica per ricetta dematerializzata; schema SAC da acquisire | PRREG, parametro appl e token GUI come formato comune |
| Certificazione | Nessun servizio aggiunto in questa prova; punto presente, contributo assente | GCM/SEB attivato per analogia con SAC |
| Documenti e fascicolo | Requisiti documentali FSE 2.0 e riferimento al processo INI; connettore effettivo non documentato | FSEWS regionale obbligatorio nel nucleo |
| Presa in carico | Nessun contributo in questa prova | PIC/PAI o CDOM assunto come workflow nazionale |
| Flussi dovuti | Nessun contributo in questa prova | SIAP assunto come debito informativo di ogni installazione |
| Qualifica | Registro requisiti e prove del canale effettivamente scelto, con stato documentato e lacune | PVV/RPV ARIA imposto a un contesto senza Lombardia |

Il manifesto ipotetico ha `moduleId=it`, `layer=national`, dipendenza dal solo
contratto nucleo, due servizi descrittivi `it.fse` e `it.dematerialised-rx`.
Entrambi hanno evidenze documentali di perimetro, lacune nominative e nessuna
operazione di emissione abilitata. Le modalità API/lancio/handover/UI
incorporata sono **da confermare, non documentate per questo profilo**.
Non si riusa la modalità PRREG per riempire le celle vuote. Gli altri punti
non ricevono servizi fittizi per rendere completo l'elenco.

## Seconda pagina: percorsi e aggiunta della Lombardia

Percorso documentale FSE: il medico seleziona assistito e finalità nel servizio
locale, il profilo nazionale seleziona il requisito documentale e la versione,
poi una futura implementazione ammessa fornisce indice/documento o evidenza
di pubblicazione. Preparazione e validazione locale non attestano ricezione
nel fascicolo. In assenza del canale istituzionale il risultato è sospeso,
con la lacuna esposta. `confirmed` richiederebbe evidenza correlata alla
specifica operazione; il contratto non inventa un successo del circuito INI.

Percorso documentale ricetta: un ordine revisionato usa codici e versioni
dichiarati dal profilo nazionale. Il nucleo conserva il piano approvato e
l'autorità locale, ma non costruisce un messaggio PRREG. Il servizio restituisce
`prepared`; senza schema/canale autorizzato resta `suspended`. Un futuro
connettore nazionale ammesso dovrà mappare rifiuti, protocolli ed eventuali
esiti parziali. Una risposta persa dopo un possibile invio produce `uncertain`,
non un secondo invio. Idempotenza, annullo e tempi non documentati restano
lacune. La sola presenza di SAC nel disegno non li risolve.

Si aggiunge poi il modulo `lom`, stesso repository e dipendenza da `it`, con
il preset esistente `core+it+lom`. Il suo manifesto aggiunge PRREG sul punto
prescrizione, FSEWS sul punto documenti, identità SISS su identità operatore
e qualifica ARIA su qualifica. Il modulo porta schemi, versioni, ruoli e
mapping regionali. Il nucleo continua a usare gli stessi riferimenti e stati.
Il manifesto delle capacità WUL-587 distingue ID di capacità nazionali e
regionali: PRREG non sostituisce silenziosamente il servizio SAC ipotizzato.
Se due servizi potrebbero soddisfare la stessa esigenza, la configurazione
host deve selezionare esplicitamente il percorso ammesso; nessun doppio invio
e nessun fallback automatico fra canali istituzionali.

La scelta dell'assetto resta all'owner e ai canali di 0158. Un client non
abilita Lombardia dichiarandola nel manifesto. Disattivare Lombardia spegne
operazioni regionali e rete anche per riconciliare, conservando storico e
ricevute locali; Italia rimane attiva. Un atto regionale incerto rimane tale,
non diventa una nuova ricetta nazionale. La lettura storica e il ripristino
restano responsabilità del nucleo, secondo il ciclo di vita già accettato.

Criteri della prova sulla carta: nessun parametro ARIA richiesto dai nove
contratti comuni; punti senza contributo ammessi; stesso involucro per i due
profili; fonte/qualifica ed esiti distinti dal preset; aggiunta/rimozione del
contributo lombardo senza riscrittura del nucleo. Questi criteri risultano
soddisfatti dal disegno. Restano non provati parser del manifesto, adapter,
compatibilità runtime, contratti nazionali completi e correttezza di una
configurazione reale: richiedono lavoro successivo autorizzato e prove.

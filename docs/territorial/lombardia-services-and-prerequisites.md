# Lombardia: servizi, priorità e prerequisiti

Data: 2026-10-29. Ricerca documentale per WUL-760/WUL-764, collegata ad
[ADR 0170 Proposed](../adr/0170-territorial-service-extension-points.md).
Nessuna abilitazione, collaudo o ammissione acquisita. Decisione corrente:
solo handover sul portale e scheletro sintetico; nessun accesso richiesto qui.
Ente e Software House rimangono alternative aperte.

## Provenienza e limiti

Lettura del README e delle dodici schede della biblioteca tecnica privata
SISS del 30 settembre, con aggiornamento del 9 ottobre e contratti mirati
PRREG/GCM. Il README dichiara zero documenti revisionati integralmente:
le evidenze valgono solo per le pagine indicate. Originali regionali e schede
private non sono allegati né copiati nel repository o in Linear. Le citazioni
seguenti consentono al titolare autorizzato di risalire agli originali.
Le date sono del portale, salvo indicazione di revisione interna.
Lo stato editoriale di una fonte non ne prova l'applicabilità corrente.
Tutto ciò che manca nelle fonti è **non documentato**.

La descrizione WUL-760 conserva acquisizioni precedenti; il commento del
28 ottobre riferisce un contatto del 9 ottobre e sollecito inviato il 28,
senza risposta rilevata nella casella verificata. Questa ricerca non verifica
la posta e non estende quel controllo ad altre caselle. La decisione del
29 ottobre in WUL-764 non annulla quel contatto storico, ma mantiene sospesa
la scelta della veste istituzionale e non autorizza nuovi invii.

## Dodici schede sui punti di innesto

Le collocazioni sono proposte di architettura. Tutti i servizi sono qui
**documentati sulle porzioni lette**; prove sintetiche future e stato del
launcher esistente non qualificano l'intero servizio.

| Scheda | Punti di innesto | Operazione o collegamento documentato e fonte | Lacuna del contratto da risolvere |
| --- | --- | --- | --- |
| Accesso API Manager e identità | operator-identity; qualification | Contesto operatore e abilitazioni distinte dalle subscription, GEN02 pp. 52-53; API35 pp. 12-16 | Contesti applicazione/operatore/struttura e durata devono avere schemi distinti; credenziale non è capacità. |
| Validazione ARIA | qualification | Iter ASIV, PVV, RPV e circuito virtuale, GEN02 pp. 64-65 | Registrare ambito del verdetto per build, ruolo e modalità; manca iter assegnato a MediFlow. |
| PRREG | prescribing; operator-identity; patient-identity | GUI contestuale/WS e vincolo MMG/PLS, PR15 p. 8; PR14 pp. 11-16 | Enumerazione stati completa, scadenza/correlazione e schema titolare non completi; vedere scheda sotto. |
| FSEWS | documents-record; patient-identity | Indice prima del recupero, finalità/consenso/ruoli e formati, FSE03 pp. 7-11, 17 | Distingue indice, autorizzazione, recupero e integrità; non eredita un accesso universale alle ricette. |
| ADI/CDOM FHIR | care-management; documents-record | Ente CDOM, assegnazione e profili REST FHIR 4.0.1, ADI01 pp. 13, 19, 27-28, 33 | Package, canonical URL, ValueSet e SearchParameter non acquisiti: nomi profilo insufficienti. |
| PIC messaging FHIR | care-management; prescribing | Messaggi e contesto MMG/PLS ruolo 6, PIC02 pp. 5, 7-10, 15, 22 | Versione base FHIR non documentata nelle sezioni lette; distinguere messaggio consequence e retry. |
| DDC | catalogues | Elenco/tabelle SOAP e snapshot, DDC01 pp. 17-19; DDC02 pp. 1-2 | Licenza payload, aggiornamento/trascodifica e accesso attuale da confermare; deprecazioni da rispettare. |
| PRI HL7v2 | care-management; documents-record; prescribing, secondo scenario | Flussi interni PRI e ACK, HL7 pp. 14-16, 65, 82-84, 226 | Non è un singolo servizio di dominio: manca selezione scenario e contratto trasporto/framing; distinguere ACK da esito clinico. |
| NOTIER | mandatory-flows, collocazione provvisoria amministrativa | Ordini/fatturazione REST/XML, NOT03 pp. 6, 9-10, 17, 27, 38 | Lacuna di dominio: i flussi dovuti clinici non coprono automaticamente ordinazione/fatturazione. Nessuna capacità amministrativa aggiunta; servirebbe contratto dedicato. |
| NPIA | care-management; patient-identity | Pazienti/interventi con precondizioni di struttura, NPIA12 pp. 15-17, 26, 29 | Censimento/acquisizione solo WebSI; scope personale_read del POST da confermare, non correggere per analogia. |
| SIAP | mandatory-flows | Eventi SSI MMG/PLS e acquisizione parziale, SIAP10 pp. 5, 7, 9-10, 17-20 | Distinguere acquisizione, consolidamento ed esito ministeriale; YAML 1.0.1 e specifiche ministeriali citati ma non acquisiti. |
| DCE/FSE/CDA | documents-record; qualification | Pubblicazione e vincoli documentali per scenario, REF01 pp. 8-9, 65-67, 122; FSE03 p. 17 | Template non è profilo completo né qualifica; IG/Schematron mancanti, metodi deprecati e RMR WebSISS da non generalizzare. |

GCM non è una tredicesima scheda della serie iniziale: la priorità certificati
è approfondita nel contratto mirato GCM e sotto. Identità assistito è un punto
trasversale; nessuna delle dodici schede prova un'anagrafe regionale generica
completa. Firma, consensi, errori e riconciliazione attraversano più punti,
ma richiedono contratti specifici del servizio e non un'autorizzazione globale.

## Modalità dei dodici servizi

La qualifica della modalità riguarda l'esistenza nella fonte, non l'accesso
di MediFlow. `Da confermare` significa non documentato nel materiale letto.
`Fuori perimetro` è una decisione corrente, non un divieto regionale.
Il lancio contestuale è distinto dalla semplice apertura manuale del portale.

| Servizio | API applicativa | Lancio contestuale | Handover al browser | UI incorporata |
| --- | --- | --- | --- | --- |
| Accesso | Documentata, API35 pp. 12-16 | Documentato, HEL09 pp. 7-9 | Documentato, browser di sistema HEL09 pp. 7-9 | Non disponibile nella superficie API Manager, API35 p. 8 (iframe) |
| Validazione | Da confermare, non documentata | Da confermare, non documentato | Documentato per portale credenziali, GEN02 pp. 52-53; iter non automatizzato | Da confermare, non documentata |
| PRREG | Documentata per ruoli ammessi; WS non disponibile per MMG/PLS, PR15 p. 8 | Documentato GUI, PR14 pp. 11-16 | Documentato nel percorso MediFlow, ADR 0045 e documento PRREG | Da confermare, non documentata per PRREG; fuori perimetro oggi |
| FSEWS | Documentata, FSE03 pp. 7-11 | Da confermare, non documentato dalla scheda | Fuori perimetro di FSEWS; launcher FSE distinto in ADR 0045 | Da confermare, non documentata |
| ADI/CDOM | Documentata, ADI01 pp. 13, 19, 33 | Da confermare, non documentato | Fuori perimetro della cooperazione selezionata | Da confermare, non documentata |
| PIC | Documentata, PIC02 pp. 7-10 | Documentato, PIC02 pp. 15, 22 | Documentato per sessione browser, PIC02 p. 22 | Da confermare, non documentata |
| DDC | Documentata, DDC01 pp. 17-19 | Da confermare, non documentato | Fuori perimetro del recupero tabelle | Da confermare, non documentata |
| PRI HL7 | Documentata come messaggistica interna, HL7 pp. 82-84; API esterna da confermare | Da confermare per scenario | Da confermare per scenario | Da confermare per scenario |
| NOTIER | Documentata, NOT03 pp. 9-10, 17 | Da confermare, non documentato | Fuori perimetro corrente | Da confermare, non documentata |
| NPIA | Documentata, NPIA12 pp. 15-17, 26, 29 | Da confermare, non documentato | Documentato ricorso a WebSI per precondizioni, NPIA12 pp. 15-17; prefill non documentato | Da confermare, non documentata |
| SIAP | Documentata, SIAP10 pp. 9-10, 17-20 | Da confermare, non documentato | Fuori perimetro del flusso SSI | Da confermare, non documentata |
| DCE/FSE/CDA | Documentata per scenari selezionati, REF01 pp. 65-67; RMR senza A2A p. 122 | Da confermare per tipo | Documentato WebSISS per RMR, REF01 p. 122 | Da confermare, non documentata |

Il limite iframe API Manager non si estende per analogia a tutte le webapp.
Nessun canale tecnico qui documentato autorizza una chiamata istituzionale.

## Priorità 1: prescrizioni

Operazioni documentate: creazione contesto GUI, apertura URL restituita,
verifica asincrona del risultato tramite `getResultState`; invio WS soltanto
per soggetti ammessi. PR14 pp. 8, 11-16, 19-21, 41-43, 45-52, 55.
Il medico abilitato decide e verifica contenuto e atto prescrittivo; ruolo,
struttura e applicazione devono essere coerenti con l'identità SISS. L'Ente
richiede configurazione/censimento; ARIA governa abilitazioni e validazione.
Questa ripartizione descrive il flusso, non sostituisce accordi mancanti.

Ingresso GUI: contesto operatore/struttura, applicazione e richiesta secondo
schema/versione. Uscita: token di contesto, URL e struttura; in seguito esiti
e identificativi delle prescrizioni/promemoria. Token di contesto e token
OAuth sono distinti. PRG000100, PR000017 e PR000018 distinguono applicazione
non abilitata, contesto incoerente e input invalido (PR14 pp. 41-43, 45-52).
Il dizionario completo degli stati è non documentato nelle porzioni lette:
nessun HTTP 200 o ritorno al gestionale prova da solo l'emissione.

Percorso verso il nazionale: il prescrittivo regionale resta il confine del
medico; il rapporto ricetta elettronica/NRE/MEF è descritto nella
[ricognizione PRREG](../siss-modulo-prescrittivo-regionale.md).
Endpoint SAC, deleghe e accessi direttamente riusabili da MediFlow sono
non documentati nel contratto selezionato. Non si deduce accesso nazionale
dal possesso di un contesto SISS.

PR15 pp. 2, 8 conferma WS escluso per MMG/PLS e per ricette di ricovero;
la variante GUI con passaggio di contesto rimane distinta dal WS puro.
PR15 pp. 21-24 aggiunge sostituzione/titolare e flusso silente GUI: tipi dei
flag e capitalizzazione del codice ASL del titolare richiedono schema ufficiale.
Il conflitto `FlagStampaIniziali` PRSC 2026/GSSC 8.16 p. 59, registrato in
WUL-760, resta sospeso: manca fonte competente riconciliata e non si seleziona
una semantica arbitraria.

| Modalità | Stato e decisione |
| --- | --- |
| API applicativa | Documentata condizionatamente per ruoli ammessi; WS non disponibile MMG/PLS (PR15 p. 8). Nessuna integrazione diretta ora. |
| Lancio contestuale GUI | Documentato (PR14 pp. 11-16); abilitazione MediFlow da confermare. Non coincide con launcher senza contesto. |
| Handover browser | Documentato nel prodotto (ADR 0045, ricognizione PRREG); unica direzione operativa corrente. |
| UI incorporata | Da confermare per PRREG, non documentata; fuori perimetro corrente. Nessuna replica del motore prescrittivo. |

Decisione: conservare il solo handover e preparare lo scheletro sintetico
WUL-761. Nessuna prova istituzionale autorizzata. I casi proposti coprono
ruolo/modalità errati, token scaduto/riusato, contesto incoerente, esito
parziale e risposta persa senza reinvio automatico. Non eseguiti qui.

## Priorità 2: certificati di malattia

Fonti GCM61 pp. 62-117 e GCM02 pp. 7-13: invio certificato ordinario,
rettifica, annullo, ricerca, ristampa; inizio ricovero, annullo comunicazione,
certificato di dimissione e sua rettifica hanno operazioni e ruoli separati.
Per l'ordinario sono descritti ruoli 5/6/13/14; non si ereditano verso ricovero
e dimissione. Profili virtuali descritti come reale+50 non sono credenziali
acquisite. Ricerca/ristampa e annullo richiedono anche vincoli di titolarità.

Ingresso: medico, lavoratore, dati clinici/amministrativi revisionati;
protocollo originale per variazioni. Uscita: identificativo/protocollo,
data ricezione, PDF e, per variazioni, riferimenti originale/nuovo/annullo.
Warning, esito negativo e SOAP fault sono distinti. Certificato con diagnosi
e attestato hanno destinatari e contenuti differenti. GCM61 pp. 62-85;
cardinalità, namespace e header completi rimangono da acquisire.

Il medico assume la responsabilità dell'atto e ne verifica contenuto ed esito.
Il software deve conservare correlazione e ricevuta senza dichiarare invio
completato in assenza di evidenza. Percorso descritto: operatore SISS,
servizi GCM/SEB, SAC/MEF e destinazione INPS, con protocollazione sincrona
(GCM02 pp. 7-13). Nessuna credenziale o API INPS diretta per MediFlow è dedotta.
Il canale SOAP tramite API Manager è acquisito nella descrizione WUL-760;
subscription, scope e circuito di prova corrente restano non documentati
per MediFlow. SANDBOX regionale non dimostra un circuito nazionale GCM.

| Modalità | Stato e decisione |
| --- | --- |
| API applicativa | Documentata SOAP, GCM61 pp. 62-117; abilitazioni e schemi effettivi da confermare. Fuori esecuzione corrente. |
| Lancio contestuale | Documentato per metodi PRI selezionati, SIPR58 pp. 14-22, 34-42, 58-61; applicabilità/installazione MediFlow da confermare. |
| Handover browser | Documentata Web Application nella ricognizione GCM e FAQ14 pp. 5-8; ingresso stabile e prefill corrente da confermare prima di una nuova funzione. |
| UI incorporata | Da confermare, non documentata nel contratto selezionato; fuori perimetro corrente. Il limite iframe API35 p. 8 vale per quella superficie. |

SIPR58 p. 61 depreca i metodi PRI 2010, senza deprecare automaticamente ogni
metodo SEB più vecchio. Le indicazioni storiche delle FAQ su finestre di
rettifica/annullo non diventano regole attuali senza conferma.
Decisione: solo handover al portale e scheletro sintetico WUL-761, senza
invio, firma o acquisizione automatica PDF. Nessuna prova istituzionale.
Casi proposti: protocolli originale/nuovo, annullo distinto, rifiuto nazionale,
risposta persa, separazione certificato/attestato. Non eseguiti qui.

## Prerequisiti: due strade ancora aperte

Le celle descrivono domande, non requisiti già soddisfatti. Ogni ignoto resta
non documentato per MediFlow. Owner indica chi cura il chiarimento; ARIA o
altro ente competente deve fornire la risposta. Leonardo decide e invia;
nessun agente richiede credenziali o attiva servizi.

| Tema | Strada Ente aperta | Strada Software House aperta | Fonte acquisita; fonte mancante | Domanda precisa | Owner |
| --- | --- | --- | --- | --- | --- |
| Adesione/accordi | Ente aderente e mandato non identificati | Registrazione senza Ente non confermata | GEN02 pp. 52-53, 64-65; manca iter applicabile e modulistica/accordi | Quali accordi, soggetti firmatari e prerequisiti valgono per ciascuna veste? | Leonardo, risposta ARIA adesioni |
| Qualifica software | Scenario SSI del committente da definire | Qualifica autonoma o tramite Ente non documentata | ADR 0045, GEN02 p. 64; manca procedura applicabile a MediFlow | Quali scenari e versioni del software devono essere qualificati nelle due strade? | Responsabile software, risposta ARIA qualifica |
| Identità/certificati | Operatore, struttura, certificati da assegnare | Operatore virtuale ruolo 56 senza Ente non documentato | API35 pp. 12-16, GEN02 pp. 52-53; manca profilo rilasciato e policy certificati | Chi rilascia operatore virtuale e certificati a una SWH e con quali vincoli per Ente? | Leonardo, risposta ARIA identità |
| Subscription/scopes | Attivazioni PRREG/GCM non acquisite | Catalogo servizi accessibili non documentato | PR14 pp. 15-21, API35; mancano autorizzazioni per servizio | Quali subscription e scope servono a PRREG/GCM e chi approva appl e idStruttura per MMG singolo? | Responsabile software, risposta ARIA API Manager |
| Ambiente/dati di prova | Circuito virtuale e identità non assegnati | Accesso senza Ente e ruolo virtuale non documentati | PR14 p. 14, GCM02 pp. 7-13; manca circuito GCM attuale | Quali ambienti, identità sintetiche e limiti nazionali sono disponibili per ciascuna strada? | Responsabile verifiche, risposta ARIA servizi |
| Schemi/contratti | Artefatti effettivi da consegnare | Stessi artefatti non disponibili alla SWH | PR15 pp. 21-24, GCM61 pp. 62-117; mancano XSD/OpenAPI e dizionari completi | Quali schemi correnti e regole di riconciliazione coprono PRREG/GCM? Come risolvere FlagStampaIniziali? | Responsabile software, risposta ARIA titolari servizio |
| Collaudo | Piano Ente e responsabili non nominati | Prove autonome e sponsor non documentati | GEN02 pp. 64-65; manca piano ASIV/PVV/RPV applicabile | Quali prove, verbali, responsabili e criteri di accettazione sono richiesti alle due vesti? | Responsabile verifiche, risposta ARIA validazione |
| Ammissione produzione | Sede, build e perimetro non autorizzati | Condizioni commercializzazione/ammissione non documentate | GEN02 pp. 64-65; manca provvedimento competente | Chi autorizza produzione, per quali ruoli/sedi/build, durata e rinnovi? | Leonardo, risposta ARIA ammissione |
| Assistenza | Responsabilità Ente/fornitore da concordare | Canale SWH e obblighi non documentati | GEN02 pp. 64-65 non completano il tema; manca contratto assistenza/SLA | Quali contatti, escalation, manutenzione e obblighi sugli incidenti valgono? | Leonardo, risposta ARIA assistenza |
| Revoca | Gestione accessi cessati non documentata | Revoca qualifica/chiavi e aggiornamenti non documentata | Fonti lette non completano il tema; manca policy revoca | Chi comunica revoche, con quali tempi ed effetti su credenziali, versioni e pratiche incerte? | Responsabile sicurezza, risposta ARIA sicurezza |
| Postazione/dispositivi | PRI/Helper installati non verificati | Compatibilità distribuzione SWH non documentata | HEL09 pp. 7-9, SIPR58; manca matrice client corrente | Quali componenti e piattaforme, incluso iPhone/iPad per Helper, sono supportati ufficialmente? | Responsabile software, risposta ARIA client |
| SIAP come terzo servizio | Pertinenza SSI/obbligo Ente non stabilita | Censimento SSI/idSender non acquisiti | SIAP10 pp. 5, 7, 9-10, 17-20; mancano YAML 1.0.1 e specifiche ministeriali 1.5 | Come si assegna idSender e come si ottengono tracciati, prove ed esiti per Ente e SWH? | Leonardo, risposta ARIA SIAP |

SIAP è candidato terzo servizio per pertinenza all'assistenza primaria,
non una nuova priorità esecutiva approvata: mantenere valutazione/scheletro
sintetico, nessun invio. SGDT/PREG/protesica restano successivi alle due
priorità. Non si sceglie una veste istituzionale per accelerare la simulazione.
La [bozza di lettera](aria-letter-draft.md) raccoglie le domande; i dubbi già
chiusi su OAuth e nomi dell'ambiente non vengono riaperti.

## Registro delle fonti regionali citate

Citazioni bibliografiche, non allegati. Pagine riferite al PDF come nelle
schede private; per i dati ancora ignoti non si inventano pagine. Data di
consultazione delle schede: 29 ottobre 2026. Non è un refresh del portale.

| Sigla | Codice | Versione | Data portale | Pagine lette pertinenti |
| --- | --- | --- | --- | --- |
| GEN02 | `DC-SCEN-GEN#02` | 1.9 | 03/03/2026 | 1,2,5,52,53,64,65 |
| API35 | `PIA-SIAU@115` | 35.6 | 06/05/2025 | 1,12,13,16 |
| HEL09 | `CRS-ISAU-SIAU#116` | 09 | 04/03/2025 | 1,7,8,9 |
| PR14 | `ARIA-PRREG-SIAA@01` | 1.4 | 03/07/2026 | 1,7,8,9,11,13,14,15,16 |
| FSE03 | `DC_FSEWS-SIAA#01` | 03 | 29/01/2025 | 1,7,8,9,10,11,17 |
| ADI01 | `DC-COOP-FHIR#01` | 01 | 18/01/2023 | 1,5,6,8,13,19,27,28,33 |
| PIC02 | `DC-COOP-FHIR_PIC#02` | 1.0 | 13/09/2024 | 1,5,7,8,9,10,15,22 |
| DDC01 | `DC-DDC-SIAA#01` | 02 | 20/09/2021 | 1,17,18,19 |
| DDC02 | `DC-DDC-SIAA#02` | 2.49 | 06/08/2026 | 1,2 |
| HL7 | `AS-PS_R-SEHL7#01` | 10.35 | 06/08/2026 | 1,3,4,14,15,16,65,82,83,84,226 |
| NOT03 | `DC-NOTIER-SIAA#01` | 03 | 22/12/2025 | 1,2,6,9,10,17,27,38 |
| NPIA12 | `ARIA-NPIA-APIEXT-SIAA@01` | 1.2.0 | 07/01/2026 | 1,2,5,7,15,16,17,26,29 |
| SIAP10 | `ARIA-SIAP-SIAA#01` | 1.0 | 06/08/2026 | 5,7,9,10,17,18,19,20 |
| REF01 | `DC-SCEN-REF#01` | 10.16 | 24/06/2026 | 1,2,8,9,65,66,67,122 |
| PR15 | `ARIA-PRREG-SIAA@01` | 1.5 | 08/10/2026; revisione 30/09/2026 | 2, 8, 21-24 |
| GCM61 | `DC-SEBC_GCM-SIAA#01` | 6.1 | 16/06/2021 | 8-9, 62-117 (porzioni selezionate), 120-121 |
| GCM02 | `DC-SCEN-GCM#01` | 02.2 | 13/02/2017 | 7-13 |
| SIPR58 | `AS-PS_R-SIPR#58` | 2.3 | 04/10/2023 | 6, 13-14, 18, 22, 34, 36, 42, 58, 60-61 |
| FAQ14 | `DC-GCM-FAQ#01` | 01 | 09/07/2014 | 5-8, storica |

API35 p. 8 e PR14 pp. 19-55 sono approfondimenti dei contratti mirati;
PR15 è l’aggiornamento del 9 ottobre, senza riscrivere la fonte storica PR14.
PRSC 2026 e GSSC 8.16 sono citazioni del conflitto aperto in WUL-760:
data completa, codice preciso PRSC e fonte competente riconciliata sono
non documentati in questa unità, quindi non fondano una scelta implementativa.

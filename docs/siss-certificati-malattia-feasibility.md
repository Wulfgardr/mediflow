# Certificati di malattia: integrazione applicativa e boundary MediFlow

> Stato documento: `CANONICAL`

Per i `Certificati di malattia`, la decisione è quale rapporto MediFlow possa
avere con il percorso ufficiale: una vera integrazione applicativa attraverso
SISS/SAR oppure il solo accompagnamento dell’operatore alla Web Application.
Questa nota valuta il confine tra i due casi, senza assumere che la presenza
di interfacce software renda già possibile un runtime dedicato.

Riferimenti canonici:
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [SECURITY.md](../SECURITY.md)
- [docs/README.md](./README.md)
- [docs/markdown-index.md](./markdown-index.md)
- [docs/siss-baseline.md](./siss-baseline.md)
- [docs/siss-ssi-a2a-feasibility.md](./siss-ssi-a2a-feasibility.md)
- [docs/siss-fse-docs-corpus.md](./siss-fse-docs-corpus.md)
- [docs/adr/0045-siss-native-integration-boundary-requires-qualified-ssi.md](./adr/0045-siss-native-integration-boundary-requires-qualified-ssi.md)
- [docs/adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md](./adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md)

<a id="executive-summary"></a>

## Esito della ricognizione

Stato della ricognizione: 2 maggio 2026.

Le fonti pubbliche descrivono il certificato telematico di malattia come un
flusso nazionale normato, ricevuto da INPS e collegato al `SAC`/MEF. In
Lombardia il SISS è qualificato come `SAR`: il medico opera quindi con login
SISS e Carta Operatore, non direttamente con credenziali INPS/SAC.

Le FAQ SISS dichiarano disponibili interfacce software per gli applicativi
del medico, ma il materiale pubblico raccolto consiste soprattutto in FAQ,
manuali e Web Application. Non fornisce un contratto backend completo che
MediFlow possa già riusare.

L’esito prudente è perciò `webapp-mediated`. Una UI dedicata resta
`custom-ui-plausible` soltanto come ipotesi subordinata a specifiche complete,
qualificazione/provisioning e test ufficiali; un runtime MediFlow immediato
con UI proprietaria resta `blocked`.

## Fonti ufficiali rilevanti

| Fonte | Lettura operativa |
| --- | --- |
| [FAQ SISS - Certificati di malattia](https://www.siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/faq.do?voce=23041045) | Le interfacce software per l'integrazione diretta degli applicativi del medico con SISS sono dichiarate disponibili, ma la FAQ conferma anche che i medici lombardi usano SISS/SAR con Carta Operatore, non credenziali INPS dirette. |
| [FAQ SISS - Certificati di malattia in sede di ricovero](https://www.siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/faq.do?voce=49997836) | Il supporto pubblico per il contesto ricovero rimanda alla Web Application e a documenti operativi per comunicazione di inizio ricovero e invio certificato in dimissione. |
| [Documentazione SISS - Web Application Certificati di Malattia](https://www.siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/documentoDiProgetto.do?ACT=1&PR=38) | Il catalogo pubblico indicizza video/manualistica della Web Application Certificati di Malattia `INPS`, inclusi `DC-GCM_IR-VIDEO#01` e `DC-GCM_CR-VIDEO#01`. |
| [INPS - Consultazione dei certificati di malattia telematici](https://www.inps.it/it/it/dettaglio-scheda.it.schede-servizio-strumento.schede-servizi.consultazione-dei-certificati-di-malattia-telematici.html) | INPS riceve i certificati telematici e li rende consultabili agli aventi titolo; il servizio cittadino usa protocollo univoco e credenziali. |
| [INPS - Normativa certificazione telematica di malattia](https://www.inps.it/it/it/dettaglio-approfondimento.schede-informative.49909.normativa-di-riferimento-per-la-certificazione-telematica-di-malattia.html) | La normativa nazionale assegna al medico curante l'invio telematico all'INPS e richiama SAC, DPCM 26 marzo 2008 e decreto 18 aprile 2012 per certificazione/ricovero. |

<a id="matrice-di-fattibilita"></a>

## Matrice di fattibilità

| Obiettivo | Stato | Motivo |
| --- | --- | --- |
| Launcher contestuale verso Web Application ufficiale | `Possibile come futura slice` | Coerente con il boundary `webapp-mediated`, ma va prima verificato il path ufficiale corrente e va trattato come handoff, non come certificazione nativa. |
| Preparazione locale dati paziente | `Possibile con cautela` | MediFlow può preparare CF e contesto operativo, ma non deve inviare diagnosi/prognosi o assumere prefill supportato senza specifica. |
| Archivio locale dei certificati emessi | `Solo manuale/reviewable` | La FAQ SISS parla di salvataggio locale dei PDF generati; MediFlow non deve acquisire automaticamente certificati da INPS/SISS senza contratto. |
| Integrazione backend con applicativo medico | `Plausibile ma bloccata` | Le FAQ dichiarano interfacce disponibili, ma manca nel corpus pubblico il contratto tecnico completo necessario a implementare e validare MediFlow. |
| UI proprietaria MediFlow per redazione/invio certificato | `Blocked` | Richiede specifiche, qualifica, sicurezza, audit, gestione errori e responsabilità medico-legale non disponibili nella slice corrente. |
| Gestione certificato in sede di ricovero/dimissione | `Webapp-mediated` | Il materiale pubblico raccolto rimanda alla Web Application e alla manualistica operativa SISS. |

## Blocker concreti

Il passaggio a qualsiasi runtime per i certificati richiede prima:

1. import autorizzato fuori Git dei manuali/spec SISS applicabili
2. conferma del canale: Web Application, interfacce software SSI, o entrambi
3. modello di autenticazione SISS/SAR con Carta Operatore, ruolo e contesto
   funzionale
4. requisiti di audit, tracciamento protocollo, annullo/rettifica e fallback
   cartaceo
5. regole di minimizzazione: diagnosi/prognosi e PDF certificato non devono
   finire in log o fixture
6. ambiente di test o collaudo ufficiale prima di parlare di invio nativo

<a id="prima-thin-slice-raccomandata"></a>

## Primo intervento raccomandato

Non aprire ora una UI proprietaria per i certificati di malattia. Se il
dominio diventa prioritario, il primo intervento utile è accompagnare
l’operatore alla Web Application ufficiale, entro i limiti seguenti:

### `Certificati official-webapp handoff guard`

Occorre verificare il percorso corrente della Web Application e ammettere il
passaggio esplicito dalla scheda paziente solo se il portale supporta un
ingresso stabile. MediFlow copia o mostra soltanto i dati locali minimi
utili all’operatore e registra un audit dell’apertura privo di PHI, senza
diagnosi o prognosi. Non salva automaticamente il certificato né il PDF
generato.

Prima del runtime devono essere soddisfatti questi criteri:

1. Percorso ufficiale verificato e documentato.
2. Nessun reverse engineering della Web Application.
3. Nessuna precompilazione non dimostrata.
4. Percorso operativo alternativo chiaro verso il portale SISS.
5. Decisione separata prima di qualsiasi integrazione backend personalizzata.

## Decisione operativa

Il percorso proposto è `official-webapp handoff guard`, solo dopo la verifica
dell’accesso ufficiale. Non sono ammessi `custom certificate UI`,
`backend-first certificate engine`, `sync certificati INPS/SISS` o
`archivio automatico dei certificati emessi` nell’ambito qui definito.

La valutazione pubblica del dominio si ferma a questo punto. Un’integrazione
diretta resta possibile solo dopo l’acquisizione del contratto tecnico
completo, del percorso di qualifica e di un ambiente di test ufficiale.

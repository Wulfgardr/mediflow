# Certificati di malattia: integrazione applicativa e boundary MediFlow

> Stato documento: `CANONICAL`

Questo documento restringe il dominio `Certificati di malattia` alla domanda
operativa rilevante per MediFlow: vera integrazione applicativa sopra SISS/SAR,
oppure solo Web Application / handoff governato.

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

## Executive summary

Stato della ricognizione: 2 maggio 2026.

Le fonti pubbliche mostrano tre fatti distinti:

1. il certificato telematico di malattia e un flusso normato nazionale, ricevuto
   da INPS e collegato al `SAC`/MEF
2. in Lombardia il SISS e qualificato come `SAR`, quindi il medico lombardo non
   usa direttamente credenziali INPS/SAC, ma opera attraverso login SISS e
   Carta Operatore
3. le FAQ SISS affermano che esistono interfacce software per integrare gli
   applicativi del medico con SISS, ma il materiale pubblico raccolto mostra
   soprattutto FAQ, manualistica e Web Application, non un contratto backend
   completo riusabile da MediFlow

Esito:

- `webapp-mediated` per un uso prudente oggi
- `custom-ui-plausible` solo come ipotesi subordinata a specifiche complete,
  qualificazione/provisioning e test ufficiali
- `blocked` per runtime MediFlow immediato con UI proprietaria

## Fonti ufficiali rilevanti

| Fonte | Lettura operativa |
| --- | --- |
| [FAQ SISS - Certificati di malattia](https://www.siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/faq.do?voce=23041045) | Le interfacce software per l'integrazione diretta degli applicativi del medico con SISS sono dichiarate disponibili, ma la FAQ conferma anche che i medici lombardi usano SISS/SAR con Carta Operatore, non credenziali INPS dirette. |
| [FAQ SISS - Certificati di malattia in sede di ricovero](https://www.siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/faq.do?voce=49997836) | Il supporto pubblico per il contesto ricovero rimanda alla Web Application e a documenti operativi per comunicazione di inizio ricovero e invio certificato in dimissione. |
| [Documentazione SISS - Web Application Certificati di Malattia](https://www.siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/documentoDiProgetto.do?ACT=1&PR=38) | Il catalogo pubblico indicizza video/manualistica della Web Application Certificati di Malattia `INPS`, inclusi `DC-GCM_IR-VIDEO#01` e `DC-GCM_CR-VIDEO#01`. |
| [INPS - Consultazione dei certificati di malattia telematici](https://www.inps.it/it/it/dettaglio-scheda.it.schede-servizio-strumento.schede-servizi.consultazione-dei-certificati-di-malattia-telematici.html) | INPS riceve i certificati telematici e li rende consultabili agli aventi titolo; il servizio cittadino usa protocollo univoco e credenziali. |
| [INPS - Normativa certificazione telematica di malattia](https://www.inps.it/it/it/dettaglio-approfondimento.schede-informative.49909.normativa-di-riferimento-per-la-certificazione-telematica-di-malattia.html) | La normativa nazionale assegna al medico curante l'invio telematico all'INPS e richiama SAC, DPCM 26 marzo 2008 e decreto 18 aprile 2012 per certificazione/ricovero. |

## Matrice di fattibilita

| Obiettivo | Stato | Motivo |
| --- | --- | --- |
| Launcher contestuale verso Web Application ufficiale | `Possibile come futura slice` | Coerente con il boundary `webapp-mediated`, ma va prima verificato il path ufficiale corrente e va trattato come handoff, non come certificazione nativa. |
| Preparazione locale dati paziente | `Possibile con cautela` | MediFlow puo preparare CF e contesto operativo, ma non deve inviare diagnosi/prognosi o assumere prefill supportato senza specifica. |
| Archivio locale dei certificati emessi | `Solo manuale/reviewable` | La FAQ SISS parla di salvataggio locale dei PDF generati; MediFlow non deve acquisire automaticamente certificati da INPS/SISS senza contratto. |
| Integrazione backend con applicativo medico | `Plausibile ma bloccata` | Le FAQ dichiarano interfacce disponibili, ma manca nel corpus pubblico il contratto tecnico completo necessario a implementare e validare MediFlow. |
| UI proprietaria MediFlow per redazione/invio certificato | `Blocked` | Richiede specifiche, qualifica, sicurezza, audit, gestione errori e responsabilita medico-legale non disponibili nella slice corrente. |
| Gestione certificato in sede di ricovero/dimissione | `Webapp-mediated` | Il materiale pubblico raccolto rimanda alla Web Application e alla manualistica operativa SISS. |

## Blocker concreti

Prima di qualunque runtime certificati servono:

1. import autorizzato fuori Git dei manuali/spec SISS applicabili
2. conferma del canale: Web Application, interfacce software SSI, o entrambi
3. modello di autenticazione SISS/SAR con Carta Operatore, ruolo e contesto
   funzionale
4. requisiti di audit, tracciamento protocollo, annullo/rettifica e fallback
   cartaceo
5. regole di minimizzazione: diagnosi/prognosi e PDF certificato non devono
   finire in log o fixture
6. ambiente di test o collaudo ufficiale prima di parlare di invio nativo

## Prima thin slice raccomandata

Non aprire ora una UI proprietaria per certificati di malattia.

La prima slice utile, se il dominio diventa prioritario, e:

### `Certificati official-webapp handoff guard`

Forma:

- verifica del path ufficiale Web Application corrente
- handoff esplicito dalla scheda paziente solo se il portale supporta un ingresso
  stabile
- copia/mostra solo dati minimi locali utili all'operatore
- audit locale PHI-safe del launch, senza diagnosi/prognosi
- nessun salvataggio automatico del certificato o del PDF generato

Exit criteria prima di runtime:

1. path ufficiale verificato e documentato
2. nessun reverse engineering della Web Application
3. nessun prefill non dimostrato
4. fallback operativo chiaro verso il portale SISS
5. decisione separata prima di qualunque integrazione backend custom

## Decisione operativa

Per MediFlow, oggi, il target corretto e:

- `official-webapp handoff guard`, solo dopo verifica del path ufficiale

e non:

- `custom certificate UI`
- `backend-first certificate engine`
- `sync certificati INPS/SISS`
- `archivio automatico dei certificati emessi`

Questa nota chiude la valutazione pubblica del dominio: l'integrazione diretta
resta possibile solo se verranno acquisiti contratto tecnico completo, percorso
di qualifica e ambiente di test ufficiale.

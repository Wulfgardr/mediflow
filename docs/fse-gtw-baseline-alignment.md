# Allineamento baseline GTW FSE ufficiale

## Scopo

Per capire quale lavoro separi le funzioni locali di MediFlow dal dialogo
GTW/FSE, questa nota confronta il progetto con la baseline ufficiale
`it-fse-support` rilevata nella verifica indicata sotto. Il confronto serve a
rendere visibili le lacune e a ordinare il filone `WUL-41`, evitando che il
lavoro proceda su riferimenti tecnici diversi.

La nota non sostituisce le specifiche ministeriali e non introduce
un’integrazione GTW di produzione. Versioni e stati riportati appartengono
alla verifica documentata, non a una nuova attestazione dei servizi ufficiali.

## Fonti ufficiali monitorate

Verifica manuale eseguita il `2026-03-18` sulle seguenti fonti:

- [`it-fse-support` README](https://github.com/ministero-salute/it-fse-support/blob/main/README.md)
- [`doc/integrazione-gateway` ver. 2.17](https://github.com/ministero-salute/it-fse-support/blob/main/doc/integrazione-gateway/README.md)
- [`openapi/gateway`](https://github.com/ministero-salute/it-fse-support/tree/main/openapi/gateway)
- [`doc/provisioning` + OpenAPI provisioning](https://github.com/ministero-salute/it-fse-support/tree/main/doc/provisioning)
- [`doc/accreditamento`](https://github.com/ministero-salute/it-fse-support/tree/main/doc/accreditamento)
- [`it-fse-catalogs` schema/schematron/dizionari](https://github.com/ministero-salute/it-fse-catalogs)

## Baseline MediFlow oggi

Nella baseline rilevata, MediFlow copre soltanto una parte locale e
preparatoria del percorso FSE:

- terminologie pilota locali via `/api/v1/terminology/*`
- validazione documentale locale pre-export su subset clinici pilota
- governance spec-first del contratto locale `/api/v1`

Nella stessa baseline MediFlow **non** implementa ancora:

- client GTW ministeriale
- provisioning certificati
- trasporto `mTLS + JWT` conforme al baseline ufficiale
- validazione CDA con asset ministeriali `XSD + Schematron`
- workflow di accreditamento e reporting verso l’ecosistema ufficiale

## Matrice allineamento

Legenda stato:

- `Covered`: presente e coerente con la baseline ufficiale
- `Partial`: esiste un primo intervento locale circoscritto, ma non copre la baseline ministeriale
- `Missing`: manca un’implementazione utilizzabile
- `Out`: escluso esplicitamente dal ciclo di lavoro considerato

| Artifact / requisito ufficiale | Fonte | Stato MediFlow | Severita gap | Tracking | Note |
| --- | --- | --- | --- | --- | --- |
| Servizi GTW REST: validazione, validazione FHIR, pubblicazione, sostituzione, eliminazione, update metadati, stato transazioni | `doc/integrazione-gateway` ver. 2.17 + `openapi/gateway/swagger_gtw.yaml` | `Missing` | `High` | `WUL-41`, `WUL-34` | La baseline non chiama GTW; espone solo API locali e controlli preliminari interni. |
| Notifica e recupero stato transazione GTW | `doc/integrazione-gateway` ver. 2.17 | `Missing` | `High` | `WUL-41` | Nessun adapter né persistenza di tracce o stati GTW. |
| Provisioning certificati: profili, create/download/renew/revoke/recover | `doc/provisioning/api-rest-provisioning.md` (private) + `doc/provisioning/openapi.yaml` | `Missing` | `High` | `WUL-41` | Nessun client di provisioning né gestione del ciclo di vita dei certificati nella repository. |
| Autenticazione ufficiale: doppio certificato `AUTH/SIGN`, `Authorization: Bearer`, `FSE-JWT-Provisioning`, JWT per-call | `README.md` `it-fse-support`, `doc/provisioning` sez. `2.2-2.3` | `Missing` | `High` | `WUL-41` | Lo stack auth corrente copre solo sessione locale e token `/api/v1`, non il modello ministeriale. |
| Validazione CDA con asset ministeriali `XSD + Schematron` | `it-fse-catalogs` (`schema`, `schematron`) + `doc/accreditamento` | `Partial` | `High` | `WUL-28`, `WUL-41` | Esiste validazione locale pilota, ma non su CDA reali e non con asset ufficiali. |
| Dizionari e cataloghi terminologici ufficiali gateway | `it-fse-catalogs` | `Partial` | `Medium` | `WUL-27`, `WUL-41` | MediFlow espone registry/lookup locali pilota, ma non sincronizza ancora i cataloghi ufficiali GTW. |
| Governance contrattuale versionata | `openapi/gateway`, `doc/provisioning/openapi.yaml` | `Partial` | `Medium` | `WUL-12`, `WUL-13`, `WUL-34` | La governance OpenAPI esiste per `/api/v1`, non ancora come ponte esplicito verso il baseline GTW. |
| Processo di accreditamento, test case, checklist e report | `doc/accreditamento` | `Missing` | `Medium` | `WUL-41` | Nessun harness/report `report-checklist.xlsx` o procedura operativa in repo. |
| Tooling ufficiale di supporto (`it-fse-gtw-tools`, container GTW) | `README.md` `it-fse-support` | `Out` | `Low` | `WUL-41` | Utile per una fase successiva; non blocca il filone locale/terminology corrente. |

<a id="gaps-gia-convertiti-in-backlog-operativo"></a>

## Lacune già tradotte in attività operative

Parte del lavoro necessario è già assegnata a issue esistenti e non va
duplicata:

- `WUL-27`: registry locale sistemi/versioni per terminologie
- `WUL-28`: validazione documentale FSE profilo-driven
- `WUL-12` e `WUL-13`: governance e pubblicazione della baseline OpenAPI locale
- `WUL-41`: macro contenitore per i gap GTW/FSE ancora fuori thin slice

Le lacune residue restano invece in `WUL-41` finché non sia approvato un
intervento dedicato e circoscritto. Riguardano:

- stack `mTLS + JWT + certificati AUTH/SIGN`
- client provisioning certificati
- client servizi GTW e stato transazioni
- procedura/harness di accreditamento

## Ordine consigliato di esecuzione

Le dipendenze suggeriscono questo ordine: prima completare la base locale,
poi definire trasporto, autenticazione e certificati, senza anticipare le
chiamate reali ai servizi.

1. Chiudere `WUL-27` e `WUL-28` come base locale minima.
2. Definire un intervento `transport/auth` per la baseline ministeriale.
3. Definire un intervento `provisioning` per i certificati.
4. Solo dopo introdurre le chiamate GTW reali di validazione e pubblicazione.
5. Rinviare accreditamento e harness ufficiale a quando i primi tre punti siano effettivamente disponibili.

## Regola di aggiornamento

Prima di aprire un nuovo intervento GTW/FSE bisogna ricontrollare le fonti
ufficiali elencate sopra e aggiornare la matrice se siano cambiati una
versione, un endpoint o un requisito di autenticazione. Il nuovo lavoro deve
essere collegato a `WUL-41` oppure a una sua sotto-issue esplicita, perché il
percorso resti tracciabile.

Questa nota è coerente con:

- [docs/adr/0006-terminology-plugin-and-fse-profiles.md](./adr/0006-terminology-plugin-and-fse-profiles.md)
- [docs/FSE2-terminology-roadmap.md](./FSE2-terminology-roadmap.md)

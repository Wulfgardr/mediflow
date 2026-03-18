<!-- Codex: created 2026-03-18 -->
# Allineamento baseline GTW FSE ufficiale

## Scopo

Questa nota fissa la baseline ufficiale `it-fse-support` da usare come riferimento
per il dialogo GTW/FSE e misura lo scarto reale di MediFlow.

Non sostituisce le specifiche ministeriali e non introduce qui integrazione GTW
di produzione: serve a evitare drift tecnico e a dare un ordine di esecuzione
tracciabile al filone `WUL-41`.

## Fonti ufficiali monitorate

Verifica manuale eseguita il `2026-03-18` sulle seguenti fonti:

- [`it-fse-support` README](https://github.com/ministero-salute/it-fse-support/blob/main/README.md)
- [`doc/integrazione-gateway` ver. 2.17](https://github.com/ministero-salute/it-fse-support/blob/main/doc/integrazione-gateway/README.md)
- [`openapi/gateway`](https://github.com/ministero-salute/it-fse-support/tree/main/openapi/gateway)
- [`doc/provisioning` + OpenAPI provisioning](https://github.com/ministero-salute/it-fse-support/tree/main/doc/provisioning)
- [`doc/accreditamento`](https://github.com/ministero-salute/it-fse-support/tree/main/doc/accreditamento)
- [`it-fse-catalogs` schema/schematron/dizionari](https://github.com/ministero-salute/it-fse-catalogs)

## Baseline MediFlow oggi

MediFlow oggi copre solo una parte locale e preparatoria del percorso FSE:

- terminologie pilota locali via `/api/v1/terminology/*`
- validazione documentale locale pre-export su subset clinici pilota
- governance spec-first del contratto locale `/api/v1`

MediFlow oggi **non** implementa ancora:

- client GTW ministeriale
- provisioning certificati
- trasporto `mTLS + JWT` conforme al baseline ufficiale
- validazione CDA con asset ministeriali `XSD + Schematron`
- workflow di accreditamento e reporting verso l’ecosistema ufficiale

## Matrice allineamento

Legenda stato:

- `Covered`: presente e coerente col baseline ufficiale
- `Partial`: esiste un thin slice locale ma non copre ancora il baseline ministeriale
- `Missing`: gap reale, nessuna implementazione utilizzabile
- `Out`: esplicitamente fuori scope per il ciclo corrente

| Artifact / requisito ufficiale | Fonte | Stato MediFlow | Severita gap | Tracking | Note |
| --- | --- | --- | --- | --- | --- |
| Servizi GTW REST: validazione, validazione FHIR, pubblicazione, sostituzione, eliminazione, update metadati, stato transazioni | `doc/integrazione-gateway` ver. 2.17 + `openapi/gateway/swagger_gtw.yaml` | `Missing` | `High` | `WUL-41`, `WUL-34` | MediFlow oggi non chiama GTW; espone solo API locali e pre-check interni. |
| Notifica e recupero stato transazione GTW | `doc/integrazione-gateway` ver. 2.17 | `Missing` | `High` | `WUL-41` | Nessun adapter o persistenza trace/status GTW. |
| Provisioning certificati: profili, create/download/renew/revoke/recover | `doc/provisioning/api-rest-provisioning.md` + `doc/provisioning/openapi.yaml` | `Missing` | `High` | `WUL-41` | Nessun client provisioning o lifecycle certificati nel repo. |
| Autenticazione ufficiale: doppio certificato `AUTH/SIGN`, `Authorization: Bearer`, `FSE-JWT-Provisioning`, JWT per-call | `README.md` `it-fse-support`, `doc/provisioning` sez. `2.2-2.3` | `Missing` | `High` | `WUL-41` | Lo stack auth corrente copre solo sessione locale e token `/api/v1`, non il modello ministeriale. |
| Validazione CDA con asset ministeriali `XSD + Schematron` | `it-fse-catalogs` (`schema`, `schematron`) + `doc/accreditamento` | `Partial` | `High` | `WUL-28`, `WUL-41` | Esiste validazione locale pilota, ma non su CDA reali e non con asset ufficiali. |
| Dizionari e cataloghi terminologici ufficiali gateway | `it-fse-catalogs` | `Partial` | `Medium` | `WUL-27`, `WUL-41` | MediFlow espone registry/lookup locali pilota, ma non sincronizza ancora i cataloghi ufficiali GTW. |
| Governance contrattuale versionata | `openapi/gateway`, `doc/provisioning/openapi.yaml` | `Partial` | `Medium` | `WUL-12`, `WUL-13`, `WUL-34` | La governance OpenAPI esiste per `/api/v1`, non ancora come ponte esplicito verso il baseline GTW. |
| Processo di accreditamento, test case, checklist e report | `doc/accreditamento` | `Missing` | `Medium` | `WUL-41` | Nessun harness/report `report-checklist.xlsx` o procedura operativa in repo. |
| Tooling ufficiale di supporto (`it-fse-gtw-tools`, container GTW) | `README.md` `it-fse-support` | `Out` | `Low` | `WUL-41` | Utile per una fase successiva; non blocca il filone locale/terminology corrente. |

## Gaps gia convertiti in backlog operativo

I gap gia coperti da issue esistenti, senza duplicazione:

- `WUL-27`: registry locale sistemi/versioni per terminologie
- `WUL-28`: validazione documentale FSE profilo-driven
- `WUL-12` e `WUL-13`: governance e pubblicazione della baseline OpenAPI locale
- `WUL-41`: macro contenitore per i gap GTW/FSE ancora fuori thin slice

I gap residui che restano volutamente parcheggiati dentro `WUL-41`, finche non viene
approvata una thin slice dedicata, sono:

- stack `mTLS + JWT + certificati AUTH/SIGN`
- client provisioning certificati
- client servizi GTW e stato transazioni
- procedura/harness di accreditamento

## Ordine consigliato di esecuzione

1. Chiudere `WUL-27` e `WUL-28` come base locale minima.
2. Definire thin slice `transport/auth` per il baseline ministeriale.
3. Definire thin slice `provisioning` certificati.
4. Solo dopo introdurre le chiamate GTW reali di validazione/pubblicazione.
5. Rinviare accreditamento e harness ufficiale a quando i primi tre punti esistono davvero.

## Regola di aggiornamento

Prima di aprire una slice GTW/FSE nuova bisogna:

1. ricontrollare le fonti ufficiali sopra
2. aggiornare questa matrice se cambia una versione, un endpoint o un requisito auth
3. collegare la nuova slice a `WUL-41` oppure a un child issue esplicito

Questa nota e coerente con:

- [docs/adr/0006-terminology-plugin-and-fse-profiles.md](./adr/0006-terminology-plugin-and-fse-profiles.md)
- [docs/FSE2-terminology-roadmap.md](./FSE2-terminology-roadmap.md)
- [PLANS.md](../PLANS.md)

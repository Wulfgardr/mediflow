# Configurazione ICD-11 WHO

MediFlow 0.8.5 consulta ICD-11 tramite un Application Service server-only verso
l'API ufficiale WHO v2/MMS. Il vecchio container locale e la porta `8888` non
fanno piu parte del percorso applicativo.

Riferimenti correlati:

- [ADR 0115](./adr/0115-icd11-who-reference-data-adapter.md)
- [Stato del sistema](./STATE_OF_THE_SYSTEM.md)
- [Architettura](../ARCHITECTURE.md)

## Default sicuro

Il servizio e disattivato per default. In questo stato MediFlow non legge le
variabili delle credenziali e non effettua richieste WHO. Non esiste fallback a
ICD-9, a JSON WHO grezzo o a un container locale.

La diagnostica espone soltanto questi stati governati:

- `disabled`: feature non abilitata;
- `credentials_absent`: credenziali server-side assenti o non valide;
- `offline`: egress WHO non autorizzato;
- `configured`: configurazione presente, disponibilita non ancora osservata;
- `available`: almeno una ricerca e riuscita sul binding fissato;
- `unavailable`: una ricerca bounded e fallita.

`configured` non equivale a `available`.

## Configurazione server-side

Sono richiesti un client OAuth ufficiale WHO e un processo server MediFlow
avviato con queste variabili:

| Variabile | Valore |
| --- | --- |
| `MEDIFLOW_ICD_WHO_ENABLED` | `1` per abilitare il servizio |
| `MEDIFLOW_ICD_WHO_NETWORK` | `online` per autorizzare l'egress |
| `MEDIFLOW_ICD_WHO_CLIENT_ID` | client ID ufficiale WHO |
| `MEDIFLOW_ICD_WHO_CLIENT_SECRET` | client secret ufficiale WHO |

Le credenziali devono essere iniettate dal supervisore del processo o dalla
sessione amministrativa locale. Non inserirle nel repository, in file `.env`
committati, nel browser, nelle impostazioni client o nei log.

Il binding 0.8.5 e fisso a release `2026-01`, linearizzazione `mms`, lingua
inglese e massimo 25 risultati. Query, risposta, timeout, cache e audit sono
bounded. L'audit conserva solo la receipt PHI-safe, mai query o descrizioni.

## Verifica

Accedi a MediFlow e apri **Impostazioni -> Diagnostica**. La superficie legge la
readiness senza inviare diagnosi sintetiche. Una ricerca reale parte soltanto da
un'azione esplicita dell'operatore nell'autocomplete ICD-11.

I test di repository usano trasporti e credenziali sintetici. Non costituiscono
una prova live dell'account WHO.

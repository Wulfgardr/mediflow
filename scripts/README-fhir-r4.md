# Gate Web FHIR R4 base

`npm run check:fhir-r4 -- --falsify` genera 22 Bundle sintetici con
`buildFhirBundleFromRecords`, li serializza e avvia il validatore ufficiale
HL7 6.9.12 una sola volta per il corpus e le tre mutazioni semantiche.
Non importa loader, route o servizi database. Le fixture sono codice in
`fhir-r4-corpus.ts`, non golden FHIR scritti a mano. `manifest.txt` elenca
producer, artefatti e rami coperti; i report identificano revisione, hash dei
mapper e dei Bundle, versioni e conteggi. La struttura `producers[]` consente
producer ulteriori, ma questa unità verifica solo Web.

```sh
MEDIFLOW_DATA_DIR=$(mktemp -d) npm run test:fhir-r4
npm run check:fhir-r4 -- --falsify
```

Serve Java 17. In locale è possibile dichiarare un confronto con un JDK già
installato tramite `MEDIFLOW_FHIR_ALLOW_JAVA_MISMATCH=1`: il report registra
versione e override. In CI un mismatch è sempre rifiutato, anche con override.
Non è necessaria una build Next né una copia di database.

Il runner scarica solo JAR e archivi del lock in
`~/.cache/mediflow-fhir-validator/artifacts`, verifica SHA-256 tramite
`describeLockedArtifacts`/`verifyValidatorCache`, quindi prepara una cache
package nuova per ogni run sotto la stessa radice. Verifica anche nome e
versione nei `package.json`. Un artefatto presente con hash errato viene
rifiutato; non viene riscaricato silenziosamente. Il download non riceve
Bundle o dati paziente. Non si riusano cache FHIR personali o directory
package estratte da run precedenti.

Durante la validazione si applicano `fhir-settings.json` del lock, server
assenti, `-tx n/a`, `-txCache n/a` e le altre opzioni fissate. Su macOS il
processo è avviato con `sandbox-exec` e `(deny network*)`; su Linux il job
usa `sudo -n unshare --net` e `setpriv` per ripristinare UID/GID originali.
Il runner locale non richiede root su macOS. Linux richiede questi strumenti
e l'autorizzazione già disponibile nel runner GitHub; nessuna modifica a
firewall, DNS o rete host. Su piattaforme diverse il gate si arresta.
Due tentativi TCP IPv4/IPv6 nello stesso isolamento della JVM devono ottenere
un errore di accesso o di rete negata, non un timeout o connection refused.
`network-denial.json` conserva il risultato. Le dipendenze non fissate non
possono essere acquisite durante questa fase.

Ogni file deve avere esattamente un `OperationOutcome`, identificato tramite
l'estensione ufficiale `operationoutcome-file`. Output assente, malformato,
duplicato o riferito a file estranei è un errore del tool. Il codice di uscita
non sostituisce l'analisi delle issue. Si distinguono:

- exit 0: `PASS` oppure `PASS_FROZEN_BASELINE`;
- exit 1: `SEMANTIC_REJECTION`, issue nuove o baseline da ridurre;
- exit 2: `TOOL_ERROR`, integrità, Java, sandbox, esecuzione, output o
  aspettativa di falsificazione non dimostrata.

Gli output restano in `tmp-fhir-r4-*/`: corpus JSON, manifest, log ufficiale,
OperationOutcome aggregati, prova rete e report JSON/testo con tempi di
acquisizione, preparazione, JVM e totale. La CI li conserva per 14 giorni.

## Baseline congelata e limiti

Sul mapper di `034aad5b9` il corpus produce **1 errore e 63 warning**:

| Severità / identificativo | Occorrenze | Motivo |
| --- | ---: | --- |
| error `Type_Specific_Checks_DT_Integer_Valid` | 1 | `scale-fraction`: `valueInteger: 1.5` non è un intero FHIR. |
| warning `DomainResource#dom-6` | 47 | Narrative assenti nelle risorse. |
| warning `All_observations_should_have_a_performer` | 7 | Il mapper non espone performer. |
| warning `Terminology_TX_Code_ValueSet_Ext` | 5 | Relazione caregiver e interpretazioni scala solo testuali. |
| warning `UNKNOWN_CODESYSTEM` | 2 | ICD-9 legacy e ICD-11 non risolti nella cache offline. |
| warning `Error_validating_code_running_without_terminology_services` | 2 | UCUM non verificato senza servizi terminologici. |

`r4-warning-baseline.v1.json` e `r4-error-baseline.v1.json` propongono queste
sole eccezioni alla review della PR. Ogni voce fissa artefatto, severità,
identificativo ufficiale, percorso, messaggio, numero di occorrenze e motivo.
Qualsiasi variazione o aumento blocca; una voce scomparsa blocca con
`REMOVE_FROM_BASELINE`. Nessun comando aggiorna automaticamente le baseline.
L'eccezione agli errori è transitoria e distinta dai warning: questa PR non
corregge né nasconde il mapper. Il coordinatore decide le unità di correzione.

Il linguaggio ammesso per un corpus senza errori è «validato contro FHIR R4
4.0.1 base, terminologia non verificata offline». Il corpus corrente **non**
ha questo esito: passa solo il confronto con la baseline congelata. Il report
non attribuisce validità terminologica, elenca binding non verificati e
licenze dichiarate dai package. Nessun artefatto esterno al corpus eredita
la prova; nessuna parità Swift, IPS, It-Core, CDA o accettazione FSE/terzi è
attestata.

## Falsificazioni obbligatorie

| Mutazione | Esito atteso |
| --- | --- |
| `Patient.gender = not-a-gender` | Errori ufficiali sul binding gender, rifiuto semantico. |
| URN interna inesistente | Warning ufficiale `Bundle_BUNDLE_Not_Local`, fuori baseline, rifiuto semantico. |
| Primo byte JAR invertito | Hash errato prima della JVM. Tutti gli altri artefatti restano integri. |
| Primo byte package R4 invertito | Hash errato prima della JVM. Tutti gli altri artefatti restano integri. |
| Nuovo contatto con relazione solo testuale | Warning ufficiale `Terminology_TX_Code_ValueSet_Ext` su nuovo percorso del Bundle `diagnosis-id`, fuori baseline. |
| `collection` con claim IPS | `UNLOCKED_PROFILE_CLAIM` prima della JVM; IPS non è nel lock e non viene scaricato. |

Le prime tre mutazioni semantiche vengono validate nella stessa JVM del
corpus; le prove d'integrità usano copie temporanee e la stessa funzione di
preflight chiamata prima dell'avvio reale. La policy profili visita tutte le
risorse annidate e ammette solo la rispettiva StructureDefinition R4 base.
Non prova conformità IPS: rifiuta l'affermazione non coperta dal lock.

Implementazione CLI e formato degli output verificati sul
[sorgente ufficiale 6.9.12](https://github.com/hapifhir/org.hl7.fhir.core/tree/73c432b5f43ddbce979978a760ec4aa81e929094).

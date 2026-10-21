# Gate Web FHIR R4 base

`npm run check:fhir-r4 -- --falsify` genera 18 Bundle sintetici con
`buildFhirBundleFromRecords`, li serializza e avvia il validatore ufficiale
HL7 6.9.12 una sola volta per il corpus e le tre mutazioni semantiche.
Non importa loader, route o servizi database. Le fixture sono codice in
`fhir-r4-corpus.ts`, non golden FHIR scritti a mano. `manifest.txt` elenca
producer, artefatti e rami coperti; i report identificano revisione, hash dei
mapper e dei Bundle, versioni e conteggi. La struttura `producers[]` consente
producer ulteriori, ma questa unità verifica solo Web.

```sh
MEDIFLOW_DATA_DIR=$(mktemp -d) npm run test:fhir-r4
npm run check:fhir-r4 -- --falsify --out /percorso/nuovo-run
```

`test:fhir-r4` include le regressioni dei consumer: esegue i veri handler
moduli/editor/share e il generatore Web con archivio sintetico e API browser
simulate. Verifica testo del toast, blocco di download/share e assenza di log
clinici; non è una prova GUI. Le tre mutazioni in memoria rimuovono il
precheck scale, anticipano `Number()` e accettano titoli vuoti: i test devono
fallire rispettivamente in 24, 6 e 9 casi, coprendo tutti e tre i percorsi.
Il codice sul disco resta invariato. Esecuzione separata delle mutazioni:

```sh
node --test scripts/fhir-scale-export-falsification.test.mjs
```

Serve Java 17. In locale è possibile dichiarare un confronto con un JDK già
installato tramite `MEDIFLOW_FHIR_ALLOW_JAVA_MISMATCH=1`: il report registra
versione e override. In CI un mismatch è sempre rifiutato, anche con override.
Non è necessaria una build Next né una copia di database.

Il runner scarica solo JAR e archivi del lock in
`~/.cache/mediflow-fhir-validator/artifacts`, verifica SHA-256 tramite
`describeLockedArtifacts`/`verifyValidatorCache`, quindi copia tutti gli artefatti in uno snapshot privato del run, senza hard
link. Ogni sorgente è aperta con `O_NOFOLLOW`: SHA-256 viene calcolato sugli
stessi blocchi copiati, nella stessa passata. Lo snapshot ha permessi `0700`
e i file `0400`. Tar e JVM consumano solo questi percorsi; dopo la verifica
dello snapshot la cache condivisa non viene più aperta. Una sostituzione
successiva nella cache non cambia i byte utilizzati. La cache package
estratta e la home sono nuove per ogni run sotto la stessa radice. Verifica anche nome e
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
Nel namespace Linux privo di indirizzi IPv6 è ammesso `EADDRNOTAVAIL` solo
per la prova IPv6; non è ammesso per IPv4 o nel sandbox macOS.
`network-denial.json` conserva il risultato. Le dipendenze non fissate non
possono essere acquisite durante questa fase.

Il wrapper isolato avvia il validatore in modo asincrono in un gruppo di
processi proprio. Alla deadline di 600 s, a SIGINT/SIGTERM o alla chiusura
del canale stdin del runner, termina l'intero gruppo con SIGTERM, concede
2 s e invia SIGKILL se necessario. Attende l'uscita del figlio e la scomparsa
del gruppo, anche quando il figlio termina lasciando discendenti attivi.
Il runner attende la chiusura del wrapper prima di pulire home e snapshot;
la pulizia avviene anche se la scrittura dei report fallisce.

Ogni file deve avere esattamente un `OperationOutcome`, identificato tramite
l'estensione ufficiale `operationoutcome-file`. Output assente, malformato,
duplicato o riferito a file estranei è un errore del tool. Il codice di uscita
non sostituisce l'analisi delle issue. Si distinguono:

- exit 0: `PASS` oppure `PASS_FROZEN_BASELINE`;
- exit 1: `SEMANTIC_REJECTION`, issue nuove o baseline da ridurre;
- exit 2: `TOOL_ERROR`, integrità, Java, sandbox, esecuzione, output o
  aspettativa di falsificazione non dimostrata.

`--out <directory>` sceglie una directory nuova ed esclusiva del run: se esiste
già viene rifiutata, senza sovrascrivere report precedenti. Senza `--out` si
crea una directory unica `mediflow-fhir-r4-*` nel temporaneo di sistema,
fuori dalla repository. Il percorso viene stampato all'avvio. I report sono
conservati: corpus JSON, manifest, log ufficiale, OperationOutcome aggregati,
prova rete e report JSON/testo con tempi di acquisizione (snapshot incluso),
preparazione, JVM e totale. La CI passa un percorso in `runner.temp` legato a
run ID e tentativo; raccoglie esattamente quel percorso per 14 giorni.

## Baseline e limiti

Sul mapper iniziale di `ef673f8d3` il corpus di 22 Bundle produceva **1 errore
e 63 warning**, con stato `PASS_FROZEN_BASELINE`: `scale-fraction` emetteva
`valueInteger: 1.5`. I punteggi delle cinque scale attive sono somme di item
interi; MMSE usa il totale grezzo senza correzione normativa e GDS-15 non
applica proporzionamenti. La frazione era quindi un dato invalido.

Il mapper ora blocca l'intero export per punteggi vuoti, non numerici, non
finiti, frazionari o fuori dall'intervallo signed 32-bit. `FhirScaleScoreError`
(`INVALID_SCALE_SCORE`, severità `error`) protegge il mapper;
`prepareFhirBundleFromRecords` valida lo stesso snapshot e solleva un
`FhirExportPrecheckError` tipizzato prima della conferma dei warning diagnostici.
Nessuna Observation o Bundle parziale viene restituita. Zero ed estremi sono
validi; le stringhe numeriche intere restano compatibili con gli input legacy.
Sono accettati anche zeri iniziali e spazi esterni (`"03"`, `" 3 "`):
il testo decimale viene verificato con `BigInt` prima della conversione.
Frazioni e notazione esponenziale sono rifiutate. Non si arrotonda né si tronca.
Anche un titolo assente, vuoto o composto da soli spazi blocca l’intero export
(`INVALID_SCALE_TITLE`). La UI risolve titolo e data dall’ID locale e mostra
«Esportazione bloccata» con l’indicazione di correggere o eliminare la scala;
nessun testo clinico è incluso nell’errore tecnico.
Le fixture `scale-fraction`, `scale-empty`,
`scale-invalid` e `scale-nonfinite` sono casi bloccanti nei test del precheck,
non fanno parte del corpus valido.

Il corpus corrente di 18 Bundle richiede **zero error/fatal**, stato `PASS`
e **52 warning** espliciti:

| Severità / identificativo | Occorrenze | Motivo |
| --- | ---: | --- |
| warning `DomainResource#dom-6` | 38 | Narrative assenti nelle risorse. |
| warning `All_observations_should_have_a_performer` | 6 | Il mapper non espone performer. |
| warning `Terminology_TX_Code_ValueSet_Ext` | 4 | Relazione caregiver e interpretazioni scala solo testuali. |
| warning `UNKNOWN_CODESYSTEM` | 2 | ICD-9 legacy e ICD-11 non risolti nella cache offline. |
| warning `Error_validating_code_running_without_terminology_services` | 2 | UCUM non verificato senza servizi terminologici. |

`r4-error-baseline.v1.json` ha la lista delle eccezioni vuota e modalità
`strict`. `r4-warning-baseline.v1.json` conserva soltanto i warning degli
artefatti ancora presenti. Ogni voce fissa artefatto, severità, identificativo
ufficiale, percorso, messaggio, numero di occorrenze e motivo. Qualsiasi
variazione o aumento blocca; una voce scomparsa blocca con
`REMOVE_FROM_BASELINE`. Nessun comando aggiorna automaticamente le baseline.

Il linguaggio ammesso per il corpus senza errori è «validato contro FHIR R4
4.0.1 base, terminologia non verificata offline». Il report non attribuisce
validità terminologica, elenca binding non verificati e licenze dichiarate
dai package. Nessun artefatto esterno al corpus eredita la prova; nessuna
parità Swift, IPS, It-Core, CDA o accettazione FSE/terzi è attestata. La prova
locale con override Java 25 resta non canonica; la CI usa Java 17.

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
snapshot chiamata prima dell'avvio reale. La policy profili visita tutte le
risorse annidate e ammette solo la rispettiva StructureDefinition R4 base.
Non prova conformità IPS: rifiuta l'affermazione non coperta dal lock.

I test mirati sostituiscono atomicamente JAR e package nella cache dopo la
verifica: il vero tar estrae ancora il package verificato e un sostituto
innocuo della JVM legge il JAR sintetico dal percorso dell'invocazione reale,
senza eseguirlo. Un figlio sintetico e un suo discendente nel sandbox reale
non sopravvivono al timeout e non scrivono il marker ritardato. Altri test
coprono cancellazione, escalation SIGKILL, output esclusivo e pulizia dopo
un errore di scrittura dei report. Le stesse prove usano su macOS
`sandbox-exec` e in CI Linux `unshare`; la CI Java 17 resta la prova
canonica del validatore ufficiale.

Implementazione CLI e formato degli output verificati sul
[sorgente ufficiale 6.9.12](https://github.com/hapifhir/org.hl7.fhir.core/tree/73c432b5f43ddbce979978a760ec4aa81e929094).

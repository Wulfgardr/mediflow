# ADR 0166: ATHENA opzionale e adattamento per Intelligence Fabric

Date: 2026-10-26
Updated: 2026-10-30
Status: Proposed

## Cosa ti chiedo di decidere

**Limite d'uso prima della scelta.** Codice upstream e model card dichiarano
MIT, che consente distribuzione conservando copyright e licenza. README e
model card dichiarano però un artefatto di ricerca, non un dispositivo medico,
e vietano l'uso per la cura diretta dei pazienti. Non sono la stessa cosa:
la licenza non autorizza l'impiego clinico. La provenienza completa del Q4
locale resta aperta; non se ne propone la redistribuzione prima di verificarla.
Fonti immutabili in fondo. Questa proposta non è un'ammissione clinica.

| Decisione di Leonardo | Raccomandazione | Alternativa |
| --- | --- | --- |
| Quale confine dare ad ATHENA? | Modulo di ricerca opzionale, con originale fissato e adattamento MediFlow distinto. Nessun requisito ATHENA per avviare o usare il nucleo. | Rinviare il modulo, lasciando Treatment Reasoning non disponibile. Non importare l'agente completo nel nucleo. |
| Quale adattamento sperimentare? | Due passi: risposta libera con pesi ATHENA, poi estrazione separata e validazione rigorosa. Prima estrazione deterministica; un secondo modello solo se nominato e approvato. | Generazione diretta vincolata da grammatica, da qualificare separatamente. Nessuna delle due è oggi dimostrata. |
| Come trattare 0.9.1 e prova successiva? | Tenere I-3/I-3b aperte, approvare separatamente il run locale limitato descritto sotto e decidere sui risultati. | Rinviare formalmente la funzione nel contratto di release. La sola indisponibilità non soddisfa I-3. |

Accettare il disegno non autorizza il run, una distribuzione o una nuova sede
remota. Decide Leonardo; questa PR resta in bozza e non va unita a main.

## Stato verificato e ipotesi

Base di lettura MediFlow: `973b19dbe6f91acd3141e96deda74ead9dfcf309`.
[I-3/I-3b/I-7](../releases/0.9.1-contract.md) restano il contratto vigente.
Il builder [Fabric](../../lib/ai-providers/fabric/treatment-reasoning-athena-method.ts)
chiede JSON; l'[executor](../../lib/ai-providers/fabric/treatment-reasoning-athena-execution.ts)
lo passa al [validatore V2](../../lib/ai-providers/fabric/treatment-reasoning-athena-output-contract-v2.ts):
root esatta `schemaVersion, task, summary, data, sourceBindings`, binding per
summary, recommendation, ogni reasoning e caveat, oltre ai riferimenti di
keyEvidence, safetyFlags e suggestedActions. V2 è il validatore privato;
il contratto applicativo resta `mediflow.treatment_reasoning.v1`.

Letti i rapporti `misura-i2-i3.md`, `misura-i2-i3-giro2.md` e la scheda
`revisione-leonardo.md` del dossier di misura del 30 ottobre, con fonti e
output sintetici affiancati. La [PR #741](https://github.com/Wulfgardr/mediflow/pull/741)
li collega ai rapporti pubblici: [primo giro][misura1] e [secondo giro][misura2]
alla sua revisione fissata. Il prompt corretto è nel commit
`92baba4a900425f8b1a612d8a87d8be1ecdd031e` di quella PR, ancora aperta alla
lettura; non è il prompt della base main sopra indicata.

In entrambi i giri i cinque positivi per ciascun percorso sono rifiutati;
10 soglie su 18 falliscono. Nel secondo il primo testo copia le descrizioni
dell'esempio, viola i binding e termina con JSON malformato. Nel primo,
la scheda negazione mostra una confusione fra data della nota e data
dell'evento, con rischi aggiunti senza riscontro. Migliorare la forma non
risolve questi errori di contenuto.

**Ipotesi da verificare:** chiedere insieme ragionamento e JSON clinico chiuso
può essere inadatto a questi pesi e a questa configurazione. Upstream usa una
risposta libera e un'estrazione MCQ separata. Questo rende plausibile provare
due passi, ma non dimostra come siano stati coperti i formati nell'addestramento,
né isola prompt, lingua, Q4, template, decoding e assenza dei tool come cause.
Nessuna nuova inferenza è stata eseguita per questo ADR.

## Confini proposti

| Parte | Identità, responsabilità e limite |
| --- | --- |
| ATHENA originale | Repository `[U]` al commit `d5bbccb06ceaf0b37bd6c9808bca1f1e9b07afdc`, pacchetto `athena-r1` 1.0.0. Conservare sorgenti e licenza immutati. `agent.py` fissa `_STAGE1_PROMPT_TEMPLATE`; `_prompts.py` fissa `PROMPT_MULTI_STEP`. L'agente esegue ragionamento iterativo, tool e risposta libera. `map_to_option` è estrazione di una lettera per MCQ, con ATHENA o lettore GPT separato, non un convertitore del contratto MediFlow. |
| Pesi e derivati | Model card `[M]` di `mims-harvard/ATHENA-R1-Qwen3-8B`, snapshot `acacc6b08e341aaf03c9639097255013ac65ebf2` verificato il 30 ottobre. Questo snapshot non è dimostrato come origine del Q4 misurato: `model.safetensors` SHA-256 `e27c0b3dd5f05a738d1317197951caedebe39dcf890efad8e807bb3993e7bdea`, 4.607.835.164 byte. Servono snapshot di origine, ricetta e versioni di conversione, hash di tutti i file e licenze della filiera prima di redistribuirlo. Q4 non è il peso originale immutato. |
| Profilo MediFlow con pesi ATHENA | Oggi una generazione MLX sulle sole fonti host, senza ToolUniverse o ricerca. Non è l'agente originale. Il candidato conserva il riferimento canonico senza modificarlo; versiona separatamente domanda, fonti, template e ogni deviazione, inclusa la disabilitazione dei tool. Non dichiara di riprodurre Stage 1 originale se ne omette il ciclo. Tool call inattese negano l'esito, senza eseguirle o simulare risultati. |
| Adattamento Fabric | Projection minimizzata e corrente, scelta ammessa, estrazione, V2, provenienza host, lease e revisione. Il ragionatore non seleziona pazienti, fonti, endpoint o autorità. `toolsUsed` resta vuoto se nessun tool è eseguito. Nessuna scrittura clinica nasce dal modulo. |

Upstream offre anche `generate_report()`, che restituisce un report Markdown
sintetizzato dalla conversazione e dai risultati dei tool. Non è JSON V2;
non fornisce da solo i binding MediFlow e non va rinominato come parser.
Le prestazioni pubblicate dell'agente con tool non qualificano il profilo
MediFlow senza tool, né il suo estrattore.

L'installazione proposta è separata e volontaria: importare un pacchetto
locale con manifest di codice, pesi, prompt, tokenizer/template, runtime,
licenze e digest; verificarne integrità e compatibilità; poi ammettere la
specifica configurazione nel catalogo. Nessun download durante una richiesta.
Il nucleo mantiene contratti e validazione in-house ([ADR 0070](./0070-in-house-first-for-buildable-logic.md));
non richiede pacchetti Python, pesi o servizi ATHENA per build, avvio o
attività cliniche ordinarie. L'isolamento del pacchetto è un requisito da
implementare e provare, non una proprietà consegnata da questo ADR.

Per rimuoverlo: disabilitare la scelta, revocare le operazioni pendenti,
impedire pubblicazioni tardive, arrestare e verificare i soli processi
posseduti, quindi rimuovere solo gli artefatti del pacchetto non condivisi.
Conservare cartelle cliniche, ricevute e storico. Assenza, rimozione, hash
errato o risorse insufficienti producono disponibilità negata con motivo;
nessuna sostituzione silenziosa di modello o sede.

MediFlow deve restare usabile sui Mac da M1 incluso quando ATHENA non è
installabile o ammesso. Chip, RAM, OS e runtime vanno verificati insieme:
4,634 GiB di picco RSS campionato su M4 Max/36 GB non sono un minimo hardware,
non misurano la memoria GPU e non qualificano M1/8 GB. Il budget portabile
storico non è un minimo misurato. Macchine piccole possono dichiarare il
modulo non disponibile, senza servizi residenti obbligatori.

## Adattamento candidato e alternative

| Candidato | Prove disponibili e mancanti | Costo e rischio clinico |
| --- | --- | --- |
| **A. Risposta libera, poi estrazione separata** | Il disaccoppiamento esiste in upstream per MCQ; i due giri MediFlow motivano l'esperimento. Nessuna prova locale dimostra ancora estrazione V2 fedele o qualità del testo libero. | Un'inferenza se basta il mapper deterministico, due se serve un estrattore generativo; latenza e memoria da misurare per stadio. Un estrattore può perdere negazioni, omettere caveat o dare apparente supporto a una conclusione errata. |
| **B. JSON diretto con grammatica/schema nel decoder** | I run osservati erano richieste di formato nel prompt, non prove di grammatica. Il supporto effettivo del runner e dell'intero schema va verificato. Non basta un modo JSON generico. | Una generazione, ma costo di implementazione/decoding e compatibilità runtime. Può imporre sintassi e cardinalità; non verità, fonte pertinente o conservazione di soggetto e tempo. Può cambiare il ragionamento. |
| **C. Mantenere il prompt diretto o il profilo claims diagnostico** | Il diretto ha fallito i positivi misurati. Il mapper claims descritto nella versione precedente non prova qualità I-7; non è abilitato nella corsia ordinaria. | Minor costo di sviluppo, un'inferenza. Insistere sul formato senza nuove prove rischia di confondere parser valido e contenuto affidabile. Sospendere la funzione è preferibile a promuoverlo senza qualifica. |

Si raccomanda A come esperimento, senza ripiego automatico fra A, B e C.
Il primo passo riceve soltanto domanda e fonti ammesse; produce una risposta
finale libera integra, distinta da trace interna, timeout e troncamento.
Il secondo riceve quella risposta e la stessa projection congelata, senza
ricerca, strumenti o nuovi fatti. Deve conservare il contenuto, non migliorarlo.

L'estrattore deterministico può copiare solo affermazioni, riferimenti e
associazioni esplicite; costruisce percorsi e struttura, non deduce fonti dal
lessico o dall'ordine. Se manca il contenuto obbligatorio o il legame alla
fonte, nega l'esito: non riempie i vuoti con testi standard. Un secondo modello
vincolato è un produttore distinto, con identità, prompt e budget propri;
può proporre solo copie di segmenti identificati e riferimenti già espliciti,
mai aggiungere una motivazione o attribuire retroattivamente una fonte.
Se questa disciplina rende impossibile V2, il risultato è un diniego,
non un invito ad allentare V2. La sua utilità è da misurare.

La validazione controlla forma, limiti, corrispondenza dei segmenti al testo
originale, riferimenti ammessi e binding esatti, poi V2 e lease corrente.
Non ripara JSON, non ricompone un ragionamento incompleto, non promuove un
output troncato e non inventa trace o provenienza. Una citazione esistente
può comunque non sostenere il claim: la validazione strutturale non lo prova.
La revisione I-7 confronta fonti, testo libero e struttura, comprese omissioni,
negazioni, incertezza, soggetto, tempi, flag e azioni. La proposta resta
soggetta alla revisione del medico; nessun apply automatico.

## Declinazione sull'intelligenza scelta

Il [catalogo generativo](../../lib/ai-providers/fabric/generative-catalog.ts)
nomina `treatment_reasoning`, schema v1 e `proposal_only`.
Il [catalogo delle scelte](../../lib/ai-providers/fabric/function-model-preferences.ts)
espone oggi ATHENA/MLX e, nel contratto negoziato, il portabile ATHENA;
[FunctionModelDispatch](../../lib/ai-providers/fabric/function-model-dispatch.ts)
risolve `modelOptionId` e `expectedCatalogRevision`. Non consente oggi di
scegliere un qualunque modello per questa funzione.

La proposta rende riutilizzabile la separazione ragionamento/estrazione,
non trasferisce l'addestramento ATHENA ad altri pesi. Cambiando il ragionatore
si nomina **Treatment Reasoning MediFlow con {modello}**, con prove proprie,
non ATHENA. Se cambia solo l'estrattore: **pesi ATHENA, adattamento MediFlow,
estrazione con {modello}**. Identità dei due passi e versione del metodo devono
comparire nella provenienza host; la ricevuta attuale non va falsificata per
farvi entrare una catena che non descrive.

Cambiare runner, quantizzazione, template o sede richiede nuova ammissione e
confronto: stesso nome non dimostra stessi risultati. Un'altra sede può essere
un'altra macchina locale o un provider remoto; nessuna scelta forza un ripiego.
Per il remoto restano ADR accettato, qualifica I-7 della cella, broker,
minimizzazione, consenso e controllo d'egresso, anche per il solo estrattore.
La credenziale o il login consumer non autorizzano l'invio. Non si estendono
scope o letture cross-paziente ([ADR 0074](./0074-network-cross-patient-read-boundary.md)).
Questo ADR non modifica i claim su cifratura e zero-knowledge, né sposta la
decrittazione; qualunque nuovo confine dati richiede una decisione distinta.

## Minimo 0.9.1 e prova da approvare

Per chiudere **I-3** servono ancora proposta reale sulla fixture con fonti e
revisione, artefatto/runner fissati e diniego in loro assenza. Per **I-3b**,
oltre all'ADR accettato, serve l'equivalenza misurata sul corpus rispetto alla
corsia locale, con contenuto utile e fedeltà alle fonti, non soli dinieghi
uguali. Il contratto attuale non permette di dichiararle chiuse col solo
modulo opzionale. I-7 resta necessario; questa PR consegna solo il disegno.

Non rientrano nella consegna attuale: nuovo executor a due passi, grammar
runtime, installer/rimozione verificati, agente completo con ToolUniverse,
qualifica M1/Windows/Linux o nuove celle remote. Il loro rinvio non modifica
da sé il contratto 0.9.1: Leonardo deve accettare un rinvio nel contratto
oppure mantenere aperti i criteri. Le prove Web/GPUI/chat e annullamento fisico
restano dovute dove richieste; terminazione naturale e revoca della publication
non provano l'arresto anticipato del processo.

**Run successivo proposto, non autorizzato da questo documento:** dopo
implementazione separata e revisione del candidato A, fissare commit, prompt,
pesi, template, decoding, estrattore e ricevuta di approvazione di Leonardo.
Prima fare un replay deterministico delle risposte già conservate: se non
sono estraibili senza ricostruzione, registrare il diniego e fermarsi.
L'eventuale confronto generativo successivo usa solo le due celle locali e
i nove casi approvati, una volta per caso e percorso: massimo 16 invocazioni
ATHENA, nessuna nel caso senza fonti. Un eventuale secondo modello richiede
identità e ulteriore limite espliciti nella nuova approvazione; non è incluso
implicitamente nel budget di 16. La baseline storica resta conservata, senza
rieseguirla per conferma e senza trasformare il nuovo prompt in equivalenza
per definizione.

Una inferenza alla volta, rete negata ai processi e figli con sonda verificata,
nessun download o API remota, soli dati sintetici, percorso di evidenze nuovo.
Proporre nuovamente i limiti precedenti, non ereditarne l'autorità: 30 GiB RSS
per processo modello, 420 s per invocazione, tetto di 10 minuti per caso,
arresto sotto 25 GiB liberi. Un errore ambientale o limite raggiunto interrompe
il run senza retry; nessuna ripetizione selettiva per qualità. Registrare
carico concorrente, tempi per stadio e totali, RSS campionato con i suoi
limiti, uscita di rete e fine dei PID. Perdita di contesto/revoca deve essere
attribuibile al relativo guard, non mascherata da un precedente errore JSON.

## Che cosa deve misurare il banco

Corpus e 18 soglie del [banco](../quality/athena/README.md) sono approvati dal
30 ottobre e restano invariati, inclusi i loro hash. Le prime cinque metriche
contano ancore nelle sole proposte accettate: con tutti i positivi negati,
0/5 significa nessuna proposta accettata, non una misura semantica del grezzo.
`equivalence=1` confronta istruzione ed esiti normalizzati, inclusi i dinieghi;
non dimostra equivalenza di contenuto. `inventedSources=0` è fissato dal codice
del banco: il PASS è strutturale, non una misura di fonti inventate nel testo.
`unconfirmedWrites=0` riguarda il banco senza writer; `unexpectedEgress=0`
riguarda la sandbox verificata, non ogni configurazione del prodotto.

Servono quindi indicatori aggiuntivi, separati e approvati prima del run:
quota di JSON valido e proposte accettate sui cinque positivi; valutazione
umana di **tutti** i testi grezzi ottenuti, anche rifiutati; claim non sostenuti,
fonti inventate e perdite di negazione/incertezza/soggetto/tempo; omissioni e
aggiunte fra testo libero ed estratto. Riportare conteggi e denominatori per
caso e cella; assenza di inferenza è non osservato, non zero errori. Il caso
malformato conserva separati output del modello e fault injection del banco.
Sono diagnostiche nuove, non una sostituzione retroattiva delle soglie né
un holdout cieco. Nessuna loro media compensa un criterio fallito.

## Fonti e continuità

- `[U]` [ATHENA originale][upstream]: [licenza MIT][license], [README][readme], [agent.py][agent], [_prompts.py][prompts], [versione del pacchetto][package]. Verificati in sola lettura il 30 ottobre 2026.
- `[M]` [Model card ATHENA-R1-Qwen3-8B][model], snapshot verificato; licenza dichiarata MIT e limite d'uso per ricerca. Non prova la filiera del Q4 locale.
- [Analisi MediFlow del 26 ottobre](../analysis/2026-10-26-athena-method.md): hash di config/tokenizer/template, runner osservato MLX-LM 0.32.2 e limiti di provenienza.
- [Versione precedente di ADR 0166][previous]: estrazione del builder a byte conservati e profilo claims solo diagnostico. Restano evidenze storiche; nessuna promozione di claims, parser legacy o venue remote è introdotta qui. Il presente aggiornamento propone il disegno successivo, senza cambiare il runtime.

[upstream]: https://github.com/mims-harvard/ATHENA/tree/d5bbccb06ceaf0b37bd6c9808bca1f1e9b07afdc
[license]: https://github.com/mims-harvard/ATHENA/blob/d5bbccb06ceaf0b37bd6c9808bca1f1e9b07afdc/LICENSE
[readme]: https://github.com/mims-harvard/ATHENA/blob/d5bbccb06ceaf0b37bd6c9808bca1f1e9b07afdc/README.md
[agent]: https://github.com/mims-harvard/ATHENA/blob/d5bbccb06ceaf0b37bd6c9808bca1f1e9b07afdc/src/athena_r1/agent.py
[prompts]: https://github.com/mims-harvard/ATHENA/blob/d5bbccb06ceaf0b37bd6c9808bca1f1e9b07afdc/src/athena_r1/_prompts.py
[package]: https://github.com/mims-harvard/ATHENA/blob/d5bbccb06ceaf0b37bd6c9808bca1f1e9b07afdc/pyproject.toml
[model]: https://huggingface.co/mims-harvard/ATHENA-R1-Qwen3-8B/blob/acacc6b08e341aaf03c9639097255013ac65ebf2/README.md
[misura1]: https://github.com/Wulfgardr/mediflow/blob/c9a236ea238d67880c17d25ebe153d3a50c752fb/docs/quality/intelligence/2026-10-30-local-runs/misura.md
[misura2]: https://github.com/Wulfgardr/mediflow/blob/c9a236ea238d67880c17d25ebe153d3a50c752fb/docs/quality/intelligence/2026-10-30-local-runs/giro2.md
[previous]: https://github.com/Wulfgardr/mediflow/blob/973b19dbe6f91acd3141e96deda74ead9dfcf309/docs/adr/0166-athena-method-runner-boundary.md

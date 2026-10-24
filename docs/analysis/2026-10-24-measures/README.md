# Misure Web: creazione e lettura

Refs WUL-787. Unità W-11 del contratto 0.9.1 e unità 11 dell'addendum compositivo.

La sezione Misure ha un titolo unico con il numero delle registrazioni lette.
«Nuova misura» resta testuale presso il titolo, anche a registro vuoto. Il form
usa le scelte native comuni, conserva i campi quando viene chiuso e riaperto e
porta il fuoco sul parametro. «Annulla» chiude il form conservando la bozza;
nessuna chiusura registra o elimina dati. L'invio del form mantiene il ruolo
principale e la navigazione continua a riconoscere una compilazione pendente.

Il registro possiede la sua lettura con `useLiveQueryState` e richiede
`rejectAuthUnavailable: true`. Caricamento, lettura fallita, lettura non
disponibile e risultato vuoto sono presentati tramite `ViewState`. Il conteggio
compare solo dopo una lettura riuscita; un errore ritira anche le righe lette in
precedenza. «Riprova la lettura» richiama il refresh reale del proprietario e
non compare per l'indisponibilità autenticata.

La tabella per parametro, la vista per data e lo storico completo conservano
registrazioni, codici, unità e riferimenti. Nel dettaglio ogni valore mostra la
propria unità, anche quando nello stesso analita esistono unità storiche diverse.
Il menu comune espone «Elimina misura» per esteso e conserva la conferma e il
controllo di versione esistenti. Writer, autorizzazioni e audit non cambiano.
Il prefill di Open Loops mantiene collegamento alla prestazione e richiesta di
fuoco nel form.

## Limiti del contratto e della prova

La lettura autenticata accorpa 401 e 403 in un errore privo dello status. Questa
unità non ricostruisce il motivo: la sessione continua a essere ritirata dal
controllo esistente, senza un retry fittizio. Non sono introdotti stati offline,
percentuali, nuovi trasporti o nuovi contratti in `ViewState`.

`modules/page.tsx` è l'unico chiamante runtime del registro, in modalità
embedded. La composizione standalone conserva lo stesso form e la stessa
lettura, con testata propria; non si aggiunge una route prodotto per qualificarla.
Le prove di Quadro e Open Loops restano distinte dalla sola composizione.

## Verifiche e attribuzione

Prove sintetiche con Node 24.22.0 (ABI 137), harness E2E del progetto,
un worker e output isolati. Nessuna modifica ai servizi di scrittura,
all'autenticazione o a `ViewState`.

| Revisione | Prova | Esito e limite |
| --- | --- | --- |
| Runtime `121de3f` con spec identificato separatamente | Baseline compositiva | 12 combinazioni (2 temi × 1440/768/320/390/zoom reale 200%/400%) × 4 stati = 48 PNG. Sei vuoti dichiarati Grafite erano Giorno: attribuzione ritirata e sole sei celle recuperate con verifica DOM e render; le altre 42 non ripetute. |
| Runtime `121de3f` | RED funzionali | Cinque RED causali; il composito bozza si ferma sul nome accessibile del parametro e non prova annullo/ripresa. Tre primi rossi lettura erano errori driver, conservati. Ripresa con GET osservata: loading/error RED, 403 ritira la sessione come previsto. |
| `6173ee4` | Sei spec, 77 casi | 70 PASS, 7 FAIL, zero skip/flaky. I sette: un driver che supponeva dettaglio aperto dopo invio e sei overflow compatti da 4 px. I 70 PASS restano riferiti a questa revisione e al loro perimetro. |
| `e555dfc` (runtime invariato) | Diagnosi 320 px | Cella azioni 48 px, padding 8 px e pulsante 44 px: bordo pulsante a 308 contro sezione a 304. |
| `4c30222` | Ripresa dei soli sette falliti | 7 PASS. Colonna azioni compatta a 56 px, overflow zero nelle sei geometrie. Driver verifica POST e riga salvata, poi seleziona il dettaglio. |
| `4c30222` | Due type-scale rendered-all-pages | Giorno PASS, Grafite FAIL per lock screen su `/settings/sviluppo`. Il caso intero Grafite resta fallito; nessuna preesistenza o scadenza dedotta. |
| `52a65bc` (runtime `4c30222`) → `1de9824` | Focus Valore, Grafite 768 px | RED con elemento attivo, bordo trasparente, outline assente e nessuna ombra; GREEN con regola circoscritta al form Misure, render ispezionato. Nessuna baseline 121 di questo indicatore. |

La diagnostica successiva, unico caso Grafite su `3f3edc1` (runtime
identico a `1de9824`, sola strumentazione del test), è passata senza recovery
aggiuntiva. Dopo il login, i 93 controlli osservati risultano sani e con sessione
presente; la navigazione a `/settings/sviluppo` riesce. Questo non identifica la
causa del primo fallimento, che resta aperto. La strumentazione è stata rimossa
prima della consegna, ripristinando il test originale.

Le cinque falsificazioni attese sono state osservate. Dopo il ripristino esatto,
la ripresa dei quattro casi ha dato tre PASS e un FAIL: il caso titolo a zero
righe non raggiunge la proprietà, perché la pagina risponde 500 con `SyntaxError:
Unexpected end of JSON input`. Stack, overlay e dist sono conservati; nessun
percorso JSON è indicato. Il ripristino byte esatto non equivale al GREEN di
quel caso; non si attribuisce automaticamente la causa alla cache o al prodotto.

La selezione comprende `measures-composition`, `quadro`,
`patient-navigation`, `disclosure`, `lume-quadro` e `lume-scheda`, oltre ai due
casi tipografici che attraversano `#parametri`. Quadro verifica anche lo storico
completo con unità diverse; Open Loops verifica prefill e fuoco. La vista
«Per data» a 320 px è stata catturata e ispezionata: parole integre e associazioni
misura/valore/unità/riferimento leggibili nella porzione visibile. Non è stata
applicata a quel ramo la trasformazione della tabella per parametro.

I PNG a zoom reale attestano la porzione mostrata. Il form baseline al 400%
mostra la zona centrale; non prova i comandi fuori viewport. Nel GREEN uno
scroll mirato mostra il parametro focalizzato e, separatamente, il messaggio
vuoto. Nuovi PNG e correzioni di attribuzione restano distinti dagli originali.

Lint, typecheck, never-regress, claims, type-scale, lume-tokens, motion-budget
e test-selection sono passati su `1de9824`; 34 test dei token e 31 unitari
pertinenti sono passati senza skip. Le falsificazioni rimuovono separatamente
implementazione, comando di focus, regola di focus visibile e larghezza azioni;
gli esiti della ripresa dopo il ripristino restano distinti, come indicato sopra.

I consumer `official-ui` e `runtime-workbench` richiedono i rispettivi opt-in,
archivio sintetico marcato e runtime/porte dedicati. Il test di performance
richiede un bundle standalone qualificato e il runner sintetico specifico.
Questi prerequisiti non sono stati allestiti: i tre percorsi non sono dichiarati
passati e non si attribuiscono misure di performance o query count.

Build canonica, CI e review della composizione finale restano separate dalle
prove in sviluppo qui descritte. Log, diff integrale e immagini originali sono
conservati nel dossier privato della verifica. Questa unità non qualifica l'uso
clinico e non chiude da sola WUL-787 o la release.

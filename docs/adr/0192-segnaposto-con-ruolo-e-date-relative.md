# ADR 0192: Segnaposto con ruolo e date relative

Data: 2026-11-19

Stato: **Proposed**. Decide Leonardo. Riferimenti: WUL-904, WUL-905,
[ADR 0077](0077-ai-provider-abstraction-and-egress-anonymization-boundary.md).

## Punto di partenza

L'ADR 0077 fissa il confine di uscita verso i modelli cloud. Il testo viene
pseudonimizzato in locale, parte verso il fornitore e la risposta viene
reidratata in locale solo nei campi di testo dichiarati. La verifica del
19/11/2026 ha confermato che il confine regge ed ha trovato tre debolezze
nel rimescolatore (`lib/ai-redaction-session.ts`):

1. i segnaposto avevano tutti la stessa forma, `{{MF_PII_<32 esadecimali>_n}}`,
   senza la classe del valore. Se il modello scambiava paziente e familiare,
   la reidratazione accettava la risposta. Erano lunghi 44 caratteri e su un
   testo sintetico denso raddoppiavano la lunghezza del testo;
2. la reidratazione controllava solo che il segnaposto appartenesse alla
   preparazione, non il ruolo né il campo in cui compariva;
3. tutte le date giorno/mese/anno venivano oscurate, comprese quelle della
   visita e degli esami, ed il modello perdeva la sequenza degli eventi.

## Decisione

### Forma dei segnaposto

Un valore sostituito diventa `[[MF_<RUOLO><n>_<nonce>]]`, ad esempio
`[[MF_PAZ1_k7m2q9xa]]`. Il ruolo dice la classe:

| Ruolo | Che cosa sostituisce |
|---|---|
| `PAZ` | nomi del paziente in contesto, cioè quelli che arrivano dall'anagrafica |
| `PER` | ogni altra persona: familiari, medici, operatori |
| `NAS` | date di nascita |
| `DAT` | date che non diventano scostamenti |
| `TEL`, `EML`, `IND` | telefono, email, indirizzo o luogo |
| `CF` | codice fiscale, anche con checksum errato |
| `ORG`, `ID`, `ALT` | organizzazione, altro identificativo, valore conteso fra classi |
| `GG±n` | data clinica espressa come scostamento in giorni |

Lo stesso valore riceve lo stesso segnaposto per tutta la sessione, come
prima. Il numero conta i valori dentro il ruolo.

Il nonce ha 8 caratteri (40 bit) al posto di 32 esadecimali. La proprietà che
prima dipendeva dai 128 bit ora la garantisce il processo: due sessioni vive
non ricevono mai lo stesso nonce, anche se la sorgente casuale si ripete.
Ogni preparazione ha una sessione propria e la risolve solo lì, quindi un
segnaposto di una preparazione non viene mai reidratato da un'altra. Una
sessione chiusa non risolve più nulla e le mappe vivono solo in RAM, perciò
il riuso di un nonce dopo la chiusura non riapre una corrispondenza.

La forma riservata è `[[MF` seguito da qualunque cosa, oppure `MF_` seguito
da un ruolo e da una cifra o da `GG` e un segno. Un testo d'ingresso che la
contiene viene rifiutato prima della preparazione. Sigle e nomi di file con
«MF_» che non hanno quella forma passano.

### Ruolo legato al campo

Il profilo del compito può dichiarare, per un percorso di testo dell'output,
quali ruoli vi sono ammessi (`ordinaryTextRoles` in
`lib/chatgpt-execution/ordinary-task-profile.ts`). Oggi lo fa in due punti di
Smart Import e Document Synthesis: `prescribedAt` ammette solo `DAT` e `GG`,
`requestReference` solo `ID` ed `ALT`. Gli altri campi restano liberi, perché
un vincolo senza un senso clinico evidente farebbe fallire risposte buone.
Un ruolo non ammesso, un segnaposto alterato, sconosciuto, di un'altra
preparazione o dentro una chiave JSON fa fallire l'intera risposta.

### Date relative

Le date intere che il Layer 1 riconosce (giorno/mese/anno con `/`, `.` o `-`,
anni dal 1900 al 2099) escono come `[[MF_GG+n_<nonce>]]` o
`[[MF_GG-n_<nonce>]]`. L'ancora è la prima di queste date nella sessione,
spostata a caso di ±1024 giorni: non si ricava dai byte del payload e due
preparazioni dello stesso testo danno scostamenti diversi, con gli stessi
intervalli. Il testo inviato porta in coda una nota sulla forma delle date,
solo quando ne contiene.

Il modello può restituire uno scostamento nuovo e MediFlow lo ricalcola in una
data nel formato giorno/mese/anno. Uno scostamento già emesso torna con la
grafia originale. Uno scostamento malformato, oltre 36.525 giorni o fuori dal
1900-2099 fa fallire la risposta. Una data fuori da quell'intervallo
rispetto all'ancora esce come `DAT`. Quella che riconosce solo il livello
neurale (ad esempio «3 marzo 2026») resta un segnaposto `DAT`.

La data di nascita non esce mai come scostamento. È nascita se coincide con
una data dell'anagrafica, in qualunque formato giorno/mese/anno o ISO, oppure
se segue un richiamo come «nato il», «nascita», «DN». Esce come `NAS` e torna
indietro solo per reidratazione. Se una data è già uscita come scostamento e
poi compare come nascita nella stessa sessione, la preparazione fallisce.
Nessuna funzione attuale chiede l'età: quando servirà, il modello riceverà
l'età e non la data.

## Invarianti e prove

| Invariante | Prova nel repository |
|---|---|
| I1. Nessuna identità nei byte in uscita | `ordinary-placeholder-roles.test.ts`, sentinella con paziente, familiare, medico, CF, telefono, email, indirizzo e date |
| I2. Segnaposto con ruolo, `PAZ` distinto da `PER` | stesso file, I1 ed I2 |
| I3. Nessuna confusione fra preparazioni | stesso file, I3, con la sorgente casuale forzata a ripetersi |
| I4. Spazio di nomi riservato | stesso file, I4, con i casi legittimi che contengono «MF_» |
| I5. Ruolo legato al campo | stesso file, I5 |
| I6. Date relative, nascita mai come scostamento | stesso file, I6, e `lib/redaction-date-offsets.test.ts` |
| I7. Ingombro | `ordinary-preparation-golden.test.ts`: ogni payload della golden è più corto di quello con `MF_PII` |
| I8. Il cancello resta chiuso | `ai-egress-gate.test.ts` e `ai-redaction-session.test.ts`, invariati |

## Limiti che restano

- È pseudonimizzazione, non anonimizzazione: le corrispondenze esistono in RAM
  ed il contesto clinico può bastare a riconoscere una persona. Il GDPR resta
  applicabile, come dice l'ADR 0160.
- Lo scambio di due segnaposto dentro la prosa libera non si rileva. Se il
  modello scrive «[[MF_PER2]] accompagna [[MF_PAZ1]]» al posto del contrario,
  la frase passa. Il controllo meccanico chiude il problema solo nei campi con
  ruoli dichiarati.
- Gli intervalli fra le date restano veri, quindi la data di oggi e gli anni
  si possono indovinare dal contesto (un farmaco, una stagione, una
  ricorrenza). L'ancora nasconde il giorno esatto, non l'epoca.
- Le date scritte in altri formati restano affidate al livello neurale, come
  prima.

## Fuori da questa decisione

Sandbox ed avvio del worker GLiNER, esecuzione ed account ChatGPT, canale e
mandati degli agenti, schema del database. Governance, consenso sui byte
congelati, audit ed evidenza di redazione non cambiano: i conteggi per classe
restano quelli dell'ADR 0077.

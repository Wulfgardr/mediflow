# Dati sanitari e intelligenza: scelte e responsabilità

MediFlow conserva la cartella sul sistema locale e rende esplicito quali
funzioni possano accedervi. La scelta favorisce il controllo delle informazioni,
ma non basta a stabilire se un impiego sia adeguato: occorrono anche decisioni
organizzative, tecniche e giuridiche riferite al contesto concreto.

Questa guida aiuta a leggere tali distinzioni; non modifica i contratti di
sicurezza e non attesta una certificazione. Data della guida: 6 settembre 2026.

## Nel lavoro quotidiano

Il documento originale resta consultabile perché una proposta intelligente
deve poter essere confrontata con le fonti e con il contesto attuale. Un modello
può omettere un’informazione o interpretarla male: valutare il risultato resta
quindi compito del professionista.

L’AI è facoltativa e i provider esterni sono disattivati per impostazione
predefinita. Scegliere una funzione intelligente richiede di configurarla,
accertare che sia disponibile e verificare il runtime; non implica che ogni
modello possa essere usato per qualunque funzione.

## GDPR: protezione tecnica e trattamento concreto

La valutazione parte dal trattamento che si intende svolgere: finalità e base
giuridica, condizioni per l’uso di dati sanitari, ruoli, conservazione, misure
di sicurezza e necessità di una valutazione d’impatto dipendono dal contesto
d’impiego. I riferimenti sono gli articoli 5, 6, 9, 25, 28, 32 e 35 del
[GDPR consolidato](https://eur-lex.europa.eu/eli/reg/2016/679).

La pseudonimizzazione separa gli identificativi dal contenuto usando
informazioni aggiuntive, ma non rende automaticamente anonimi i dati. Se la
persona resta identificabile, il GDPR continua ad applicarsi, come richiamano
l’articolo 4(5) e il considerando 26. Anche per questo il funzionamento locale
non risolve da solo tutti gli obblighi del trattamento.

## AI Act: finalità, funzione e ruolo

L’ambito sanitario non attribuisce da solo la stessa qualificazione a ogni
funzione AI. Classificazione e obblighi dipendono dalla finalità prevista,
dal sistema e dai ruoli degli operatori. La supervisione umana è perciò un
controllo importante del progetto, non una prova sufficiente di adempimento.

L’eventuale qualificazione come dispositivo medico richiede inoltre una
valutazione distinta. Il riferimento è l’[AI Act, testo consolidato](https://eur-lex.europa.eu/eli/reg/2024/1689),
in particolare l’articolo 6 e gli allegati I e III per la classificazione.

La [matrice del 6 settembre 2026](./analysis/2026-09-06-086-regulatory-evidence.md)
documenta le fonti considerate a quella data, le modifiche del 2026, le date
applicabili e i quesiti aperti. Resta un’analisi candidata: non attribuisce
ruoli e non assume decisioni di classificazione.

## Provider e offuscamento: cosa è presente, cosa è previsto

La [matrice dei runtime](./ai-runtime-serving-matrix.md) indica quali capacità
siano disponibili e con quali limiti. Nella candidatura 0.8.5 qui descritta,
OpenAI e Anthropic dispongono di adapter e composizioni per prove controllate,
spenti per impostazione predefinita. La loro presenza non attesta un servizio
cloud clinico pronto all’uso.

Per un invio ammesso, l’[ADR 0077](./adr/0077-ai-provider-abstraction-and-egress-anonymization-boundary.md)
prevede che parta soltanto il contenuto necessario, che gli identificativi
siano sostituiti prima dell’uscita e che il risultato venga riconciliato in
locale. Il percorso procede per strati: la presenza del filtro deterministico
non dimostra che sia completo anche quello sul testo narrativo. Il controllo
di uscita rifiuta quindi il testo narrativo clinico finché non siano pronti
i prerequisiti richiesti per l’oscuramento dei dati identificativi. Questo
non comporta alcuna promessa di anonimizzazione universale o assenza di errori.

## Per approfondire

- [SECURITY](../SECURITY.md): policy di sicurezza e trattamento dei dati.
- [Topologia dati](./topologia-dati-flussi.md): persistenza, accessi e flussi.
- [Limiti noti](./known-limitations.md): limitazioni del sistema.
- [Readiness 0.8.5](./release-085-readiness.md): evidenze e gate della candidatura.

Questa pagina rende accessibile la lettura dei documenti tecnici. In caso di
differenze, prevalgono policy, contratti e matrice dei runtime, ciascuno nel
proprio ambito.

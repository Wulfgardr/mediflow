# Dati sanitari e intelligenza: scelte e responsabilità

MediFlow conserva la cartella sul sistema locale e delimita l’accesso alle sue
capacità. Questo favorisce il controllo delle informazioni. L’adeguatezza a un
uso concreto richiede anche decisioni organizzative, tecniche e giuridiche.

Questa guida orienta la lettura; non modifica i contratti di sicurezza e non
attesta una certificazione. Stato editoriale: 5 settembre 2026.

## Nel lavoro quotidiano

Il documento originale resta consultabile. Una proposta intelligente si
confronta con le fonti e con il contesto attuale. Il professionista conserva
il compito di valutare il risultato: un modello può omettere o interpretare
male un’informazione.

I provider esterni sono disattivati per default. La scelta di una capacità
intelligente comprende configurazione, disponibilità e verifica del runtime.

## GDPR: protezione tecnica e trattamento concreto

Finalità e base giuridica, condizioni per il trattamento di dati sanitari,
ruoli, conservazione, misure di sicurezza e necessità di una valutazione
d’impatto vanno valutati nel contesto d’impiego. Riferimenti: articoli 5, 6,
9, 25, 28, 32 e 35 del [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng).

La pseudonimizzazione separa gli identificativi dal contenuto usando
informazioni aggiuntive. Non rende automaticamente anonimi i dati: se la
persona resta identificabile, il GDPR continua ad applicarsi (articolo 4(5)
e considerando 26). Il funzionamento locale non risolve da solo tutti gli
obblighi del trattamento.

## AI Act: finalità, funzione e ruolo

Classificazione e obblighi dipendono dalla finalità prevista, dal sistema e
dai ruoli degli operatori. Non ogni funzione AI in ambito sanitario ha la
stessa qualificazione. La supervisione umana è un controllo importante del
progetto, ma non dimostra da sola l’adempimento degli obblighi applicabili.

L’eventuale qualificazione come dispositivo medico richiede una valutazione
distinta. Riferimento: [AI Act, Regolamento UE 2024/1689](https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng),
in particolare articolo 6 e allegati I e III per la classificazione.

## Provider e offuscamento: cosa è presente, cosa è previsto

La [matrice dei runtime](./ai-runtime-serving-matrix.md) è la fonte corrente
sulla disponibilità delle capacità. Nella candidatura 0.8.5, OpenAI e Anthropic
hanno adapter e composizioni di prova controllata, spenti per default. Questo
non attesta un servizio cloud clinico pronto all’uso.

L’[ADR 0077](./adr/0077-ai-provider-abstraction-and-egress-anonymization-boundary.md)
prevede minimizzazione, sostituzione degli identificativi prima dell’invio e
riconciliazione del risultato in locale. Il percorso è progressivo: lo strato
deterministico non equivale al completamento del filtro sul testo narrativo.
Il gate rifiuta l’uscita di testo narrativo clinico finché i prerequisiti di
redazione richiesti non sono pronti. Nessuna promessa di anonimizzazione
universale o assenza di errori.

## Per approfondire

- [SECURITY](../SECURITY.md): policy di sicurezza e trattamento dei dati.
- [Topologia dati](./topologia-dati-flussi.md): persistenza, accessi e flussi.
- [Limiti noti](./known-limitations.md): limitazioni del sistema.
- [Readiness 0.8.5](./release-085-readiness.md): evidenze e gate della candidatura.

In caso di differenze, prevalgono policy, contratti e matrice dei runtime per
il rispettivo ambito. Questa pagina ne rende accessibile la lettura.

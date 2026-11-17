# Mandato agenti nella UI fidata

Data: 17 novembre 2026. Refs WUL-869, ADR 0190.

La pagina Agenti crea un mandato dopo lo sblocco con passphrase e la
verifica del PIN di conferma. Durata massima, operazioni consentite,
fornitore ed eventuale passaggio dei dati clinici al fornitore sono parte
del mandato. La UI prepara una coppia ECDH P-256 e conserva sul server
soltanto la pubblica e la privata cifrata dalla master key residente.

La route UI richiede sessione Web corrente, trasporto same-origin,
attestazione del socket loopback e generazione corrente dell'archivio.
Il token locale ed il futuro token agente non sostituiscono questi controlli.
Il PIN passa dal verificatore esistente con lockout. Non viene conservato
nel mandato o nelle ricevute. Un ritiro della sessione durante la verifica
nega la creazione.

Creazione e revoca includono il proprio audit nella stessa transazione
IMMEDIATE. Il lettore di ammissione richiede una transazione chiamante e
rilegge scadenza, revoca, perimetro, autore e generazione. Non conserva
un'autorizzazione in cache. Revocare più mandati è un'unica transazione;
un errore audit annulla tutte le revoche. Il blocco manuale revoca prima
di ritirare la sessione. Il blocco per inattività ritira la sessione e
conserva il mandato. Un errore di revoca impedisce una ricevuta di blocco
confermato.

La tabella locale dei mandati nasce con la versione 13. La versione 12
rimane un predecessore immutabile, con impronta verificata sul suo
inizializzatore originale. Le prove controllano originale conservato,
rollback di un errore DDL, riapertura senza DDL e recupero cifrato dei
predecessori. L'eliminazione dell'account elimina la sua autorità senza
bloccare il reset con una chiave esterna.

## Confini delle prove

Le suite del mandato esercitano transazioni SQLite, scadenza, revoca,
perimetro, audit, trasporto HTTP e blocco con l'owner Web reale. Il deposito
nei test di ammissione è una fixture sintetica. Il canale di deposito A3,
il token A2 e l'applicazione A5 restano lavori distinti: questi test non
provano ancora un deposito agente completo né autorizzano scritture cliniche.
La condivisione della chiave fra schede resta WUL-877.

## Percorso del medico

`e2e/agent-mandate.spec.ts` passa sulla build sintetica del commit
`b289e6aac`. Parte da un archivio isolato, passa alla passphrase con il
kit di recupero, sblocca la scheda e crea il mandato dalla pagina Agenti.
Verifica prima il rifiuto del PIN errato, poi la creazione, la revoca
esplicita ed un nuovo mandato. Avanza l'orologio del browser per attivare
il blocco per inattività, controlla nel DB sintetico che il mandato resti
attivo, ricarica e sblocca. Il blocco manuale successivo revoca il mandato.
Le catture mostrano il mandato creato ed il blocco per inattività.

Sulla base A6 `c9f2d2661`, il medesimo percorso si ferma con un'asserzione
sull'assenza della voce Agenti, dopo un vero sblocco con passphrase.
La prova non usa cookie o chiavi preconfezionati. La lettura diretta del
DB è limitata alla directory sintetica posseduta dal fixture. Il comando
E2E imposta `E2E_ISOLATED_STANDALONE_DIR` al payload fisico della build e
`E2E_BROWSER_CHANNEL=chrome`, mantenendo sandbox e rete limitata al loopback.

## Raccordo dei controlli della nuova pagina e tabella

La CI ha rilevato tre omissioni di registrazione: percorso statico della
pagina, ruolo tipografico del titolo e classificazione della tabella locale
nei controlli di archivio e backup. Il titolo usa ora il ruolo della scala
Lume, la lista dei percorsi comprende Agenti e la tabella dei mandati è
classificata in ogni controllo. Il portabile clinico resta distinto dal
recupero cifrato completo dell'archivio. Le regressioni di backup, matrice,
archivio 0.9.0 e percorsi statici passano con 13 test, senza modificare i
criteri sulle tabelle cliniche o sui campi storici.

# Sistema Web: comandi e geometrie

Il Web è l'applicazione standard (direzione del 25/11/2026). La vista paziente
«Stabile e cambiato» è il canone: le regole qui sotto si ricavano dalle sue
misure e valgono per ogni altra schermata. Completano la
[specifica](01-specifica.md#controlli) e i criteri C1-C10 di
[04-primo-sguardo-e-controlli](04-primo-sguardo-e-controlli.md#d31-le-viste-fuori-dalla-scheda-seguono-gli-stessi-criteri),
senza introdurre uno stile nuovo.

I riferimenti esterni sono nella collezione Mobbin «MediFlow · sistema Web»
(privata). Ogni regola cita la vista paziente o un riferimento.

## Comandi

| Regola | Misura | Fonte |
| --- | --- | --- |
| Un comando si scrive con `Button` o con le classi `mf-button-*`. Le classi `ui-btn-*`, `mf-btn-*` e `graphite-mini-btn` non crescono: `check:button-system` lo verifica | Ruoli: principale, secondario, testo, distruttivo, icona | Vista paziente: «Prescrivi», «Nuova voce», «Azioni» |
| Comando nel contenuto | 40 px, 44 px al tocco. Raggio 10. Testo 14 px, peso 600. Margine interno 16 px | Specifica, «Comando»: alto quanto la riga |
| Comando nella testata della vista | 36 px, 44 px al tocco. Margine interno 14 px. Il comando solo icona è quadrato | Vista paziente, testata |
| Un solo principale per vista | Gli altri sono secondari o testo | Specifica C2. Shopify, menu: un solo «Save» pieno |
| Ordine | Secondari, poi il principale, poi «Azioni» con l'icona ⋯. Il principale è l'ultimo comando con nome a destra | Vista paziente, testata. Xero e Salesforce: «Cancel» a sinistra di «Save» |
| Distruttivo | Mai nella testata e mai accanto al principale. Sta nel menu «Azioni», per ultimo, oppure in una sezione propria in fondo alla pagina con la conseguenza scritta sopra | D13 e D20. Plain, Mintlify, Plausible: «Delete» in un blocco separato in fondo |
| Conferma di un distruttivo | Dialogo con titolo che nomina l'oggetto, una riga di conseguenza, «Annulla» a sinistra e il distruttivo pieno a destra | Cloudflare e Clerk: «Delete Worker», «Delete application» |

## Testata della vista

| Regola | Misura | Fonte |
| --- | --- | --- |
| Il percorso sta nella striscia in alto. I comandi della vista stanno sulla stessa riga, a destra | A 1440 e a 1280 px il bordo superiore dei comandi è alla stessa altezza in ogni vista | Vista paziente: comandi a 25 px dal bordo della finestra |
| Il titolo sta sotto, a sinistra, nel ruolo `record-person` | 28 px, peso 600 | Vista paziente: nome del paziente |
| «Torna a…» è un collegamento nella striscia del percorso, non un pulsante nella testata | Testo 13 px | Vista paziente: il percorso «Pazienti · …» riporta all'elenco |

## Campi, sezioni, stati

| Regola | Misura | Fonte |
| --- | --- | --- |
| Campo | 40 px, 44 px al tocco. Raggio 10. Contorno con inchiostro secondario, almeno 3:1 nei due temi | D23 (WUL-893) |
| Titolo di sezione | 15 px, peso 600, senza maiuscolo, conteggio a destra | D24 (WUL-892) |
| Riga che si apre (disclosure) | 44 px. Titolo 15 px, peso 600 | D24. Vista paziente: «Quadro paziente», «Smart Import» |
| Stato vuoto | Senza cornice né icona: una riga in grassetto che nomina ciò che manca, una riga secondaria, al massimo un comando secondario | Specifica, «Stati di una vista». Vista paziente: «Nessun controllo aperto.». Patreon, Navattic: il vuoto sta dove starebbe la tabella |

## Come si verifica

- `e2e/lume-sistema-web.spec.ts` misura nel browser, a 1440 × 900 e a
  1280 × 720, altezza, raggio e corpo dei comandi, la posizione dei comandi
  della testata e il numero di principali in ogni vista.
- `npm run check:button-system` impedisce nuove occorrenze delle classi di
  pulsante storiche.
- Le catture prima e dopo stanno nella PR di ogni area.

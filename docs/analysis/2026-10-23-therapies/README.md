# Terapie: composizione e verifiche

Part of WUL-787. Unità 7 dell'addendum compositivo.

La creazione è testuale e appartiene al titolo, anche senza terapie. Il titolo
è unico, in maiuscoletto a 12 px; i conteggi distinguono attive, sospese e concluse.
I sottogruppi compaiono solo con righe. Il form mantiene bozza e soglia, con un
solo comando principale. Le righe attive espongono Modifica e il menu comune;
Sospendi, Concludi ed Elimina mantengono ordine, guardie e conferme.

## Revisioni e ambiente

- Base: `64e190438da8287928f0903b9b719c18b329a7ec`.
- Implementazione: `2e73fe52f9a0cd021677cedac69745a1a8db81b3`.
- Catture dopo e build: `a06ee7d469704c5680251705de5ff05da76bb1e7`.
- Node 24.21.0, `npm ci` reale; Chromium dell'harness E2E.
- Solo pazienti e farmaci inventati; directory dati temporanea distinta per run,
  con copia legacy disabilitata. Nessuna lettura del database clinico.
- Build Web da clone sparse pulito, senza hard link, con l'unica esclusione della
  fixture SQLite Swift, secondo `docs/native-launch.md` e Web Core CI.

Gli ultimi commit di evidenza non cambiano il codice applicativo rispetto alla
revisione delle catture. Le misure provengono soltanto dai test browser.

## Difetto, fix e falsificazione

Prima del fix, quattro test comportamentali falliscono su asserzioni pertinenti:

1. Nuova terapia ha un fondo pieno anziché il ruolo testuale.
2. Un form aperto e la soglia di cambio stato espongono due principali, anziché uno.
3. Sospendi e Concludi sono visibili nella riga, fuori dal menu.
4. Mancano i conteggi espliciti di sospese e concluse e il registro ripete i titoli.

Con il fix, i 15 test di composizione passano: matrice zero/una/tre terapie per
ciascuno stato, gruppi non vuoti, conteggi, creazione, modifica, bozza e soglia,
menu, Esc/fuoco ed eliminazione con motivo obbligatorio e un solo invio.
Rimuovendo temporaneamente il fix, gli stessi quattro test tornano rossi sulle
stesse asserzioni. Ripristinando il fix tornano verdi nella suite estesa.

## Verifiche

- Suite E2E estesa: 89 casi selezionati, 86 passati e 1 skip già previsto
  (`patient-navigation`, catture opzionali). Due attese cercavano ancora
  «Terapie sospese»: corrette in «Sospese» e rieseguite, 2/2 verdi.
  Risultato composto: tutti gli 88 casi eseguiti verdi, 1 skip.
- Incluse composizione, conferme/CAS, risposte perse, conflitti, recupero,
  seconda tab, navigazione/sessione/smontaggio, menu comuni e disclosure.
- Catture finali: 8/8 scenari verdi; baseline zoom corretta: 2/2 verdi.
- `npm run test:inventory-browser`: verde, tutte le quattro ricette del gruppo.
- `npm run lint`, `npm run typecheck`: verdi, anche dopo le correzioni dei test.
- Guard: never-regress, claims, type-scale, lume-tokens, motion-budget e
  test-selection verdi; anche `test:lume-tokens` verde.
- `npm run build`: verde, compresi manifest runtime, verifica standalone e
  preparazione del payload, su sorgente sparse pulita alla revisione indicata.
- `npm run test:unit`: **rosso preesistente**. 7.765 test selezionati,
  7.722 passati, 29 falliti, 14 saltati; tutti i 29 rossi erano già presenti sulla
  base. [Elenco completo e confronto con main](./unit-preesistenti.md).

Il primo tentativo di build nella worktree di test è stato fermato dal preflight
per gli alias del server dev. La build completa sopra usa l'area sparse pulita
prevista dal progetto. Le due attese E2E e il ritaglio delle catture zoom sono
rilavorazioni corrette; non sono check rossi residui.

## Collegamento al modello formale

Lo stato, i callback di scrittura e recupero fino a `handleSoftDelete` sono identici
byte per byte alla base. Sono stati riesaminati anche i callback JSX spostati nel
menu e le loro guardie. Non cambiano comandi, conferma, CAS, audit, recupero o
transizioni; il ruolo visivo della soglia scende a secondario mentre il form
mantiene il principale.

Prima dell'aggiornamento manuale della copertura: TLC corrente e 48/48 test
controller/HTTP verdi. Dopo l'aggiornamento: `npm run verify:therapy-status`
interamente verde, con 5.903.794 stati distinti, 28.149.669 generati, profondità 36,
coda vuota; 3 mutanti del modello, 6 testimoni, 2 mutazioni del controller e
controller ripristinato qualificati. [Risultato strutturato](./formal-result.json).
Motivo e revisione sono nel README formale. Valgono i suoi limiti finiti.

## Catture

[Manifest e SHA-256 delle 56 immagini](./captures.json).
Le 24 immagini prima usano tutte la base; le 32 dopo usano tutte `a06ee7d469`.
Giorno e Grafite, 1440, 768, 390 e zoom Chromium reale 200%:
registro, form, conferma e, dopo il fix, menu. Ogni stato mantiene lo stesso
schema di fixture sintetica. Prima e dopo hanno revisioni applicative distinte,
esplicitate nel manifest; ogni serie è fissata a una sola revisione.

Il test iniziale con `fullPage` ritagliava le immagini a zoom 200%. Le catture
zoom sono state rigenerate sui rispettivi SHA con screenshot del viewport fisico,
verificando PNG 1440×1000, `tabs.getZoom=2` e `innerWidth=720`.

- Giorno 1440: [prima](./captures/prima-giorno-1440-registro.png), [dopo](./captures/dopo-giorno-1440-registro.png).
- Grafite 768: [prima](./captures/prima-grafite-768-registro.png), [dopo](./captures/dopo-grafite-768-registro.png).
- Giorno 390: [prima](./captures/prima-giorno-390-registro.png), [dopo](./captures/dopo-giorno-390-registro.png).
- Zoom reale 200%: [prima](./captures/prima-giorno-zoom-200-registro.png), [dopo](./captures/dopo-giorno-zoom-200-registro.png), [menu Grafite](./captures/dopo-grafite-zoom-200-menu.png).

## Scelte di design da valutare in review

Le righe sospese mantengono Riattiva visibile e Concludi nel menu. Quelle concluse
mantengono solo Riattiva, senza menu vuoto. Modifica ed Elimina restano disponibili
nei soli stati che già le consentivano: aggiungerle altrove cambierebbe i comandi.

Nuova terapia resta al suo posto, disabilitata mentre il form è aperto, per
conservare la bozza. La soglia resta operabile con il ruolo secondario; invio e
conferma mantengono gesti distinti. La proposta terapeutica e i suoi stati D14
appartengono all'unità 8; questa PR ne conserva i componenti comuni esistenti.

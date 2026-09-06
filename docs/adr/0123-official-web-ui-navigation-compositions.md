# ADR 0123: UI web ufficiale con due disposizioni di navigazione

Date: 2026-09-06
Status: Accepted

## Problema

Il design WUL-676 e stato scelto dall'utente: B con barra superiore e
predefinita, A con barra laterale resta selezionabile in Aspetto. Il candidato
`02505b6` lo attiva pero solo con `MEDIFLOW_RUNTIME_TWIN=1`, insieme alla barra
di confronto e alla dicitura dei dati sintetici. Importare i commit senza
separare questi due ruoli lascerebbe la UI scelta fuori dall'avvio ordinario.

## Contesto

ADR 0047, 0050 e 0060 stabiliscono una sola shell web ufficiale, senza profili
funzionali o grammatiche estetiche concorrenti persistite. La decisione utente
del 6 settembre introduce una preferenza circoscritta di disposizione della
stessa UI Lume. Non riapre la scelta tra shell storiche.

Restano i percorsi canonici, i tredici moduli paziente, i writer, le capability,
PIN/sessione, la cifratura, onboarding e profili di lavoro del closeout. La
disposizione non sceglie servizi, modelli, endpoint o privilegi. Non cambia
i contratti API e non promuove il lavoro delle lane native o WHO.

## Opzioni e trade-off

1. Importare il solo confronto opt-in: conserva lo studio, ma non consegna la
   UI scelta all'avvio ordinario.
2. Attivare globalmente il flag del twin: espone strumenti e diciture di
   anteprima anche fuori dalle fixture sintetiche.
3. Promuovere la UI e separare il confronto: mantiene un solo prodotto con
   due disposizioni, al costo di verificare entrambe nella medesima shell.

## Decisione

Adottiamo l'opzione 3, su autorizzazione esplicita dell'utente.

- L'avvio ordinario mostra la UI scelta senza variabili di anteprima.
- B, denominata Barra superiore in Aspetto, e il default senza preferenza.
  A, Barra laterale, e selezionabile e conservata nel browser. La preferenza
  usa la chiave esistente `mediflow.runtime-twin.composition`, con soli valori
  `stream` e `workbench`; nessun identificativo o contenuto clinico.
- Il default server e B. Lo storage indisponibile conserva la scelta nella
  pagina corrente; le schede della stessa origine si riallineano tramite gli
  eventi esistenti. Non e una preferenza del profilo clinico sul server.
- `MEDIFLOW_RUNTIME_TWIN=1` abilita esclusivamente il confronto temporaneo
  Originale/A/B e la relativa barra. Non e necessario alla UI di prodotto.
  Originale non e una scelta nelle impostazioni ordinarie e non e persistito.
- La barra, la dicitura di studio sintetico e il suo spazio riservato sono
  assenti senza il flag. I token e la disposizione della UI funzionano anche
  con inset zero.
- Gli strumenti `tools/runtime-twin-086/` restano invocazioni esplicite per
  fixture marcate. Non sono importati da app, startup o bundle di prodotto;
  seed, receipt, credenziali sintetiche e directory dati non migrano nel
  percorso ordinario.
- Cartelle aperte e form restano nei rispettivi owner della sessione. La
  promozione preserva i limiti documentati del guard di navigazione: non
  promette recupero durevole di tutte le bozze o salvataggio automatico.

Questa decisione aggiorna ADR 0047/0060 limitatamente al divieto assoluto di
una disposizione persistibile, e ADR 0050 limitatamente al confronto locale
esplicito del design. Restano vietati selector di capability, shell ufficiali
concorrenti e attivazioni funzionali attraverso profili di anteprima.

## First Thin Slice e verifica

Integrare i nove commit UI non equivalenti al closeout, conservando il fix auth
gia presente. Separare provider e chrome di confronto, poi verificare un build
ordinario e il relativo runtime con `MEDIFLOW_RUNTIME_TWIN` assente: B iniziale,
A dopo reload, assenza del confronto, normale sblocco/onboarding, apertura con
un clic, moduli progressivi, bozza e salvataggio/rilettura su dati sintetici.

Le prove del twin restano prove del confronto. Build, test e QA del candidato
integrato vanno registrati separatamente. L'accettazione di questo contratto
non attesta PR, release, parity completa o verifica su tutte le piattaforme.

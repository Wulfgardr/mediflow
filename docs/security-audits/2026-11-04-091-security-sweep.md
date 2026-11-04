---
summary: "Rapporto pubblico sanitizzato della ricognizione di sicurezza 0.9.1: quattro correzioni verificate e rischi residui dichiarati."
read_when:
  - "Valutare le correzioni di sicurezza della 0.9.1 su cambio PIN, ingresso locale, OpenMed e passaggio SISS."
  - "Scegliere il prossimo lavoro di sicurezza fra i rischi residui dichiarati."
---

# Ricognizione di sicurezza 0.9.1

Data della review: 2026-11-04 UTC

## Disposizione

Quattro finding validati hanno stato `FIX_VERIFIED` sul ramo
`claude/091-sicurezza`:

- S-01, severità High: cambio PIN senza conteggio dei tentativi;
- S-02, severità Medium: ingresso locale senza controllo dell'`Host`
  (DNS rebinding);
- S-03, severità Low: redazione OpenMed che seguiva i redirect;
- S-04, severità Low: URL di passaggio al SISS senza controllo dello schema.

Questo rapporto non certifica la sicurezza generale del prodotto. I rischi
residui elencati sotto sono noti e non corretti in questa revisione.

## Identità

- repository: `Wulfgardr/mediflow`
- revisione esaminata: `b15393ea6264b5ec9300b346435c3df7f18af67d` (`main`)
- correzioni: commit del ramo `claude/091-sicurezza` sopra quella revisione

## Perimetro e metodo

La ricognizione ha coperto il codice server e client della Web app: copertura
dell'autenticazione delle 263 route `app/api`, uscite di rete verso servizi
locali e remoti, percorsi di file, comandi di sistema, SQL, gestione delle
credenziali e della cifratura, intestazioni HTTP, CSRF e rendering di HTML.
Ogni superficie è stata letta per intero lungo il percorso della richiesta,
non per nome di funzione.

Ogni correzione è chiusa da un test che resta nel repository, fallisce sulla
revisione esaminata e passa sulla correzione. Le prove usano dati sintetici e
database temporanei; nessun dato clinico è stato letto.

Suite unitaria completa in locale (Node 24.22, macOS arm64, worktree con
`node_modules` condivisi): 9794 test sulla correzione, 9787 sulla revisione
esaminata, con lo stesso insieme di fallimenti d'ambiente (worker PDF, AnyDoc,
OCR) su entrambe. Due test intermittenti sotto carico passano rieseguiti da
soli. Typecheck, `check:never-regress`, `check:claims` e il gate della qualità
dell'audit passano.

Fuori perimetro: app native Apple e GPUI oltre al confronto dei formati di
cifratura, deployment Docker, dipendenze di terze parti.

## Finding e correzioni

### S-01: cambio PIN senza conteggio dei tentativi

Il cambio PIN verificava il PIN attuale con un confronto diretto, fuori dal
verificatore condiviso: i tentativi errati non venivano contati e un blocco
attivo non fermava il PIN giusto. Una sessione bastava quindi per provare PIN
senza limite; il PIN apre la master key degli account PIN. Il server accettava
inoltre un involucro della chiave in qualunque forma.

Correzione: il PIN attuale passa dal verificatore condiviso, che conta gli
errori e rispetta il blocco come al login e all'adozione della passphrase. Il
nuovo involucro deve essere alla versione KDF corrente, nella forma prodotta
dai client Web e Apple, come per la riscrittura KDF.

Prove: `lib/security/pin-change-service.test.ts`, due test nuovi.

### S-02: ingresso locale senza controllo dell'`Host`

Il server attestava come locale ogni connessione da loopback, e il controllo
same-origin ricostruiva l'origine attesa dall'`Host` della richiesta. Una
pagina di un altro sito che ridiriga il proprio dominio su `127.0.0.1` passava
entrambi i controlli. I cookie di sessione restano legati a `localhost`, quindi
nessuna route autenticata era raggiungibile; restavano raggiungibili le route
prima dell'accesso, compresa la creazione del primo account.

Correzione: al confine del socket una richiesta diretta in loopback con un
`Host` estraneo non riceve l'attestazione locale e viene marcata; il proxy delle
API risponde 421. Il proxy TLS prova ogni richiesta che inoltra, così il nome
di un dispositivo associato resta valido. Gli alias locali si dichiarano con
`MEDIFLOW_ALLOWED_HOSTS` (vedi [SECURITY.md](../../SECURITY.md)).

Prove: `scripts/loopback-ingress.test.mjs` e
`lib/security/web-cookie-mutation-admission.test.ts`, con un server HTTP reale
e il proxy di Next.

### S-03: redazione OpenMed che seguiva i redirect

Il controllo di salute e l'invio del testo da redigere seguivano i redirect: un
servizio sulla porta locale ammessa poteva rimandare il testo del paziente a un
altro server. Ora entrambe le richieste rifiutano i redirect, come le altre
uscite di rete del prodotto.

Prove: `lib/openmed-redaction.test.ts`, con un server che reindirizza e un
secondo server che non deve ricevere nulla.

### S-04: passaggio al SISS senza controllo dello schema

La finestra del portale SISS condivide l'origine di MediFlow finché non naviga,
e l'URL di passaggio era controllato solo come non vuoto. Ora deve essere
`https`, senza credenziali, su un host del portale regionale; altrimenti la
finestra si chiude e il passaggio non parte.

Prove: `lib/siss.test.ts`, un test nuovo.

## Verificato e trovato solido

- Ogni route `app/api` ha un controllo di autenticazione, diretto o delegato a
  `lib/`; le route pubbliche (accesso, stato, primo avvio) sono limitate al
  loopback attestato dal socket, mai da intestazioni.
- CSRF: le mutazioni con cookie richiedono `Sec-Fetch-Site: same-origin` e
  un'origine esatta; nessuna intestazione CORS.
- CSP con `frame-ancestors 'none'`, `object-src 'none'`, `X-Frame-Options`,
  `nosniff`, `Referrer-Policy: no-referrer`.
- Il sanificatore del testo clinico ricostruisce i tag ammessi senza attributi;
  gli allegati non sono mai serviti come byte inline sulla stessa origine.
- Nessun comando di sistema con shell, nessun SQL composto con input, nessuna
  estrazione di archivi con percorsi non controllati.
- Token confrontati a tempo costante; sessioni da 32 byte casuali, cookie
  `HttpOnly` e `SameSite=Lax`; IV AES-GCM casuali da 12 byte; passphrase v3 con
  2M iterazioni PBKDF2 e solo l'hash del verificatore sul server.

## Rischi residui dichiarati

Non corretti in questa revisione, in ordine di priorità:

1. Il blocco dopo i tentativi errati ha durata fissa e non cresce: per un PIN
   breve rallenta ma non chiude un attacco lungo da chi raggiunge l'accesso. La
   via d'uscita è la passphrase v3 (ADR 0143).
2. Gli account PIN precedenti conservano la master key esportabile nella
   memoria di sessione del browser; gli account con passphrase no. Vale lo
   stesso rimedio.
3. I campi `ENC:` non sono legati al contesto (tabella, campo, record): chi può
   scrivere nel database può spostare un testo cifrato fra campi senza che il
   client se ne accorga. Serve un ADR sul formato; le affermazioni sulla
   cifratura restano quelle di [SECURITY.md](../../SECURITY.md).
4. Molte route amministrative non controllano il ruolo: oggi il primo avvio
   crea solo amministratori, quindi il controllo mancante non è sfruttabile, ma
   lo diventa il giorno in cui esiste un secondo ruolo.
5. Il primo avvio accetta un account PIN di qualunque lunghezza e con un
   involucro non versionato. È raggiungibile solo dall'operatore sul computer
   stesso, una volta.
6. L'editor del testo clinico scrive il proprio valore nel DOM senza
   sanificarlo. Oggi il valore viene solo da ciò che l'operatore scrive o
   detta; va sanificato prima di caricarvi testo da altre fonti.
7. Il controllo del modello Ollama accetta qualunque porta di loopback e
   restituisce lo stato della risposta: a una sessione autenticata dice quali
   porte locali rispondono.

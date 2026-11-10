# Raccordi C-7: le tre funzioni generative nella chat

Nota di progetto del 10 novembre 2026, per la decisione di Leonardo del 9/11
(contratto 0.9.1, riga C-7 ed emendamento del 9 novembre). Il primo raccordo,
il Quadro paziente, è nel codice; gli altri due seguono quando le viste GPUI
corrispondenti sono in `main`.

## Regola comune

Il canale è quello di [ADR 0165](../../adr/0165-native-chat-access-channel.md):
socket locale della GPUI sbloccata, catena dei processi attestata, comandi
app-only. Ogni raccordo segue le stesse regole.

- Il comando non porta argomenti clinici. Paziente, ambulatorio, documento,
  fonti e modello vengono dalla finestra MediFlow e dalla configurazione della
  funzione sull'host. La chat non sceglie il provider: Ollama locale o ChatGPT
  li decide la configurazione della funzione lato server.
- La richiesta si lega alla sessione abbinata e alla selezione correnti
  (`chat_access_context`). Prima di aprire la vista il server la riammette:
  account idoneo, archivio invariato, epoca di selezione uguale
  (`revalidate_chat_access_context`).
- Consenso, generazione, fonti, ricevuta, scarto e revoca avvengono nella vista
  nativa che già esiste per quella funzione. Il server resta l'autorità:
  governo delle funzioni, kill switch, validazione dell'output, fonti.
- Alla chat tornano solo stati finiti, mai testo clinico, mai la proposta.
  Il frame rifiuta ogni risposta con un campo oltre allo stato. Nessun
  risultato rientra nel modello dell'host.
- Una richiesta della chat non sostituisce un lavoro aperto nella finestra.
- Nessuna modifica a `/api/v1`, agli schemi dell'archivio, a `lib/db.ts`.

Stati restituiti alla chat, per tutti e tre i comandi:

| Stato | Significato |
| --- | --- |
| `requested`, `preparing` | La finestra ha ricevuto la richiesta; ammissione o controllo della funzione in corso |
| `<funzione>-opened` | La vista è aperta e attende il consenso nella finestra |
| `<funzione>-unavailable` | Funzione spenta, kill switch o host locale chiuso |
| `<funzione>-busy` | Nella finestra c'è già un lavoro della stessa funzione: non viene sostituito |
| `<funzione>-closed` | La finestra ha concluso il lavoro aperto dalla chat (proposta, scarto, errore, indisponibilità) |
| `withdrawn` | Ogni altro diniego: sessione, selezione, archivio, blocco, revoca, idoneità. Il motivo tecnico resta nella finestra |

### Quando finisce la proprietà della chat

Come nel flusso ordinario di ADR 0165, dove «Revoca» resta disponibile finché
la richiesta non è consumata o ritirata, la chat possiede la richiesta dal
comando fino a quando la finestra conclude il lavoro che la richiesta ha
aperto: per il Quadro, finché la finestra prepara, attende il consenso o
genera. In queste fasi la carta lascia attivo «Revoca» e la revoca interrompe
il lavoro nella finestra senza proposta; il ritiro si controlla anche al
confine fra consenso e invio, così nessun dato parte dopo una revoca. La
proprietà finisce quando la finestra mostra la proposta, o arriva a scarto,
errore o indisponibilità: la GPUI risponde allora `<funzione>-closed`, la
richiesta perde ogni legame con sessione e selezione e la carta spegne
«Revoca». Una proposta già mostrata appartiene alla finestra. Resta il limite
del canale: una richiesta vive al massimo cinque minuti dalla creazione, poi è
ritirata senza rinnovo, anche durante consenso o generazione.

## Quadro paziente (Patient Insight): collegato

- **Comando:** `{"command":"patient-insight"}`, senza altri campi.
- **Permessi e capability:** sessione abbinata non bloccata; paziente
  selezionato e mostrato; riammissione sul server; accesso all'host locale
  aperto; interruttore `aiPatientInsightKillSwitch` acceso, letto dopo
  l'ammissione. Nessun'altra vista nativa aperta (bozza, dettatura, PDF,
  un'altra richiesta della chat), schermo privacy spento.
- **Stati alla chat:** `insight-opened`, `insight-unavailable`,
  `insight-busy`, `insight-closed`, `withdrawn`.
- **Nella finestra:** il Quadro del paziente selezionato in Panoramica, al passo
  del consenso: quante condizioni, terapie e voci di diario verranno inviate.
  Poi il percorso di G-5a: un invio, proposta con fonti e ricevuta, scarto,
  proposta superata quando le fonti cambiano.
- **Negativi C-7 e dove si provano:**

| Negativo | Prova |
| --- | --- |
| Fonti | Prove G-5a del Quadro (`patient_insight/tests.rs`); il raccordo apre la stessa vista |
| Controllo dell'output anche locale | Prove G-5a e contratto Web (`lib/patient-insight-gpui-contract.test.ts`): risposta alterata = errore, nessuna proposta |
| Funzione indisponibile | `chat_denials_return_a_state_and_never_generate` (kill switch, interruttore illeggibile), `chat_with_local_host_closed_is_unavailable_without_any_call` |
| Output malformato o token estraneo | Prove G-5a (risposta alterata); comando con campi in più rifiutato (`insight_command_carries_no_patient_scope_model_or_foreign_token`); contesto di un'altra sessione negato (`insight_opens_only_with_paired_session_current_selection_and_server_admission`); frame che rifiuta campi oltre allo stato (`lib/chat-card/patient-insight.test.ts`, spec frame) |
| Contesto scaduto | Selezione cambiata, A→B→A, epoca dell'host, archivio sostituito, blocco, account non idoneo: test owner e GPUI sopra |
| Revoca durante l'operazione | `chat_withdrawal_during_generation_leaves_no_proposal`, `late_answer_after_chat_revocation_is_not_shown`, `chat_withdrawn_before_consent_sends_nothing`; dalla carta: `revocation stays available while the chat owns the insight and retires the request` (Node) e spec frame |
| Cambio paziente o selezione | `patient_change_withdraws_the_chat_and_drops_the_late_answer`, `opened_insight_is_withdrawn_when_selection_session_or_chat_changes` |
| Nessun ripiego e nessuna applicazione silenziosa | Il Quadro non scrive (prove G-5a, `assert_no_clinical_write`); proposta o generazione in corso non sostituite (`chat_never_replaces_*`); nessun motore alternativo quando la funzione è spenta |

- **Seconda seduta, con gli account di Leonardo:** comando e vista in Claude
  Desktop e nell'app Codex; ritiro alla chiusura del turno e al blocco del Mac;
  provider reali (Ollama e ChatGPT) scelti dalla configurazione della funzione;
  budget end-to-end dal comando alla proposta nella finestra.

## Sintesi dei documenti (Document Synthesis): da collegare

- **Comando previsto:** `{"command":"document-synthesis"}`, senza argomenti.
  Il documento si sceglie nella finestra, nella lista dei documenti del
  paziente selezionato: la chat non indica file o allegati.
- **Permessi e capability:** gli stessi del Quadro, più la lettura dei documenti
  del paziente e l'interruttore della sintesi dei documenti. La vista GPUI
  della sintesi è in `main` dalla #899: il prerequisito è soddisfatto.
- **Stati alla chat:** `synthesis-opened`, `synthesis-unavailable`,
  `synthesis-busy`, `synthesis-closed`, `withdrawn`.
- **Nella finestra:** la vista della sintesi del documento scelto, con consenso,
  proposta, fonti nel documento, ricevuta e scarto.
- **Negativi C-7:** gli stessi otto del Quadro, più documento cambiato o
  rimosso dopo il consenso (fonte superata) e documento di un altro paziente.
- **Seconda seduta:** come il Quadro.

## Import assistito (Smart Import): da collegare

- **Comando previsto:** `{"command":"smart-import"}`, senza argomenti.
- **Permessi e capability:** gli stessi del Quadro, più l'interruttore
  dell'importazione assistita e, per applicare, le capability di scrittura di
  diagnosi e terapie. Prerequisito: la vista GPUI dell'import assistito in
  `main`; oggi GPUI ne mostra solo l'interruttore.
- **Stati alla chat:** `import-opened`, `import-unavailable`, `import-busy`,
  `import-closed`, `withdrawn`. Nessuna ricevuta di scrittura alla chat: l'esito di ogni
  candidato applicato resta nella finestra.
- **Nella finestra:** candidati (diagnosi, terapie) con fonti nel documento;
  ogni applicazione è un gesto esplicito per candidato, con revisione e
  conferma nativa e il writer comune. È l'unica delle tre funzioni che può
  scrivere nella scheda.
- **Negativi C-7:** gli stessi otto, più: nessuna applicazione senza gesto per
  candidato; conflitto di versione della scheda; candidato superato da un
  cambio della scheda dopo la proposta; `npm run check:ai-clinical-writes`
  sul nuovo percorso.
- **Seconda seduta:** come il Quadro, più l'applicazione di un candidato con
  PIN o Touch ID.

## Che cosa è comune e che cosa no

Dalla #899 Quadro e sintesi condividono `shell/generation.rs`: fasi, biglietto
contro le risposte tardive, cancellazione dei testi. Il legame con la chat del
Quadro resta fuori da quel modulo, in `InsightChat` dentro i dati della scheda,
perché oggi solo il Quadro ha un comando della chat. Le tre protezioni del
raccordo sono però nei punti del Quadro che la sintesi ripete con la propria
struttura: controllo del ritiro fra consenso e invio
(`chat_withdrawn_before_consent_sends_nothing`), controllo del ritiro prima di
mostrare una risposta in volo (`late_answer_after_chat_revocation_is_not_shown`)
e chiusura della proprietà con lo stato finale. Il raccordo della sintesi le
deve riportare tutte e tre, con gli stessi test; quando i raccordi saranno due,
conviene portare il legame con la chat nell'area di generazione comune.

## Le altre capability «Non collegata»

La riga C-7 chiede «ogni capability del catalogo congelato I-0 rimasta nel
perimetro provata nella chat». Letta alla lettera, chiede anche queste:

| Capability | Generativa | La riga C-7 alla lettera |
| --- | --- | --- |
| `icd_lookup` | No, ricerca in tabella locale | Sì, se resta nel perimetro I-0: va provata nella chat |
| `service_prescription_matching` | No, abbinamento deterministico | Sì, stessa lettura |
| `evidence_absorption` | No, coda di evidenze dai documenti | Sì, stessa lettura |
| `patient_open_loops` | No, proiezione dei follow-up aperti | Sì, stessa lettura |

Nessuna delle quattro è implementata in questa lane. L'emendamento del 9/11
nomina solo le tre funzioni generative; per le quattro serve una decisione di
Leonardo: collegarle, oppure dichiararle fuori dal perimetro della chat con un
emendamento.

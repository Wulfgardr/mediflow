# Raccordi C-7: le tre funzioni generative nella chat

Nota di progetto del 10 novembre 2026, per la decisione di Leonardo del 9/11
(contratto 0.9.1, riga C-7 ed emendamento del 9 novembre). I tre raccordi,
Quadro paziente, sintesi dei documenti e import assistito in sola anteprima,
sono nel codice.

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
| `<funzione>-opened` | La vista è aperta ed attende il consenso nella finestra. Per la sintesi attende prima la scelta del documento, per l'import la preparazione della richiesta |
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

## Sintesi dei documenti (Document Synthesis): raccordo alla finestra

- **Comando:** `{"command":"document-synthesis"}`, senza argomenti.
  Il documento si sceglie nella finestra, nella lista dei documenti del
  paziente selezionato: la chat non indica file o allegati.
- **Permessi e capability:** gli stessi del Quadro, più la lettura dei documenti
  del paziente e l'interruttore della sintesi dei documenti. La vista GPUI
  della sintesi è in `main` dalla #899: il prerequisito è soddisfatto.
- **Stati alla chat:** `synthesis-opened`, `synthesis-unavailable`,
  `synthesis-busy`, `synthesis-closed`, `withdrawn`.
- **Nella finestra:** l'ammissione sul server e il controllo dell'interruttore
  precedono la scelta del documento. `synthesis-opened` apre la sezione Documenti:
  il medico sceglie il documento, prepara la richiesta e dà il consenso. Proposta,
  fonti, ricevuta e scarto usano la sintesi GPUI esistente. Senza documenti la vista
  indica lo stato vuoto e la chat conserva Revoca. Un secondo comando trova la
  sintesi occupata anche mentre la finestra aspetta la prima scelta.
- **Chiusura:** `synthesis-closed` rilascia il legame con la chat quando la finestra
  mostra la proposta o termina la richiesta. Revoca, EOF e scadenza successivi
  non tolgono una proposta già mostrata. La sua validità segue soltanto il
  documento e il contesto nativi. Quadro e sintesi hanno legami distinti.
- **Negativi C-7:** gli stessi otto del Quadro, più documento cambiato o
  rimosso dopo il consenso (fonte superata) e documento di un altro paziente.
- **Seconda seduta:** come il Quadro.

## Import assistito (Smart Import): raccordo alla finestra, sola anteprima

- **Comando:** `{"command":"smart-import"}`, senza argomenti. La chat non
  indica note, voci di diario, documenti o candidati.
- **Permessi e capability:** gli stessi del Quadro, più l'interruttore
  `aiSmartImportKillSwitch`, letto dopo l'ammissione. La vista GPUI è quella
  della #901: candidati con la loro fonte, ricevuta, nessun comando di
  applicazione. L'applicazione dei candidati, con le capability di scrittura
  di diagnosi e terapie, aspetta il contratto G-6j, in GPUI come dalla chat.
- **Stati alla chat:** `import-opened`, `import-unavailable`, `import-busy`,
  `import-closed`, `withdrawn`. Nessuna fonte, proposta o ricevuta alla chat.
- **Nella finestra:** `import-opened` apre la sezione Documenti. Il medico
  prepara la richiesta (fonti dalla scheda selezionata: note, ultime voci di
  diario, sintesi salvate dei documenti), vede che cosa parte e dà il consenso.
  Durante l'ammissione la preparazione non parte. Senza fonti la vista indica
  che cosa manca, non offre la preparazione e la chat conserva Revoca.
- **Chiusura:** `import-closed` quando la finestra mostra la proposta o
  termina la richiesta (consenso negato, errore, indisponibilità, scheda
  cambiata dopo la preparazione). Revoca, EOF e scadenza successivi non tolgono
  la proposta; la sua validità segue solo le fonti della scheda.
- **Negativi C-7 e dove si provano** (`shell/smart_import/tests/chat.rs`, test
  comuni in `owner.rs`, `generation.rs`, `adapter.rs`):

| Negativo | Prova |
| --- | --- |
| Fonti | Prove G-5c (`smart_import/tests.rs`); la proposta cita solo fonti inviate |
| Funzione indisponibile | `denials_answer_a_state_and_never_generate` (interruttore spento o illeggibile, host chiuso) |
| Output malformato o token estraneo | Prove G-5c (risposta alterata); `import_command_and_replies_have_no_clinical_fields`; comando con campi in più rifiutato (`generative_wire_states_and_synthesis_command_are_closed`); carta e frame |
| Contesto scaduto | Nessun paziente, sessione bloccata, account non idoneo (`denials_*`), A-B-A (`patient_a_b_a_retires_chat_and_cancels_its_import`), scheda di un altro paziente (`a_chart_of_another_patient_is_not_sent`), test owner comuni |
| Revoca durante l'operazione | `import_revocation_before_consent_sends_nothing`, `import_late_answer_after_chat_revocation_is_not_shown`, `idle_import_and_empty_chart_remain_owned_until_revocation` |
| Fonte cambiata o rimossa | `chart_changed_or_removed_after_preparation_sends_nothing`, `closed_proposal_ignores_chat_revocation_and_follows_chart_currentness` |
| Nessun ripiego e nessuna applicazione silenziosa | `assert_no_clinical_write` in ogni prova; lavoro aperto non sostituito (`an_active_import_or_proposal_is_never_replaced`); legami distinti (`import_synthesis_and_insight_have_independent_chat_ownership`) |

- **Negativi rinviati a G-6j:** applicazione con gesto per candidato,
  conflitto di versione della scheda, candidato superato dopo la proposta,
  `npm run check:ai-clinical-writes` sul percorso di scrittura.
- **Seconda seduta:** come il Quadro; l'applicazione con PIN o Touch ID
  arriva con G-6j.

## Che cosa è comune e che cosa no

Quadro, sintesi e l'anteprima dell'import assistito condividono
`shell/generation.rs`: fasi, biglietto contro risposte tardive, cancellazione
del contesto e dei testi. Il legame opzionale `ChatHold` appartiene all'area
che la chat ha aperto. Le richieste del canale indicano una `Function` e uno
`Stage`; le stringhe `insight-*` restano invariate.

I tre controlli sono nell'area comune: `start` controlla il ritiro prima
che il chiamante invii, `take_running` prima che il chiamante mostri una
risposta e `follow_chat` chiude la proprietà con lo stato finale. `end`
conserva il legame durante preparazione e scelte successive del documento.
Un invio rifiutato annulla anche il nuovo contesto e cancella il payload.
Il canale ha un solo ramo per i tre comandi generativi (`generative_function`)
e l'apertura comune `open_chat_function` sceglie l'area con `ChatArea`.

`scripts/falsify-chat-generation.py` toglie separatamente i controlli M1
(invio), M2 (risposta), M3a (scelta ancora aperta), M3b (chiusura) e M4
(legame conservato fra scelte), e pretende che ogni test elencato cada,
compresi quelli dell'import. Richiede un target Cargo proprio e una
`MEDIFLOW_DATA_DIR` sintetica esplicita. Esegue i test sensibili con due job
Cargo e un solo worker, accetta soltanto fallimenti di asserzione e
ripristina il sorgente anche se la prova fallisce. Il verde sul sorgente
ripristinato va registrato separatamente.

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

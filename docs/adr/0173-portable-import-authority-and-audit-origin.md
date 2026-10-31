# ADR 0173: Autorità e provenienza del ripristino portabile

Stato: Proposed. Review indipendente richiesta prima del merge.

Il checksum del formato portabile verifica l'integrità, senza autenticare la
sorgente. Un file costruito da terzi può contenere attestazioni attive e audit
con identità nuove. L'importazione amministrativa non deve attivare autorità
clinica né presentare lo storico importato come prodotto da questo host.

Prima della sostituzione, la route Web richiede nuovamente la credenziale
corrente dello stesso amministratore. Riusa derivazione della passphrase,
verificatore, limiti dei tentativi e controllo della sessione esistenti.
La credenziale accompagna soltanto quella richiesta, senza un grant riusabile.
Il client locale che usa questa route deve inviare la stessa conferma fresca.

Le attestazioni di revisione importate attive tornano inattive. Le revoche
locali restano terminali, anche se il file contiene una precedente attivazione.
L'autorità SOAP conserva la protezione già prevista dall'ADR 0097.

Q-5 richiede la conservazione dello storico: le tredici proprietà di ciascun
audit restano identiche, anche negli snapshot dei comandi. Nella stessa
transazione, l'host aggiunge un evento `backup.portable.imported` con
`subjectRef` uguale al checksum della sorgente. Per ogni audit nuovo aggiunge
`backup.audit.imported`, con `subjectRef` uguale all'ID dell'evento importato e
`requestId` uguale all'ID dell'importazione locale. Anche eventuali marcatori
contenuti nel file vengono trattati come dati importati. Gli eventi locali
preesistenti non sono sostituiti; collisioni discordanti continuano a bloccare
prima della scrittura. Una ripetizione riusa lo storico e aggiunge soltanto
il nuovo evento locale di importazione.

Non servono colonne, migrazioni o una nuova versione del formato: audit e
riferimenti usano le strutture esistenti. Il costo è un evento aggiuntivo per
ogni audit nuovo, più uno per importazione. La provenienza si legge unendo
`backup.audit.imported.subjectRef` a `audit_events.event_id`, e il relativo
`requestId` all'evento locale di importazione. È una registrazione locale
dell'ingresso del dato, non un'autenticazione della sua origine remota.

Prima del download, la UI richiede conferma delle categorie leggibili in
chiaro e della destinazione protetta. I limiti del formato e le affermazioni
sulla cifratura restano invariati. I dati clinici del file continuano a poter
sostituire quelli attuali dopo conferma: occorre scegliere una fonte fidata.

## Consumer dello storico importato

Il read model dell'audit espone `origin: local | imported` senza modificare i
campi originali. La lista ordinaria legge soltanto gli eventi locali;
`origin=imported` legge separatamente lo storico importato. I marcatori tecnici
sono esclusi dalla lista ordinaria, salvo filtro esplicito per tipo evento.
Il riepilogo legge due campioni con limiti indipendenti: gli importati non
consumano la capacità del campione locale e non contribuiscono a superfici,
attori, esiti o tipi più frequenti locali. La loro quantità esaminata e la
relativa eventuale troncatura sono esposte separatamente. Il limite effettivo
è 200 per campione e la troncatura viene calcolata su tale limite.

La ricevuta terapia espone la stessa origine. Il controller non mostra una
ricevuta importata come registrazione eseguita da questo host, anche quando
lo stato corrente della terapia coincide. Per comandi importati senza audit,
come chiusure e rifiuti, l'importazione scrive anche
`backup.therapy-command.imported`, collegato al comando e all'importazione
locale; i comandi già presenti e identici conservano la provenienza locale.
Il lettore conserva inoltre la compatibilità con gli import precedenti che
avevano già marcato l'audit del comando applicato. Nessun campo del ledger
viene riscritto. I marcatori sono un confine conservativo: anche marcatori
contenuti nel file non possono promuovere un evento importato a locale.

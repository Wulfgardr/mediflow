# Singola osservazione Windows ICU

Proposta non attivata. Il parent deve approvare esattamente il candidato
composto, R2 e questa attivazione prima di qualsiasi push/esecuzione.
Il trigger e la sola creazione di `diagnostic/windows-icu-text-20261002`,
attempt1: niente dispatch, update, force o rerun. Il job resta sempre rosso.

Due checkout separano sorgenti diagnostici e candidato runtime
`9eed9141c3094fced548222d5c547b55fda61181`, tree
`938baa343a19ea438d562fcf92650c523709b2a5`, Node24.21.0 Windows x64 ABI137.
Le opzioni Git valgono solo nei due processi checkout per conservare gli LF;
nessuna configurazione della macchina e modificata. Il producer controlla
SHA/tree/parent tramite header Git raw, pulizia e byte dei sorgenti pinned.

Una installazione del lock, una claim di compilazione fresca senza `.next`,
prebuild originale, `npm --ignore-scripts run build`, writer originale del
runtime manifest. Per isolare un solo child testo il checker postbuild PDF
non e invocato in questo esperimento: nessuna sua asserzione e cambiata e
nessun PASS Windows del postbuild viene dichiarato. La build Mac canonica
del candidato composto include invece il postbuild originale. L'esperimento
non sostituisce alcun gate di pubblicazione/release.

Il seal lega compile claim, Git identity, BUILD_ID root/standalone, runtime,
worker/profile e asset fisici binary/ICU. Il font Liberation Sans resta nel
checkout fonte verificato e viene passato dal probe via stdin al child.
Claim esclusiva prima della sola chiamata al probe; gli input sono ricontrollati
dopo il seal. Restano30s, heap256MiB, maxBuffer4MiB, read permission del solo
bundle e due variabili loader originali. Nessun corpus A/B, PDF reader o font
fallback. Oracolo PNG parent corretto R1/R2, separato dal child.

Install8min, compile12min, osservazione2min;45min job contro37min di passi.
Collection/upload `always()`, roster chiuso24 file/20MiB totali, JSON256KiB,
PNG128KiB, raw8MiB per stream per includere output parziale senza truncarlo
(non aumenta il maxBuffer del child). File inattesi/symlink/bounds negano la
collection e registrano perdita di evidenza; upload senza overwrite,3 giorni,
compressione0. Terminazione del runner o mancato upload possono perdere raw.
Ricevute sempre `releaseQualified:false`, anche se il PNG non e vuoto.

Questa prova non qualifica OCR/F3/font mancanti o risoluzione ETIMEDOUT/ERR_ABORTED.

# Asset ICD-11 MMS

Il dataset WHO reale non è incluso in questa tranche. Non inserire qui le
fixture sintetiche dei test. La ricerca mostra catalogo assente finché non
viene fornito un archivio autorizzato o confermato l'aggiornamento dalla UI.

Per il bundle servono `catalog.zip` (archivio WHO originale, non modificato) e
`manifest.json`, generato e verificato con il parser di
`lib/reference-data/icd11-embedded-parser.ts`:

- `schemaVersion`: `mediflow.icd11-catalog-manifest.v1`
- `sourceUrl`: URL SimpleTabulation 2026-01 dichiarato nel parser
- `releaseId`: `2026-01`; `language`: `en`
- `license`: `CC BY-ND 3.0 IGO`; `attribution`: `World Health Organization (WHO)`
- `sha256`: 64 cifre esadecimali minuscole; `bytes`: byte dell'archivio originale
- `rows`, `categories`, `withoutCode`: conteggi verificati dal parser

Il manifest non costituisce una firma WHO. Il dataset non diventa MIT.
Il parser ammette solo tab-separated UTF-8, anche in ZIP. Un archivio con solo
XLSX viene rifiutato esplicitamente e richiede una decisione successiva sul
supporto del formato, senza conversioni silenziose.

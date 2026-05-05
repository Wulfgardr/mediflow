# Repository Topology — MediFlow

Ultimo aggiornamento: 2026-05-05

Mappa concisa delle aree top-level del repository, pensata per orientare agent e
contributor: distingue il **runtime clinico** (codice che gira con dati paziente)
dagli **artefatti di pubblicazione/sito** e dagli **strumenti di sviluppo**.

> [!IMPORTANT]
> Le directory di **publication/site** non vanno trattate come parte del runtime
> clinico: non contengono PHI, non vengono caricate dal server Next.js e non
> devono essere referenziate da codice di produzione.

## Aree

| Path | Categoria | Note |
| --- | --- | --- |
| `app/` | runtime clinico | App Router Next.js (UI + API). |
| `components/` | runtime clinico | Componenti React condivisi. |
| `lib/` | runtime clinico | Logica di dominio, accesso DB, servizi AI. |
| `hooks/` | runtime clinico | Custom React hooks. |
| `drizzle/` | runtime clinico | Schema e migrazioni database locale. |
| `native/` | runtime clinico (client) | Client macOS/iOS/iPadOS. |
| `e2e/` | qualità | Test end-to-end Playwright. |
| `scripts/` | tooling | Script di build, test, benchmark, smoke. |
| `public/` | runtime clinico (asset) | Asset statici serviti dall'app. |
| `docs/` | documentazione | Documentazione canonica del progetto. |
| **`whitepaper/`** | **publication/site** | **Whitepaper/sito di pubblicazione. Non è runtime clinico, non importare da `app/`, `components/`, `lib/`.** |
| `oss-assets/` | publication/site | Asset per la repo OSS. |
| `tmp-*/` | tooling effimero | Output di test e build temporanei (in `.gitignore` o esclusi dal typecheck). |
| `tmp/` | tooling effimero | Scratchpad locale. |
| `Farmaci/` | dati di riferimento | Dataset farmaceutici di riferimento. |
| `certs/` | dev tooling | Certificati TLS locali per dev. |

## Regole operative

- Modifiche a `whitepaper/` **non** richiedono test del runtime clinico né
  rebuild dei moduli nativi: è un artefatto di pubblicazione.
- Codice in `app/`, `components/`, `lib/`, `hooks/` non deve importare da
  `whitepaper/` o `oss-assets/`.
- I path `tmp-*/` sono esclusi da `tsconfig.typecheck.json` (vedi `exclude`).
- Per la lista completa dei `.md` tracciati, vedi
  [docs/markdown-index.md](./markdown-index.md).

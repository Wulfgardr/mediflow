# NAR / Anagrafe regionale: blueprint read-only MediFlow

> Stato documento: `CANONICAL`

Questo documento restringe il dominio `NAR / Anagrafe Regionale` a una first
slice read-only verificabile per MediFlow. Non autorizza sync anagrafiche,
write regionali, scraping di Gaia o UI custom definitiva.

Riferimenti canonici:
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [SECURITY.md](../SECURITY.md)
- [docs/README.md](./README.md)
- [docs/markdown-index.md](./markdown-index.md)
- [docs/siss-baseline.md](./siss-baseline.md)
- [docs/siss-ssi-a2a-feasibility.md](./siss-ssi-a2a-feasibility.md)
- [docs/siss-fse-docs-corpus.md](./siss-fse-docs-corpus.md)
- [docs/adr/0045-siss-native-integration-boundary-requires-qualified-ssi.md](./adr/0045-siss-native-integration-boundary-requires-qualified-ssi.md)
- [docs/adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md](./adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md)

## Executive summary

Stato della ricognizione: 2 maggio 2026.

Le fonti pubbliche SISS mostrano che NAR non e un semplice modulo di ricerca:

1. l'Anagrafe Sanitaria e presentata come fonte regionale delle basi dati
   anagrafiche locali usate da ATS, ASST, IRCCS ed EEPA
2. NAR copre funzioni amministrative collegate a esenzioni e ticket
3. NAR include l'anagrafica dei medici prescrittori e i ricettari assegnati
4. il catalogo documentale pubblico espone manuali/placeholder per Gaia,
   iscrizione assistiti e gestione anagrafe medici specialisti
5. l'attuale MediFlow ha solo `portal-handoff` verso `Gaia` con CF pronto da
   incollare, non un canale applicativo read-only

Decisione:

- `same SISS adapter family`: NAR deve restare nel dominio SISS/SSI, con un
  modulo di contratto separato perche identita, eligibility e ricettari hanno
  failure mode propri
- `read-only only`: la prima integrazione plausibile deve leggere/verificare,
  non scrivere ne sincronizzare anagrafiche
- `handoff-only-for-now`: finche mancano specifiche, credenziali, ambiente e
  percorso di qualifica, MediFlow deve limitarsi al launcher `Gaia`

## Fonti ufficiali rilevanti

| Fonte | Lettura operativa |
| --- | --- |
| [Anagrafe Regionale degli assistiti e delle strutture](https://www.siss.regione.lombardia.it/wps/portal/site/siss/il-sistema-informativo-socio-sanitario/principali-servizi-offerti/anagrafe-regionale-degli-assistiti-e-delle-strutture) | NAR e fonte delle basi dati anagrafiche locali, include esenzioni/ticket, medici prescrittori e ricettari assegnati. |
| [Modello Architetturale SISS](https://www.siss.regione.lombardia.it/wps/portal/site/siss/il-sistema-informativo-socio-sanitario/piattaforma-siss/Modello-architetturale) | Il SISS distingue fruizione A2A, Web Application e componenti di sicurezza come Porta Delegata/Applicativa; il solo modello non basta a provare un servizio NAR consumabile da MediFlow. |
| [FAQ SISS su esenzioni / Identifica Cittadino](https://www.siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/faq.do?voce=28685767) | Le FAQ citano servizi come `Identifica Cittadino` e `Classe di Esenzione`, utili come indizi di capability applicative ma non come specifica completa. |
| [Documentazione SISS - Gestione Anagrafe / iscrizione Assistiti](https://siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/documentoDiProgetto.do?ACT=1&PR=21) | Il catalogo pubblico indicizza manuali Gaia/gestione assistiti, da acquisire come `manual-import` prima di progettare un contratto. |
| [Documentazione SISS - GAMS Gestione Anagrafe Medici Specialisti](https://siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/documentoDiProgetto.do?ACT=1&PR=10) | Il catalogo pubblico indicizza il dominio medici specialisti/prescrittori, rilevante per contesto prescrittivo ma non sufficiente a un runtime. |

## Capability matrix

| Capability | Stato | Dati minimi ammessi | Note |
| --- | --- | --- | --- |
| Lookup assistito per CF | `candidate-read-only` | esito match, CF normalizzato, eventuale identificatore regionale opaco, timestamp fonte | Nessun merge automatico con la scheda paziente; solo pre-check reviewable. |
| Verifica posizione / eligibility | `candidate-read-only` | stato assistito sintetico, ATS/ambito se previsto, reason code redatto | Serve specifica ufficiale: evitare interpretazioni cliniche o amministrative non documentate. |
| Esenzioni / classe di esenzione | `candidate-read-only` | codici esenzione necessari al flusso prescrittivo, validita se prevista | Gia esiste catalogo locale esenzioni; NAR non deve diventare sync massiva. |
| Medico prescrittore | `metadata-only` | identificatore prescrittore, ruolo/contesto, stato abilitazione se previsto | Utile per readiness prescrittiva, non per gestione anagrafica del medico. |
| Ricettari assegnati | `metadata-only` | presenza/validita contesto ricettario, non elenco completo salvo specifica | Il dato e operativo e sensibile: non salvarlo come inventario locale permanente. |
| Scrittura anagrafica, scelta/revoca, gestione specialisti | `out-of-scope` | nessuno | Resta dentro Gaia/SISS o in futuri scenari autorizzati; MediFlow non deve scrivere su NAR. |
| Cache o replica anagrafe regionale | `blocked` | nessuno | Incompatibile con minimizzazione e local-first prudente senza contratto esplicito. |

## Contract locale proposto

Il primo contratto deve essere interno e read-only. Shape indicativa:

```ts
type NarReadOnlyLookupRequest = {
  fiscalCode: string;
  purpose: 'prescription-readiness' | 'registry-context';
  operatorContext: 'current-siss-session';
  correlationId: string;
};

type NarReadOnlyLookupResult =
  | { status: 'not-configured'; reason: string }
  | { status: 'unauthorized'; reason: string }
  | { status: 'unavailable'; reason: string; retryable: boolean }
  | { status: 'not-found'; source: 'nar' }
  | { status: 'ambiguous'; source: 'nar'; candidates: number }
  | {
      status: 'verified';
      source: 'nar';
      verifiedAt: string;
      patient: {
        fiscalCode: string;
        registryId?: string;
      };
      eligibility?: {
        status: 'active' | 'inactive' | 'unknown';
        reasonCode?: string;
      };
      exemptions?: Array<{
        code: string;
        validUntil?: string;
      }>;
      prescriberContext?: {
        role: string;
        recipeBookStatus?: 'present' | 'missing' | 'unknown';
      };
    };
```

Regole:

- non salvare automaticamente dati NAR nella scheda paziente
- non importare dati anagrafici reali nei test o nelle fixture
- audit locale solo con correlation id, action, esito, modulo e reason code
  redatto
- UI e persistence sono follow-up separati dopo contratto e specifiche

## Failure taxonomy

| Codice | Significato | Comportamento MediFlow |
| --- | --- | --- |
| `not-configured` | Mancano credenziali/canale NAR | Mostrare handoff Gaia, nessun retry automatico. |
| `unauthorized` | Ruolo, sessione o operatore non autorizzati | Restare nel percorso ufficiale SISS. |
| `not-found` | CF non risolto su NAR | Non creare/modificare paziente; chiedere review operatore. |
| `ambiguous` | Piu posizioni o identita non univoca | Bloccare automazioni e rimandare a Gaia. |
| `unavailable` | Servizio o rete non disponibili | Degradare a handoff, registrando solo evento PHI-safe. |
| `schema-drift` | Risposta non conforme al contratto atteso | Fail closed; aprire follow-up tecnico. |

## Adapter recommendation

Usare la stessa famiglia di adapter SISS, non un'integrazione isolata:

- condivide autenticazione, sessione operatore, audit e boundary `SSI`
- evita un secondo canale regionale parallelo non governato
- mantiene pero un modulo `registry/nar` separato per contract, failure
  taxonomy e test sintetici

In pratica: `sissAdapter.registry.readOnlyLookup(...)`, non una nuova area
runtime sganciata da SISS.

## Prima thin slice raccomandata

`NAR read-only contract fixture`

Forma:

- import autorizzato fuori Git dei manuali Gaia/NAR rilevanti
- contract TypeScript interno con fixture sintetiche
- test della failure taxonomy e della minimizzazione audit
- nessuna chiamata reale a SISS
- nessuna UI definitiva
- nessuna scrittura su paziente

Exit criteria:

1. sorgenti NAR tracciate nel manifest corpus
2. contratto read-only reviewato contro specifiche ufficiali
3. failure taxonomy coperta da test sintetici
4. decisione esplicita prima di qualunque runtime NAR reale

## Decisione operativa

Per MediFlow, oggi, il target corretto e:

- `portal-handoff Gaia` disponibile ora
- `NAR read-only contract fixture` come prima slice tecnica

e non:

- sync locale dell'anagrafe regionale
- write verso scelta/revoca o gestione assistiti
- inventario locale dei ricettari
- UI custom NAR prima di specifiche, qualifica e test ufficiale

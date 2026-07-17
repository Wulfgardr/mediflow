---
summary: "Baseline riproducibile delle route list principali su 200 e 2000 pazienti sintetici."
read_when:
  - "Confrontando una modifica alle query list, agli allegati o alla decifratura client con numeri misurati."
  - "Ripetendo il benchmark di patients, entries, observations e documents su una macchina locale."
---

# Baseline performance delle route list

Data misura: 17 luglio 2026, 15:28 CEST

Base runtime: `origin/main` a `d09c949a35b1326a7528bd6d24f4bc96bceaf845`

Tooling benchmark: `7d9ce0f51e5851a3850d99fbb220c92b0be910f0`

Questa baseline misura le route list reali su un database SQLite interamente
sintetico. Non contiene dati derivati da pazienti reali. Il seed usa
identificativi, timestamp, volumi e ciphertext deterministici; due rigenerazioni
con la stessa configurazione hanno prodotto lo stesso hash del file SQLite.

I campioni grezzi sono in
[`2026-07-17-baseline-performance.json`](./2026-07-17-baseline-performance.json).

## Ambiente

| Voce | Valore |
| --- | --- |
| Hardware | Mac16,5, Apple M4 Max, 14 core logici |
| Memoria | 36 GiB |
| Sistema | Darwin 27.0.0, arm64 |
| Node.js | v24.18.0 |
| Server | build Next.js 16.2.6, server production standalone |
| Trasporto | HTTP locale su `127.0.0.1:3113` |

La build ha completato con i warning NFT gia presenti sul trace dinamico di
`athena-mlx-runtime.ts`. Il benchmark non modifica quel codice e non usa la
route MLX.

## Protocollo

- Volumi: 200 e 2000 pazienti.
- Per paziente: 8 voci di diario, 6 osservazioni e 2 documenti.
- Seed fisso: `mediflow-performance-2026-07-17`.
- Route: `/api/patients`, `/api/entries`, `/api/observations` e
  `/api/attachments?metadataOnly=true`.
- La route documenti usa il nome runtime `attachments` e la modalita metadata:
  il payload base64 del file non viene trasferito.
- Per ogni route: 1 warmup escluso e 7 campioni misurati.
- Statistica di confronto: mediana.
- Tempo route: da prima della `fetch` al completamento della lettura del body.
- Costo client simulato: `JSON.parse` del body e AES-256-GCM in Node per ogni
  campo `ENC:`. Non include rendering React o lavoro del browser oltre questi
  due passaggi.
- Ogni volume usa un database rigenerato e un processo server nuovo.
- La porta dedicata viene controllata prima di creare dati o avviare la build;
  se e occupata, lo script fallisce chiuso.

## Risultati

| Pazienti | Route | Record | Payload | Route mediana | Parse e decifratura mediana |
| ---: | --- | ---: | ---: | ---: | ---: |
| 200 | patients | 200 | 229.581 B (0,219 MiB) | 5,075 ms | 11,600 ms |
| 200 | entries | 1.600 | 1.018.401 B (0,971 MiB) | 9,284 ms | 47,980 ms |
| 200 | observations | 1.200 | 694.941 B (0,663 MiB) | 8,205 ms | 12,741 ms |
| 200 | documents | 400 | 350.283 B (0,334 MiB) | 4,737 ms | 16,095 ms |
| 2.000 | patients | 2.000 | 2.299.401 B (2,193 MiB) | 16,435 ms | 118,780 ms |
| 2.000 | entries | 16.000 | 10.184.001 B (9,712 MiB) | 66,328 ms | 436,633 ms |
| 2.000 | observations | 12.000 | 6.949.941 B (6,628 MiB) | 57,014 ms | 135,597 ms |
| 2.000 | documents | 4.000 | 3.497.020 B (3,335 MiB) | 21,523 ms | 161,275 ms |

## Lettura dei numeri

Il problema macroscopico osservato e il trasferimento delle liste globali non
paginate. A 2000 pazienti, `entries` restituisce 16.000 record e 9,712 MiB in
una singola risposta. Il tempo server e trasporto resta sotto 70 ms sulla
macchina di prova, ma parsing e decifratura simulata raggiungono una mediana di
436,633 ms. Anche `observations` e `documents` trasferiscono rispettivamente
6,628 MiB e 3,335 MiB.

La baseline non dimostra da sola quale ottimizzazione adottare. Fornisce il
numero di confronto per future modifiche a paginazione, query pushdown,
metadata degli allegati o strategia di decifratura. Questa lane non modifica
codice di produzione.

## Replica esatta

Da un checkout pulito del commit del tooling indicato sopra:

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
npm ci
npm run benchmark:list-routes
```

Il comando:

1. rigenera `tmp-perf/p200/medical.db` e `tmp-perf/p2000/medical.db`;
2. crea una build production isolata in `.next-performance-baseline`;
3. misura le quattro route su `127.0.0.1:3113`;
4. sovrascrive il JSON grezzo accanto a questo documento;
5. ripristina `tsconfig.json` e rimuove l'output build isolato.

Per verificare soltanto il seed con un volume diverso:

```bash
npm run seed:performance-baseline -- \
  --data-dir "$PWD/tmp-perf/manual-p500" \
  --patients 500 \
  --force
```

I tempi assoluti dipendono da hardware, carico macchina, versione del sistema e
cache del filesystem. I confronti futuri devono usare lo stesso protocollo e
riportare ambiente, commit e campioni grezzi.

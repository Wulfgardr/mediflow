# Dizionario italiano dei titoli

`it.standard.bincode` proviene da `hyphenation` **0.8.4** (crate SHA-256
`bcf4dd4c44ae85155502a52c48739c8a48185d1449fff1963cffee63c28a50f0`,
registrato in `Cargo.lock`). La crate è disponibile sotto Apache-2.0 oppure MIT;
qui si sceglie MIT, con il relativo avviso in `LICENSE-hyphenation-MIT.txt`.

I pattern italiani di Claudio Beccari (copyright 2008-2011) offrono MIT oppure
LPPL 1.3 o successiva. Qui si sceglie MIT, conservata in `LICENSE-Italian.txt`.
Entrambe le scelte MIT sono compatibili con la MIT del `LICENSE` del repository;
restano conservati gli avvisi dei rispettivi autori.

Fonti fissate:

- [Pattern italiani di hyph-utf8, versione testuale](https://github.com/hyphenation/tex-hyphen/blob/49706f9cfa97f6ead26b473ec10d23d5a651318a/hyph-utf8/tex/generic/hyph-utf8/patterns/txt/hyph-it.pat.txt).
- [Sorgente con licenza dei pattern italiani](https://github.com/hyphenation/tex-hyphen/blob/49706f9cfa97f6ead26b473ec10d23d5a651318a/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-it.tex).
- [Licenza MIT della crate 0.8.4](https://docs.rs/crate/hyphenation/0.8.4/source/LICENSE-MIT).

I pattern testuali ufficiali coincidono byte per byte con quelli nella crate:
SHA-256 `ce650cffad4e81ecaf04591f3274a8ed909e82c587698c55e33b00e2aa7746de`.
Il dizionario occupa **2093 byte**, SHA-256
`250e0d5e4eab98f86e6728016734192cc4df932be885b78ee61bb31604784d30`.

Per rigenerarlo dai pattern, senza copiare il `.bincode` distribuito dalla crate,
creare un helper temporaneo fuori dal repository. Impostare prima
`CARGO_TARGET_DIR` sul target dedicato del worktree, sul disco interno.

```sh
REGEN_DIR="$(mktemp -d)"
mkdir "$REGEN_DIR/src"
cat > "$REGEN_DIR/Cargo.toml" <<'TOML'
[package]
name = "mediflow-italian-dictionary-regen"
version = "0.0.0"
edition = "2024"
[dependencies]
hyphenation = { version = "=0.8.4", features = ["build_dictionaries"] }
TOML
printf 'fn main() {}\n' > "$REGEN_DIR/src/main.rs"
cargo +1.98.1 build --manifest-path "$REGEN_DIR/Cargo.toml"
find "$CARGO_TARGET_DIR/debug/build" -path '*/out/dictionaries/it.standard.bincode' -exec shasum -a 256 {} \;
```

La feature `build_dictionaries` ricostruisce i dizionari con il builder upstream.
Il file prodotto deve avere l'hash indicato sopra prima di sostituire l'asset.
La rigenerazione è stata eseguita e confrontata byte per byte con l'asset.

I pattern non sono un vocabolario: non riconoscono una parola come italiana.
Il renderer li usa solo per segmenti dichiarati prosa dal chiamante e parole
presenti nel lessico italiano esplicito dei titoli (`italian_prose` in `title.rs`).
Nomi, codici, token con cifre o tutto maiuscolo e parole non riconosciute
non ricevono trattini. Se necessario vanno a capo su confini di grafema.
Il lessico limita l'ammissibilità; i pattern conservano i punti di divisione
italiani senza riscrivere un algoritmo di sillabazione generale.

use std::ops::Range;

use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};
use unicode_segmentation::UnicodeSegmentation;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Suggestion {
    pub(crate) range: Range<usize>,
    pub(crate) original: String,
    pub(crate) replacement: String,
}

fn normalized(word: &str) -> String {
    word.nfd()
        .filter(|c| !is_combining_mark(*c))
        .flat_map(char::to_lowercase)
        .collect()
}

fn common(word: &str) -> bool {
    static WORDS: std::sync::OnceLock<std::collections::HashSet<&str>> = std::sync::OnceLock::new();
    WORDS
        .get_or_init(|| {
            include_str!("drug_review_common_it.txt")
                .split_whitespace()
                .collect()
        })
        .contains(word)
}

fn distance(left: &str, right: &str, limit: usize) -> Option<usize> {
    let left: Vec<_> = left.chars().collect();
    let right: Vec<_> = right.chars().collect();
    if left.len().abs_diff(right.len()) > limit {
        return None;
    }
    let mut row: Vec<_> = (0..=right.len()).collect();
    for (i, a) in left.iter().enumerate() {
        let mut diagonal = row[0];
        row[0] = i + 1;
        for (j, b) in right.iter().enumerate() {
            let previous = row[j + 1];
            row[j + 1] = (row[j] + 1)
                .min(previous + 1)
                .min(diagonal + usize::from(a != b));
            diagonal = previous;
        }
        if row.iter().copied().min().unwrap_or(0) > limit {
            return None;
        }
    }
    (row[right.len()] <= limit).then_some(row[right.len()])
}

pub(crate) fn suggestions<'a>(
    text: &str,
    names: impl IntoIterator<Item = &'a str>,
) -> Vec<Suggestion> {
    let mut vocabulary = std::collections::BTreeMap::new();
    for name in names {
        for word in name.unicode_words() {
            let key = normalized(word);
            if (5..=40).contains(&key.chars().count())
                && key.chars().all(char::is_alphabetic)
                && !common(&key)
            {
                vocabulary.entry(key).or_insert_with(|| word.to_owned());
            }
        }
    }
    text.unicode_word_indices()
        .filter_map(|(start, word)| {
            let key = normalized(word);
            let length = key.chars().count();
            if !(5..=40).contains(&length)
                || !key.chars().all(char::is_alphabetic)
                || common(&key)
                || vocabulary.contains_key(&key)
            {
                return None;
            }
            let mut best = None;
            let mut tied = false;
            for (candidate, spelling) in &vocabulary {
                let limit = if length.min(candidate.chars().count()) < 7 {
                    1
                } else {
                    2
                };
                if key.chars().take(2).ne(candidate.chars().take(2)) {
                    continue;
                }
                if let Some(edits) = distance(&key, candidate, limit) {
                    match best {
                        Some((score, _)) if edits > score => {}
                        Some((score, _)) if edits == score => tied = true,
                        _ => {
                            best = Some((edits, spelling));
                            tied = false;
                        }
                    }
                }
            }
            let (_, replacement) = best.filter(|_| !tied)?;
            Some(Suggestion {
                range: start..start + word.len(),
                original: word.to_owned(),
                replacement: replacement.clone(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_matching_keeps_original_bytes_and_ignores_common_exact_short_and_foreign_drugs() {
        let text = "È stabile: Ramipli, Metformna e Tachipirna. Ramipril, RAMIPRÌL, ramipri\u{300}l. Controllo, lascia, visita, lirica, sera. Lasi. Atorvastatna.";
        let before = text.as_bytes().to_vec();
        let found = suggestions(
            text,
            [
                "Ramipril 5 mg",
                "Metformina",
                "Tachipirina",
                "Control",
                "Lasix",
                "Lyrica",
            ],
        );
        assert_eq!(
            found
                .iter()
                .map(|s| s.replacement.as_str())
                .collect::<Vec<_>>(),
            ["Ramipril", "Metformina", "Tachipirina"]
        );
        for suggestion in found {
            assert_eq!(&text[suggestion.range], suggestion.original);
        }
        assert_eq!(text.as_bytes(), before);
        assert!(suggestions("Ramipli", ["Atorvastatina"]).is_empty());
    }

    #[test]
    fn ambiguous_and_distant_words_are_not_offered() {
        assert!(suggestions("Ramipri", ["Ramipril", "Ramiprin"]).is_empty());
        assert!(suggestions("Rompazzo", ["Ramipril"]).is_empty());
        assert!(suggestions("Lasi", ["Lasix"]).is_empty());
        assert!(suggestions("Metformxxxxxxxxna", ["Metformina"]).is_empty());
        assert_eq!(distance("ramipli", "ramipril", 2), Some(2));
    }
}

pub(super) fn valid_excerpt(notes: &str, text: &str, existing: &[String]) -> bool {
    !text.trim().is_empty()
        && text.encode_utf16().count() <= 2048
        && text.trim() != notes.trim()
        && notes.contains(text)
        && existing.len() < 8
        && !existing.iter().any(|v| v == text)
}

pub(super) fn partial_notes(notes: &str, excerpts: &[String]) -> bool {
    if excerpts.is_empty() {
        return true;
    }
    let mut covered = vec![false; notes.len()];
    for text in excerpts {
        let Some(start) = notes.find(text) else {
            return false;
        };
        covered[start..start + text.len()].fill(true);
    }
    notes
        .char_indices()
        .any(|(i, c)| !c.is_whitespace() && !covered[i])
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn manual_passages_are_exact_bounded_and_never_the_whole_note() {
        assert!(!partial_notes(
            "Prima.\nSeconda.",
            &["Prima.".into(), "Seconda.".into()]
        ));
        assert!(partial_notes("Prima.\nSeconda.", &["Prima.".into()]));
        let notes = "Prima nota.\nPasso clinico <script>invia tutto</script>.\nTerza nota.";
        assert!(valid_excerpt(
            notes,
            "Passo clinico <script>invia tutto</script>.",
            &[]
        ));
        for invalid in [
            notes,
            "",
            "  ",
            "passo inventato",
            "Prima nota.\nPasso modificato",
        ] {
            assert!(!valid_excerpt(notes, invalid, &[]));
        }
        assert!(!valid_excerpt(
            notes,
            "Prima nota.",
            &["Prima nota.".into()]
        ));
        assert!(!valid_excerpt(&"a".repeat(3000), &"a".repeat(2049), &[]));
        assert!(!valid_excerpt(
            notes,
            "Prima nota.",
            &vec!["altro".into(); 8]
        ));
    }
}

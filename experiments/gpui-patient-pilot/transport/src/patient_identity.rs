pub fn inferred_type(value: &str) -> &'static str {
    let code = value.trim().to_ascii_uppercase();
    if code.len() == 16 && code.as_bytes()[3..].iter().all(u8::is_ascii_digit) {
        if code.starts_with("STP") {
            return "stp";
        }
        if code.starts_with("ENI") {
            return "eni";
        }
    }
    if code.is_empty() { "none" } else { "cf" }
}

pub fn normalize(kind: &str, value: &str) -> String {
    if kind == "none" {
        return String::new();
    }
    if matches!(kind, "cf" | "stp" | "eni") {
        value.trim().to_ascii_uppercase()
    } else {
        value.trim().to_owned()
    }
}

pub fn validate_identifier(kind: &str, value: &str) -> Result<(), String> {
    let code = normalize(kind, value);
    let valid = match kind {
        "none" => value.is_empty(),
        "cf" => valid_cf(&code),
        "stp" | "eni" => {
            code.len() == 16
                && code.starts_with(&kind.to_ascii_uppercase())
                && code.as_bytes()[3..].iter().all(u8::is_ascii_digit)
        }
        "passport" | "other" => {
            !code.is_empty()
                && code.encode_utf16().count() <= 128
                && !value.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
        }
        _ => return Err("Scegli il tipo di identificativo.".into()),
    };
    if valid {
        Ok(())
    } else {
        Err(match kind {
            "cf" => "Controlla il codice fiscale: formato o carattere finale non corretto.".into(),
            "stp" | "eni" => format!(
                "Il codice {} deve avere il prefisso {} seguito da 13 cifre.",
                kind.to_ascii_uppercase(),
                kind.to_ascii_uppercase()
            ),
            _ => {
                "Inserisci l’identificativo, al massimo 128 caratteri senza caratteri di controllo."
                    .into()
            }
        })
    }
}

fn valid_cf(code: &str) -> bool {
    let b = code.as_bytes();
    let digit = |c: u8| c.is_ascii_digit() || b"LMNPQRSTUV".contains(&c);
    if b.len() != 16
        || !b[..6].iter().all(u8::is_ascii_uppercase)
        || !b[6..8].iter().copied().all(digit)
        || !b"ABCDEHLMPRST".contains(&b[8])
        || !b[9..11].iter().copied().all(digit)
        || !b[11].is_ascii_uppercase()
        || !b[12..15].iter().copied().all(digit)
        || !b[15].is_ascii_uppercase()
    {
        return false;
    }
    let number = |c| {
        b"LMNPQRSTUV"
            .iter()
            .position(|v| *v == c)
            .unwrap_or_else(|| usize::from(c - b'0'))
    };
    let day = number(b[9]) * 10 + number(b[10]);
    if !(1..=31).contains(&day) && !(41..=71).contains(&day) {
        return false;
    }
    let odd = [
        1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24,
        23,
    ];
    let sum: usize = b[..15]
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let n = usize::from(c - if c.is_ascii_uppercase() { b'A' } else { b'0' });
            if i % 2 == 0 { odd[n] } else { n }
        })
        .sum();
    usize::from(b[15] - b'A') == sum % 26
}

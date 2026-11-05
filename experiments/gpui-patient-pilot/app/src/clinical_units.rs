//! Unità di misura come le legge un medico. Il codice UCUM registrato non cambia:
//! cambia solo la lettura. Stessa regola di `formatUnitForDisplay`
//! (`lib/terminology.ts`) e di `ClinicalUnitDisplay` (MediFlowCore, Swift); i casi
//! dei test sono gli stessi sulle tre piattaforme.

const CATALOG: &[(&str, &str)] = &[
    ("mm[Hg]", "mmHg"),
    ("/min", "/min"),
    ("%", "%"),
    ("Cel", "°C"),
    ("kg", "kg"),
    ("mg/dL", "mg/dL"),
    ("g/dL", "g/dL"),
    ("mmol/L", "mmol/L"),
    ("U/L", "U/L"),
    ("fL", "fL"),
    ("pg", "pg"),
    ("10*3/uL", "×10³/µL"),
    ("10*6/uL", "×10⁶/µL"),
];

fn superscript(ch: char) -> char {
    match ch {
        '0' => '⁰', '1' => '¹', '2' => '²', '3' => '³', '4' => '⁴',
        '5' => '⁵', '6' => '⁶', '7' => '⁷', '8' => '⁸', '9' => '⁹', '-' => '⁻',
        other => other,
    }
}

pub fn unit(code: &str) -> String {
    let code = code.trim();
    if code.is_empty() {
        return String::new();
    }
    if let Some((_, display)) = CATALOG.iter().find(|(known, _)| *known == code) {
        return (*display).to_string();
    }
    // primo passo: annotazioni {…} (graffe tolte, «_» come spazio, virgola
    // decimale) e parentesi quadre tolte; secondo passo: potenze, esponenti, micro.
    let chars: Vec<char> = code.chars().collect();
    let mut plain: Vec<char> = Vec::new();
    let mut in_annotation = false;
    for (k, &c) in chars.iter().enumerate() {
        match c {
            '{' => in_annotation = true,
            '}' => in_annotation = false,
            '[' | ']' => {}
            '_' if in_annotation => plain.push(' '),
            '.' if in_annotation
                && k > 0 && chars[k - 1].is_ascii_digit()
                && chars.get(k + 1).is_some_and(|n| n.is_ascii_digit()) => plain.push(','),
            other => plain.push(other),
        }
    }
    let chars = plain;
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        match ch {
            // potenza di dieci 10*n
            '1' if chars.get(i + 1) == Some(&'0') && chars.get(i + 2) == Some(&'*') => {
                out.push_str("×10");
                i += 3;
                while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '-') {
                    out.push(superscript(chars[i]));
                    i += 1;
                }
                continue;
            }
            // micro: «u» davanti a g, L, l, m alla fine o prima di un separatore
            'u' if (i == 0 || !chars[i - 1].is_ascii_alphabetic())
                && chars.get(i + 1).is_some_and(|n| matches!(n, 'g' | 'L' | 'l' | 'm'))
                && chars.get(i + 2).is_none_or(|n| !n.is_ascii_alphanumeric()) => out.push('µ'),
            // esponente: cifra singola dopo una lettera (m2 → m²)
            d if d.is_ascii_digit()
                && i > 0 && chars[i - 1].is_ascii_alphabetic()
                && chars.get(i + 1).is_none_or(|n| !n.is_ascii_digit() && *n != '.' && *n != ',') => out.push(superscript(d)),
            other => out.push(other),
        }
        i += 1;
    }
    out
}

/// Valore con unità leggibile. Un valore senza cifre («non rilevabile») non riceve
/// unità; uno con cifre la conserva anche se non è un numero solo («130/80»). La
/// virgola decimale vale solo per i numeri singoli.
pub fn value(value: &str, unit_code: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if !trimmed.chars().any(|c| c.is_ascii_digit()) {
        return value.to_string();
    }
    let digits = trimmed.strip_prefix('-').unwrap_or(trimmed);
    let mut parts = digits.splitn(2, ['.', ',']);
    let single = parts.next().is_some_and(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
        && parts.next().is_none_or(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()));
    let number = if single { trimmed.replace('.', ",") } else { trimmed.to_string() };
    let unit = unit(unit_code);
    if unit.is_empty() { number } else { format!("{number} {unit}") }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_units_read_as_a_clinician_would() {
        assert_eq!(unit("mm[Hg]"), "mmHg");
        assert_eq!(unit("Cel"), "°C");
        assert_eq!(unit("10*3/uL"), "×10³/µL");
        assert_eq!(unit("/min"), "/min");
        assert_eq!(unit(""), "");
    }

    #[test]
    fn unknown_units_are_rendered_prudently() {
        assert_eq!(unit("mL/min/{1.73_m2}"), "mL/min/1,73 m²");
        assert_eq!(unit("ug/L"), "µg/L");
    }

    #[test]
    fn value_with_unit() {
        assert_eq!(value("37.5", "Cel"), "37,5 °C");
        assert_eq!(value("130", "mm[Hg]"), "130 mmHg");
        assert_eq!(value("130/80", "mm[Hg]"), "130/80 mmHg");
        assert_eq!(value("non rilevabile", "kg"), "non rilevabile");
    }
}

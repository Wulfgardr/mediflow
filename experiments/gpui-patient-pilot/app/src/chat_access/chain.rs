pub(super) const MAX_ANCESTORS: usize = 24;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(C)]
pub(super) struct Process {
    pub pid: i32,
    pub parent: i32,
    pub start_sec: u64,
    pub start_usec: u64,
    pub host_kind: i32,
    pub team: i32,
    pub hash: [u8; 32],
    pub hash_length: u32,
    pub executable: [u8; 256],
}

impl Default for Process {
    fn default() -> Self {
        Self {
            pid: 0,
            parent: 0,
            start_sec: 0,
            start_usec: 0,
            host_kind: 0,
            team: 0,
            hash: [0; 32],
            hash_length: 0,
            executable: [0; 256],
        }
    }
}

impl Process {
    fn name(&self) -> String {
        let end = self.executable.iter().position(|b| *b == 0).unwrap_or(256);
        String::from_utf8_lossy(&self.executable[..end])
            .chars()
            .map(|c| if c.is_control() { '?' } else { c })
            .collect()
    }
}

#[cfg(any(target_os = "macos", test))]
#[derive(Debug, PartialEq, Eq)]
pub(super) enum Denial {
    MissingHost,
    TooDeep,
    Interpreter,
    UntrustedLink,
    Incomplete,
}

#[cfg(any(target_os = "macos", test))]
impl Denial {
    pub(super) fn reason(&self) -> &'static str {
        match self {
            Self::MissingHost => "host firmato assente",
            Self::TooDeep => "host non raggiunto entro 24 antenati",
            Self::Interpreter => "shell o interprete nella catena",
            Self::UntrustedLink => {
                "processo intermedio senza firma Developer ID dello stesso team dell'host"
            }
            Self::Incomplete => "catena di processi incompleta o modificata",
        }
    }
}

#[cfg(any(target_os = "macos", test))]
pub(super) fn evaluate(chain: &[Process]) -> Result<(), Denial> {
    if chain.len() > MAX_ANCESTORS {
        return Err(Denial::TooDeep);
    }
    let Some(host_index) = chain.iter().position(|p| matches!(p.host_kind, 1 | 2)) else {
        return Err(if chain.len() == MAX_ANCESTORS {
            Denial::TooDeep
        } else {
            Denial::MissingHost
        });
    };
    let host = &chain[host_index];
    if host_index + 1 != chain.len()
        || host.team != host.host_kind
        || chain.windows(2).any(|pair| pair[0].parent != pair[1].pid)
    {
        return Err(Denial::Incomplete);
    }
    for link in &chain[..host_index] {
        if interpreter(&link.name()) {
            return Err(Denial::Interpreter);
        }
        if link.team != host.team {
            return Err(Denial::UntrustedLink);
        }
    }
    Ok(())
}

#[cfg(any(target_os = "macos", test))]
fn interpreter(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    [
        "sh",
        "bash",
        "zsh",
        "fish",
        "dash",
        "env",
        "python",
        "pythonw",
        "node",
        "nodejs",
        "perl",
        "ruby",
        "osascript",
    ]
    .iter()
    .any(|base| {
        name.strip_prefix(base).is_some_and(|suffix| {
            suffix.is_empty()
                || suffix.starts_with(|c: char| c.is_ascii_digit() || c == '-' || c == '.')
        })
    })
}

pub(super) fn summary(chain: &[Process]) -> String {
    let opener = chain
        .first()
        .map(|p| format!("{} (PID {})", p.name(), p.pid))
        .unwrap_or_else(|| "non disponibile".into());
    let links = chain
        .iter()
        .map(|p| format!("{} (PID {})", p.name(), p.pid))
        .collect::<Vec<_>>()
        .join(" → ");
    format!("Processo apritore: {opener}\nCatena verso l'host: {links}")
}

#[cfg(any(target_os = "macos", test))]
pub(super) fn log_record(chain: &[Process], decision: &Result<(), Denial>) -> String {
    let outcome = match decision {
        Ok(()) => "accettato".to_owned(),
        Err(reason) => format!("rifiutato: {}", reason.reason()),
    };
    format!(
        "Attestazione chat: {outcome}; {}",
        summary(chain).replace('\n', "; ")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn process(name: &str, pid: i32, team: i32, host_kind: i32) -> Process {
        let mut p = Process {
            pid,
            parent: pid + 1,
            team,
            host_kind,
            ..Process::default()
        };
        p.executable[..name.len()].copy_from_slice(name.as_bytes());
        p
    }
    fn host(team: i32) -> Process {
        process("Host", 100, team, team)
    }

    #[test]
    fn direct_host_and_same_team_helper_are_accepted() {
        for team in [1, 2] {
            assert_eq!(evaluate(&[host(team)]), Ok(()));
            let helper = Process {
                parent: 100,
                ..process("SignedHelper", 99, team, 0)
            };
            assert_eq!(evaluate(&[helper, host(team)]), Ok(()));
        }
    }

    #[test]
    fn shell_and_interpreter_descendants_are_denied_before_a_grant() {
        for team in [0, 1, 2] {
            for name in [
                "sh",
                "bash",
                "zsh",
                "fish",
                "dash",
                "env",
                "python",
                "python3.14",
                "node",
                "nodejs",
                "perl",
                "ruby",
                "osascript",
            ] {
                let opener = Process {
                    parent: 100,
                    ..process(name, 99, team, 0)
                };
                assert_eq!(
                    evaluate(&[opener, host(1)]),
                    Err(Denial::Interpreter),
                    "{name}"
                );
                let helper = Process {
                    parent: 99,
                    ..process("SignedHelper", 98, 1, 0)
                };
                assert_eq!(
                    evaluate(&[helper, opener, host(1)]),
                    Err(Denial::Interpreter),
                    "{name}"
                );
            }
        }
    }

    #[test]
    fn unsigned_ad_hoc_and_other_team_links_are_denied() {
        for host_team in [1, 2] {
            for team in [0, 3 - host_team] {
                let opener = Process {
                    parent: 100,
                    ..process("UnknownHelper", 99, team, 0)
                };
                assert_eq!(
                    evaluate(&[opener, host(host_team)]),
                    Err(Denial::UntrustedLink)
                );
            }
        }
    }

    #[test]
    fn missing_host_broken_chain_and_depth_overflow_are_denied() {
        assert_eq!(evaluate(&[]), Err(Denial::MissingHost));
        assert_eq!(
            evaluate(&[process("Helper", 99, 1, 0)]),
            Err(Denial::MissingHost)
        );
        assert_eq!(
            evaluate(&[process("Helper", 90, 1, 0), host(1)]),
            Err(Denial::Incomplete)
        );
        let mut chain = (0..MAX_ANCESTORS)
            .map(|i| process("Helper", i as i32 + 76, 1, 0))
            .collect::<Vec<_>>();
        assert_eq!(evaluate(&chain), Err(Denial::TooDeep));
        chain[MAX_ANCESTORS - 1] = host(1);
        chain[MAX_ANCESTORS - 2].parent = 100;
        assert_eq!(evaluate(&chain), Ok(()));
        chain.push(host(1));
        assert_eq!(evaluate(&chain), Err(Denial::TooDeep));
    }

    #[test]
    fn opener_and_full_chain_are_visible_in_summary_and_log() {
        let opener = Process {
            parent: 100,
            ..process("SignedHelper", 99, 1, 0)
        };
        let chain = [opener, host(1)];
        for text in [summary(&chain), log_record(&chain, &evaluate(&chain))] {
            assert!(text.contains("SignedHelper (PID 99)"));
            assert!(text.contains("Host (PID 100)"));
            assert!(text.find("SignedHelper").unwrap() < text.find("Host").unwrap());
        }
        let denied = log_record(&chain, &Err(Denial::UntrustedLink));
        assert!(denied.contains(Denial::UntrustedLink.reason()));
    }
}

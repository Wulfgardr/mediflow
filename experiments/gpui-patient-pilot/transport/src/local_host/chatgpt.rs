use super::*;
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AccountState {
    Unavailable,
    Disconnected,
    Starting,
    AwaitingLogin,
    Verifying,
    Connected,
    Error,
}
impl AccountState {
    pub fn title(self) -> &'static str {
        match self {
            Self::Unavailable => "Da configurare",
            Self::Disconnected => "Non collegato",
            Self::Starting => "Avvio accesso",
            Self::AwaitingLogin => "Accesso in attesa",
            Self::Verifying => "Da verificare",
            Self::Connected => "Account collegato",
            Self::Error => "Collegamento interrotto",
        }
    }
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatGptAccountStatus {
    pub state: AccountState,
    pub notice: Option<String>,
    pub plan: Option<String>,
    pub login_expires_at: Option<u64>,
    pub actions: Vec<String>,
    inference_enabled: bool,
    execution_block: String,
}
impl ChatGptAccountStatus {
    fn parse(value: Value) -> Result<Self> {
        let status: Self =
            serde_json::from_value(value).map_err(|_| RuntimeError::InvalidResponse)?;
        if status
            .login_expires_at
            .is_some_and(|n| n == 0 || n > crate::MAX_SAFE_VERSION)
            || status.inference_enabled
            || status.execution_block != "data_boundary_unqualified"
            || status.plan.as_ref().is_some_and(|p| {
                p.is_empty()
                    || p.len() > 60
                    || !p
                        .bytes()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_')
            })
            || status.actions.iter().any(|s| {
                !matches!(
                    s.as_str(),
                    "connect"
                        | "cancel_login"
                        | "complete_login"
                        | "refresh_account"
                        | "read_models"
                        | "read_rate_limits"
                        | "logout"
                        | "configure_host"
                )
            })
            || status.notice.as_ref().is_some_and(|n| {
                !matches!(
                    n.as_str(),
                    "host_unavailable"
                        | "timeout"
                        | "protocol_error"
                        | "process_exited"
                        | "login_failed"
                        | "login_expired"
                        | "canceled"
                        | "logout_unconfirmed"
                        | "busy"
                        | "session_expired"
                        | "invalid_state"
                )
            })
        {
            return Err(RuntimeError::InvalidResponse);
        }
        Ok(status)
    }
    pub fn allows(&self, operation: ChatGptAccountOperation) -> bool {
        self.actions.iter().any(|a| a == operation.action())
    }
    pub fn plan_label(&self) -> &'static str {
        match self.plan.as_deref() {
            Some("free") => "Free",
            Some("go") => "Go",
            Some("plus") => "Plus",
            Some("pro") => "Pro",
            Some("team") => "Team",
            Some("business") => "Business",
            Some("enterprise") => "Enterprise",
            Some("edu") => "Edu",
            _ => "Non disponibile",
        }
    }
    pub fn notice_description(&self) -> Option<&'static str> {
        self.notice.as_deref().map(|notice| match notice {
            "host_unavailable" => {
                "Il collegamento richiede la configurazione del computer che ospita MediFlow."
            }
            "timeout" => {
                "Il controllo ha impiegato troppo tempo. Rileggi lo stato prima di riprovare."
            }
            "logout_unconfirmed" => {
                "Account scollegato da MediFlow. Il servizio non ha confermato il logout remoto."
            }
            "login_expired" => "Il tempo per accedere è scaduto. Avvia un nuovo accesso.",
            "canceled" => "Accesso annullato.",
            "busy" => "È in corso un’altra operazione account. Rileggi lo stato.",
            _ => "Il collegamento non è confermato. Rileggi lo stato prima di riprovare.",
        })
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChatGptAccountOperation {
    Connect,
    CancelLogin,
    CompleteLogin,
    Refresh,
    Models,
    Limits,
    Logout,
}
impl ChatGptAccountOperation {
    fn path(self) -> &'static [&'static str] {
        match self {
            Self::Connect => &["login", "start"],
            Self::CancelLogin => &["login", "cancel"],
            Self::CompleteLogin => &["login", "complete"],
            Self::Refresh => &["read"],
            Self::Models => &["models"],
            Self::Limits => &["rate-limits"],
            Self::Logout => &["logout"],
        }
    }
    fn action(self) -> &'static str {
        match self {
            Self::Connect => "connect",
            Self::CancelLogin => "cancel_login",
            Self::CompleteLogin => "complete_login",
            Self::Refresh => "refresh_account",
            Self::Models => "read_models",
            Self::Limits => "read_rate_limits",
            Self::Logout => "logout",
        }
    }
    pub fn title(self) -> &'static str {
        match self {
            Self::Connect => "Collega ChatGPT",
            Self::CancelLogin => "Annulla accesso",
            Self::CompleteLogin => "Verifica accesso",
            Self::Refresh => "Aggiorna account",
            Self::Models => "Mostra modelli",
            Self::Limits => "Controlla utilizzo",
            Self::Logout => "Scollega ChatGPT",
        }
    }
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountQuotaWindow {
    pub used_percent: f64,
    pub window_duration_mins: Option<u64>,
    pub resets_at: Option<u64>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatGptAccountModel {
    pub id: String,
    pub model: String,
    pub is_default: bool,
}
pub struct ChatGptAccountObservation {
    pub status: ChatGptAccountStatus,
    pub auth_url: Option<Zeroizing<String>>,
    pub models: Option<Vec<ChatGptAccountModel>>,
    pub limits: Option<[Option<AccountQuotaWindow>; 2]>,
}
fn official_auth_url(value: &str) -> bool {
    reqwest::Url::parse(value).is_ok_and(|url| {
        value.len() <= 8192
            && url.scheme() == "https"
            && url.host_str() == Some("auth.openai.com")
            && url.port().is_none()
            && url.path() == "/oauth/authorize"
            && url.username().is_empty()
            && url.password().is_none()
            && url.fragment().is_none()
            && url
                .query_pairs()
                .any(|(k, v)| k == "state" && !v.is_empty())
    })
}
impl LocalHostAccess {
    pub fn read_chatgpt_account(&self) -> Result<ChatGptAccountStatus> {
        let value = self.request(
            Method::GET,
            &["api", "settings", "ai", "chatgpt", "status"],
            None,
            false,
        )?;
        self.headers()?;
        ChatGptAccountStatus::parse(value)
    }
    pub fn operate_chatgpt_account(
        &self,
        operation: ChatGptAccountOperation,
    ) -> Result<ChatGptAccountObservation> {
        if !self.read_chatgpt_account()?.allows(operation) {
            return Err(RuntimeError::Conflict);
        }
        let mut path = vec!["api", "settings", "ai", "chatgpt"];
        path.extend_from_slice(operation.path());
        let value = self.request(Method::POST, &path, Some(&json!({})), true)?;
        let posted = ChatGptAccountStatus::parse(if value.get("status").is_some() {
            value["status"].clone()
        } else {
            value.clone()
        })?;
        let observed = self.read_chatgpt_account()?;
        if posted.state != observed.state {
            return Err(RuntimeError::Indeterminate);
        }
        let auth_url = if operation == ChatGptAccountOperation::Connect
            && observed.state == AccountState::AwaitingLogin
        {
            Some(Zeroizing::new(
                value["authUrl"]
                    .as_str()
                    .filter(|v| official_auth_url(v))
                    .ok_or(RuntimeError::InvalidResponse)?
                    .to_owned(),
            ))
        } else {
            None
        };
        let models = if operation == ChatGptAccountOperation::Models
            && observed.state == AccountState::Connected
        {
            let models: Vec<ChatGptAccountModel> = serde_json::from_value(value["models"].clone())
                .map_err(|_| RuntimeError::InvalidResponse)?;
            let valid = |s: &str| {
                !s.is_empty()
                    && s.len() <= 200
                    && s.as_bytes()[0].is_ascii_alphanumeric()
                    && s.bytes()
                        .all(|c| c.is_ascii_alphanumeric() || b"._:/-".contains(&c))
            };
            if models.len() > 1000 || models.iter().any(|m| !valid(&m.id) || !valid(&m.model)) {
                return Err(RuntimeError::InvalidResponse);
            }
            Some(models)
        } else {
            None
        };
        let limits = if operation == ChatGptAccountOperation::Limits
            && observed.state == AccountState::Connected
        {
            let windows: [Option<AccountQuotaWindow>; 2] =
                serde_json::from_value(json!([value["primary"], value["secondary"]]))
                    .map_err(|_| RuntimeError::InvalidResponse)?;
            if windows.iter().flatten().any(|w| {
                !w.used_percent.is_finite()
                    || w.used_percent < 0.
                    || w.window_duration_mins
                        .is_some_and(|n| n == 0 || n > crate::MAX_SAFE_VERSION)
                    || w.resets_at.is_some_and(|n| n > crate::MAX_SAFE_VERSION)
            }) {
                return Err(RuntimeError::InvalidResponse);
            }
            Some(windows)
        } else {
            None
        };
        Ok(ChatGptAccountObservation {
            status: observed,
            auth_url,
            models,
            limits,
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn account_login_only_accepts_official_transient_url() {
        assert!(official_auth_url(
            "https://auth.openai.com/oauth/authorize?state=synthetic"
        ));
        for url in [
            "http://auth.openai.com/oauth/authorize?state=a",
            "https://example.com/oauth/authorize?state=a",
            "https://auth.openai.com/oauth/authorize",
            "https://auth.openai.com/oauth/authorize?state=a#token",
        ] {
            assert!(!official_auth_url(url));
        }
    }
    #[test]
    fn account_presence_never_accepts_inference_authority() {
        let mut value = json!({"state":"connected","notice":null,"plan":"plus","loginExpiresAt":null,"actions":["logout"],"inferenceEnabled":false,"executionBlock":"data_boundary_unqualified"});
        assert_eq!(
            ChatGptAccountStatus::parse(value.clone())
                .unwrap()
                .plan_label(),
            "Plus"
        );
        value["inferenceEnabled"] = json!(true);
        assert!(ChatGptAccountStatus::parse(value).is_err());
    }
}

//! Analysis: the host computes the demographic projection and this view only
//! presents it. No age, bucket, ratio or clinical aggregate is calculated here,
//! and diagnostic counts are declared as absent instead of simulated.

use super::*;
use mediflow_runtime_client::{
    DemographicsRequest, POPULATION_DEMOGRAPHICS_CAPABILITY, PopulationDemographics,
};

pub(super) type TimeZoneSource = std::rc::Rc<dyn Fn() -> Option<String>>;

const TIME_ZONE_UNDETERMINED: &str = "Il fuso orario di questo computer non è determinabile. L’analisi non viene richiesta senza un fuso esplicito: controlla l’impostazione del sistema e riprova.";

pub(super) struct AnalyticsArea {
    state: AnalyticsState,
    min_age: Entity<TextInput>,
    max_age: Entity<TextInput>,
    time_zone_source: TimeZoneSource,
    _subscriptions: Vec<Subscription>,
}

impl AnalyticsArea {
    pub(super) fn new(theme: Theme, cx: &mut Context<ClinicalApp>) -> Self {
        let min_age = age_field("clinical-analytics-min-age", "Età minima", "0", theme, cx);
        let max_age = age_field(
            "clinical-analytics-max-age",
            "Età massima",
            "120",
            theme,
            cx,
        );
        let mut subscriptions = Vec::new();
        for field in [&min_age, &max_age] {
            subscriptions.push(cx.subscribe(field, |this, _, _: &InputChanged, cx| {
                this.analytics_edited(cx);
            }));
        }
        Self {
            state: AnalyticsState::Idle,
            min_age,
            max_age,
            time_zone_source: std::rc::Rc::new(|| iana_time_zone::get_timezone().ok()),
            _subscriptions: subscriptions,
        }
    }

    pub(super) fn reset(&mut self, cx: &mut Context<ClinicalApp>) {
        self.state = AnalyticsState::Idle;
        self.min_age
            .update(cx, |input, cx| input.set_content("0", cx));
        self.max_age
            .update(cx, |input, cx| input.set_content("120", cx));
    }

    pub(super) fn prepare_render(&self, theme: Theme, cx: &mut Context<ClinicalApp>) {
        for field in [&self.min_age, &self.max_age] {
            field.update(cx, |input, cx| input.configure(theme, false, cx));
        }
    }

    fn values(&self, cx: &App) -> (String, String) {
        (
            self.min_age.read(cx).value().to_owned(),
            self.max_age.read(cx).value().to_owned(),
        )
    }
}

pub(super) enum AnalyticsState {
    Idle,
    Loading,
    Ready(PopulationDemographics),
    Denied(String),
    Stale(String),
    Cancelled,
    Invalid(String),
    Failed(String),
}

impl AnalyticsState {
    fn from_result(result: std::result::Result<PopulationDemographics, RuntimeError>) -> Self {
        match result {
            Ok(value) => Self::Ready(value),
            Err(RuntimeError::Forbidden) => Self::Denied(
                "L’archivio non ha autorizzato questa postazione alla lettura della popolazione. Chiedi all’amministratore la funzione di lettura dei pazienti."
                    .into(),
            ),
            Err(RuntimeError::AnalyticsCancelled) => Self::Cancelled,
            Err(RuntimeError::Conflict | RuntimeError::ArchiveReplaced) => Self::Stale(
                "L’archivio è stato sostituito o la lettura non è più attuale. I conteggi non vengono mostrati: rileggi l’analisi."
                    .into(),
            ),
            Err(RuntimeError::Rejected(413) | RuntimeError::TooLarge) => Self::Failed(
                "Il risultato supera il limite previsto per questa lettura. L’analisi non viene mostrata parzialmente."
                    .into(),
            ),
            Err(RuntimeError::Rejected(400)) => Self::Failed(
                "L’archivio ha rifiutato la fascia di età o il fuso orario. Controlla i due campi e riprova."
                    .into(),
            ),
            Err(RuntimeError::InvalidResponse) => Self::Failed(
                "La risposta dell’archivio non è verificabile. Nessun conteggio viene mostrato."
                    .into(),
            ),
            Err(error) => Self::Failed(ui_error(error)),
        }
    }

    fn notice(&self) -> Option<(String, bool)> {
        match self {
            Self::Idle | Self::Ready(_) => None,
            Self::Loading => Some(("Lettura dei conteggi dell’archivio in corso…".into(), false)),
            Self::Denied(message) | Self::Stale(message) | Self::Failed(message) => {
                Some((message.clone(), true))
            }
            Self::Invalid(message) => Some((message.clone(), false)),
            Self::Cancelled => Some((
                "La lettura è stata annullata. I conteggi non vengono mostrati: rileggi l’analisi."
                    .into(),
                false,
            )),
        }
    }
}

fn age_field(
    id: &'static str,
    label: &'static str,
    value: &str,
    theme: Theme,
    cx: &mut Context<ClinicalApp>,
) -> Entity<TextInput> {
    cx.new(|cx| {
        let mut input = TextInput::new(id, label, "", false, theme, cx);
        input.set_content(value, cx);
        input
    })
}

fn parse_age(value: &str) -> std::result::Result<u8, String> {
    let value = value.trim();
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err("Inserisci un’età in anni, con cifre da 0 a 120.".into());
    }
    value
        .parse::<u8>()
        .ok()
        .filter(|age| *age <= 120)
        .ok_or_else(|| "Inserisci un’età in anni, con cifre da 0 a 120.".into())
}

fn schede(count: u64) -> String {
    format!("{count} {}", if count == 1 { "scheda" } else { "schede" })
}

fn observed_label(value: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|at| {
            at.with_timezone(&chrono::Local)
                .format("%d/%m/%Y alle %H:%M")
                .to_string()
        })
        .unwrap_or_else(|_| "istante non leggibile".into())
}

fn calendar_label(time_zone: &str, observed_at: &str) -> String {
    format!(
        "Età calcolate con il calendario di {time_zone} alla data di osservazione {}.",
        observed_label(observed_at)
    )
}

impl ClinicalApp {
    pub(super) fn load_analytics(&mut self, cx: &mut Context<Self>) {
        self.next_epoch();
        let (Some(session), Some(scope)) = (self.session.clone(), self.scope.clone()) else {
            self.analytics.state = AnalyticsState::Idle;
            cx.notify();
            return;
        };
        let (min, max) = self.analytics.values(cx);
        let min_age = match parse_age(&min) {
            Ok(age) => age,
            Err(message) => {
                self.analytics.state = AnalyticsState::Invalid(message);
                cx.notify();
                return;
            }
        };
        let max_age = match parse_age(&max) {
            Ok(age) => age,
            Err(message) => {
                self.analytics.state = AnalyticsState::Invalid(message);
                cx.notify();
                return;
            }
        };
        let Some(time_zone) = (self.analytics.time_zone_source)() else {
            self.analytics.state = AnalyticsState::Failed(TIME_ZONE_UNDETERMINED.into());
            cx.notify();
            return;
        };
        let request = match DemographicsRequest::new(min_age, max_age, &time_zone) {
            Ok(request) => request,
            Err(_) => {
                self.analytics.state = AnalyticsState::Failed(TIME_ZONE_UNDETERMINED.into());
                cx.notify();
                return;
            }
        };
        self.analytics.state = AnalyticsState::Loading;
        self.run(
            move || session.read_population_demographics(&scope, &request),
            |this, result, cx| {
                this.analytics.state = AnalyticsState::from_result(result);
                cx.notify();
            },
            cx,
        );
        cx.notify();
    }

    fn analytics_edited(&mut self, cx: &mut Context<Self>) {
        if matches!(self.analytics.state, AnalyticsState::Loading) {
            self.next_epoch();
        }
        self.analytics.state = AnalyticsState::Idle;
        cx.notify();
    }

    pub(super) fn analytics_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let mut pane = div()
            .min_w_0()
            .max_w_full()
            .max_w(px(760.))
            .flex()
            .flex_col()
            .gap(px(24.))
            .child(heading("clinical-analytics-heading", "Analisi", theme))
            .child(div().text_color(theme.secondary).child(text!(
                "L’archivio calcola i conteggi della popolazione attiva per la fascia scelta. Questa finestra non calcola età, fasce o indicatori clinici: mostra i valori restituiti dall’archivio, con barre proporzionali e gli stessi conteggi in testo."
            )));
        if let Some(session) = &self.session
            && !session.can_write(POPULATION_DEMOGRAPHICS_CAPABILITY)
        {
            pane = pane.child(notice(
                "clinical-analytics-capability",
                "Questa postazione non dichiara la lettura della popolazione tra le funzioni disponibili. L’archivio decide comunque l’accesso: la richiesta può essere rifiutata.",
                theme,
                false,
            ));
        }
        pane = pane
            .child(section("clinical-analytics-range", "FASCIA DI ETÀ", theme))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_end()
                    .gap(px(12.))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(6.))
                            .child(text!("Età minima"))
                            .child(self.analytics.min_age.clone()),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(6.))
                            .child(text!("Età massima"))
                            .child(self.analytics.max_age.clone()),
                    )
                    .child(
                        button(
                            "clinical-analytics-update",
                            "Aggiorna",
                            theme,
                            true,
                            !matches!(self.analytics.state, AnalyticsState::Loading),
                        )
                        .when(
                            !matches!(self.analytics.state, AnalyticsState::Loading),
                            |el| el.on_click(cx.listener(|this, _, _, cx| this.load_analytics(cx))),
                        ),
                    ),
            )
            .child(div().text_color(theme.secondary).child(text!(format!(
                "Fuso orario della lettura: {}",
                self.analytics.state.ready().map_or("da determinare", |demographics| {
                    demographics.time_zone.as_str()
                })
            ))));
        if let Some(demographics) = self.analytics.state.ready() {
            pane = pane.child(
                div()
                    .text_color(theme.secondary)
                    .child(text!(calendar_label(
                        &demographics.time_zone,
                        &demographics.observed_at
                    ))),
            );
        }
        if let Some((message, error)) = self.analytics.state.notice() {
            pane = pane.child(notice("clinical-analytics-state", message, theme, error));
        }
        let Some(demographics) = self.analytics.state.ready() else {
            return pane;
        };
        let stats = &demographics.stats;
        let [min_age, max_age] = demographics.age_range;
        pane = pane
            .child(section("clinical-analytics-population", "POPOLAZIONE", theme))
            .child(crate::components::number_line(
                "clinical-analytics-population-summary", "", stats.total_in_range.to_string(),
                &format!(" schede attive tra {min_age} e {max_age} anni"), theme,
            ))
            .child(div().text_color(theme.secondary).child(text!(format!(
                "{} con una data di nascita e {} senza, sull’intera popolazione attiva. Le schede senza data restano fuori dal filtro.",
                schede(stats.with_birth_date),
                schede(stats.without_birth_date)
            ))))
            .child(div().text_color(theme.secondary).child(text!(format!(
                "Assistenza domiciliare integrata: {} nella fascia.",
                schede(stats.adi_count)
            ))));
        if stats.total_in_range == 0 {
            pane = pane.child(notice(
                "clinical-analytics-empty",
                "Nessuna scheda attiva con età nota rientra nella fascia scelta.",
                theme,
                false,
            ));
        } else {
            let rows = stats.age_dist.rows();
            let total = stats.total_in_range;
            pane = pane
                .child(section(
                    "clinical-analytics-distribution",
                    "DISTRIBUZIONE PER ETÀ",
                    theme,
                ))
                .children(
                    rows.into_iter()
                        .map(|(label, count)| age_bar(label, count, total, theme)),
                )
                .child(
                    div()
                        .text_color(theme.secondary)
                        .child(text!(format!("Distribuzione: {}.", rows_text(rows)))),
                );
        }
        pane.child(
            div()
                .text_color(theme.secondary)
                .child(text!(format!(
                    "Dati osservati dall’archivio il {}. La lettura non include diagnosi né conteggi diagnostici.",
                    observed_label(&demographics.observed_at)
                ))),
        )
    }
}

fn rows_text(rows: [(&'static str, u64); 4]) -> String {
    rows.into_iter()
        .map(|(label, count)| {
            let label = if label == "80+" {
                "oltre 80 anni".to_string()
            } else {
                format!("{label} anni")
            };
            format!("{label}: {}", schede(count))
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn age_bar(label: &'static str, count: u64, total: u64, theme: Theme) -> Stateful<Div> {
    let fraction = if total == 0 {
        0.0
    } else {
        (count as f64 / total as f64) as f32
    };
    div()
        .id(label)
        .role(Role::Image)
        .aria_label(format!("{label} anni: {count} su {total}"))
        .flex()
        .flex_col()
        .gap(px(6.))
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .child(text!(format!("{label} anni")))
                .child(text!(count.to_string())),
        )
        .child(
            div()
                .w_full()
                .h(px(8.))
                .bg(theme.shade)
                .rounded(px(4.))
                .child(
                    div()
                        .h_full()
                        .w(gpui::DefiniteLength::Fraction(fraction.clamp(0., 1.)))
                        .bg(theme.fresh)
                        .rounded(px(4.)),
                ),
        )
}

impl AnalyticsState {
    fn ready(&self) -> Option<&PopulationDemographics> {
        if let Self::Ready(value) = self {
            Some(value)
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use std::{
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        sync::{
            Arc, Mutex,
            atomic::{AtomicBool, AtomicU16, Ordering},
        },
        thread,
        time::Duration,
    };

    const RESPONSE_READY: u16 = 0;
    const RESPONSE_EMPTY: u16 = 1;
    const RESPONSE_DENIED: u16 = 2;
    const RESPONSE_CANCELLED: u16 = 3;
    const RESPONSE_REPLACED: u16 = 4;
    const RESPONSE_TOO_LARGE: u16 = 5;

    struct SyntheticHost {
        session: RuntimeSession,
        socket: std::net::SocketAddr,
        requests: Arc<Mutex<Vec<String>>>,
        mode: Arc<AtomicU16>,
        stop: Arc<AtomicBool>,
        worker: Option<thread::JoinHandle<()>>,
    }

    impl SyntheticHost {
        fn new() -> Self {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let socket = listener.local_addr().unwrap();
            let requests = Arc::new(Mutex::new(Vec::new()));
            let captured = requests.clone();
            let mode = Arc::new(AtomicU16::new(RESPONSE_READY));
            let response_mode = mode.clone();
            let stop = Arc::new(AtomicBool::new(false));
            let stopping = stop.clone();
            let worker = thread::spawn(move || {
                loop {
                    let (mut stream, _) = listener.accept().unwrap();
                    if stopping.load(Ordering::Acquire) {
                        break;
                    }
                    stream
                        .set_read_timeout(Some(Duration::from_secs(10)))
                        .unwrap();
                    let request = read_request(&mut stream);
                    captured.lock().unwrap().push(request.clone());
                    let route = request
                        .lines()
                        .next()
                        .unwrap()
                        .split_whitespace()
                        .take(2)
                        .collect::<Vec<_>>()
                        .join(" ");
                    let mut status = 200;
                    let response = if route.starts_with("GET /api/auth/check") {
                        json!({"status":"ok", "isSetup":true, "archiveGeneration":"synthetic-generation",
                        "unlock":{"credential":"passphrase", "kdfVersion":3, "salt":"AwMDAwMDAwMDAwMDAwMDAw=="}})
                    } else if route.starts_with("POST /api/auth/native/login") {
                        json!({"success":true, "id":"synthetic-user", "username":"synthetic", "role":"admin",
                        "archiveGeneration":"synthetic-generation", "salt":"AwMDAwMDAwMDAwMDAwMDAw==",
                        "encryptedMasterKey":"v3:BQUFBQUFBQUFBQUFAm40aZvQGpityOwyLKhsE40tJdbsjtrugIXzoJ/lk9gjlh5j7pIPeh7DLQ7ikGhA"})
                    } else if route.starts_with("GET /api/v1/network/capabilities") {
                        json!({"protocolVersion":"1.13.0", "operatingMode":"network-home-base",
                        "capabilities":[{"key":POPULATION_DEMOGRAPHICS_CAPABILITY, "requiresPairing":true, "status":"available"}]})
                    } else if route.starts_with("GET /api/v1/network/ambulatories") {
                        json!([{"id":"scope-a", "name":"Ambulatorio sintetico", "isDefault":true, "version":1}])
                    } else if route.starts_with("GET /api/v1/network/identity") {
                        json!({"scope":{"effectiveAmbulatoryId":"scope-a", "requestBinding":"expected-ambulatory-id-v1"},
                        "operator":{"userId":"synthetic-user", "authChannel":"native"}})
                    } else if route.starts_with("POST /api/auth/native/logout") {
                        json!({"success":true})
                    } else if route.starts_with("GET /api/v1/network/analytics/demographics?") {
                        let (status_value, body) =
                            demographics_reply(&route, response_mode.load(Ordering::Acquire));
                        status = status_value;
                        body
                    } else {
                        panic!("unexpected synthetic UI route: {route}");
                    };
                    let response = response.to_string();
                    write!(stream, "HTTP/1.1 {status} Synthetic\r\nContent-Type: application/json\r\nSet-Cookie: mediflow_session={}; Path=/; HttpOnly\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}", "a".repeat(64), response.len()).unwrap();
                }
            });
            let client = RuntimeClient::new(RuntimeConfig {
                base_url: format!("http://{socket}"),
                tls_pin_sha256: None,
            })
            .unwrap();
            let session = client
                .login(
                    PairingCredentials::new("synthetic-device", "x".repeat(64)).unwrap(),
                    "synthetic",
                    "Synthetic scales fixture passphrase",
                )
                .unwrap();
            session.list_ambulatories().unwrap();
            Self {
                session,
                socket,
                requests,
                mode,
                stop,
                worker: Some(worker),
            }
        }

        fn demographics_requests(&self) -> Vec<String> {
            self.requests
                .lock()
                .unwrap()
                .iter()
                .filter(|request| {
                    request.starts_with("GET /api/v1/network/analytics/demographics?")
                })
                .cloned()
                .collect()
        }
    }

    impl Drop for SyntheticHost {
        fn drop(&mut self) {
            self.session.lock();
            self.stop.store(true, Ordering::Release);
            let _ = TcpStream::connect(self.socket);
            if let Some(worker) = self.worker.take() {
                worker.join().unwrap();
            }
        }
    }

    fn read_request(stream: &mut TcpStream) -> String {
        let mut headers = Vec::new();
        let mut byte = [0];
        while !headers.ends_with(b"\r\n\r\n") {
            stream.read_exact(&mut byte).unwrap();
            headers.push(byte[0]);
            assert!(headers.len() < 16 * 1024);
        }
        let headers = String::from_utf8(headers).unwrap();
        let length = headers
            .lines()
            .find_map(|line| {
                line.to_ascii_lowercase()
                    .strip_prefix("content-length:")
                    .map(|size| size.trim().parse::<usize>().unwrap())
            })
            .unwrap_or(0);
        assert!(length < 128 * 1024);
        let mut body = vec![0; length];
        stream.read_exact(&mut body).unwrap();
        headers + &String::from_utf8(body).unwrap()
    }

    fn demographics_reply(route: &str, mode: u16) -> (u16, Value) {
        let query = route.split_once('?').unwrap().1;
        let mut min_age = None;
        let mut max_age = None;
        let mut time_zone = None;
        for pair in query.split('&') {
            let (key, value) = pair.split_once('=').unwrap();
            match key {
                "minAge" => min_age = Some(value.parse::<u8>().unwrap()),
                "maxAge" => max_age = Some(value.parse::<u8>().unwrap()),
                "timeZone" => time_zone = Some(value.replace("%2F", "/")),
                other => panic!("unexpected query parameter: {other}"),
            }
        }
        let min_age = min_age.unwrap();
        let max_age = max_age.unwrap();
        let time_zone = time_zone.unwrap();
        let stats = if mode == RESPONSE_EMPTY {
            json!({"totalInRange":0, "withBirthDate":2, "withoutBirthDate":1, "adiCount":0,
                "ageDist":{"0-18":0, "19-64":0, "65-80":0, "80+":0}})
        } else {
            json!({"totalInRange":7, "withBirthDate":9, "withoutBirthDate":2, "adiCount":3,
                "ageDist":{"0-18":1, "19-64":2, "65-80":3, "80+":1}})
        };
        let body = json!({
            "operation": "population-demographics.read.v1",
            "contractVersion": 1,
            "scope": {"ambulatoryId": "scope-a", "archiveGeneration": "synthetic-generation"},
            "ageRange": [min_age, max_age],
            "timeZone": time_zone,
            "observedAt": "2026-10-20T08:30:00.000Z",
            "stats": stats
        });
        match mode {
            RESPONSE_DENIED => (
                403,
                json!({"error":"no", "code":"ANALYTICS_SCOPE_UNAVAILABLE"}),
            ),
            RESPONSE_CANCELLED => (
                409,
                json!({"error":"annullata", "code":"ANALYTICS_CANCELLED"}),
            ),
            RESPONSE_REPLACED => (409, json!({"error":"archivio", "code":"ARCHIVE_REPLACED"})),
            RESPONSE_TOO_LARGE => (
                413,
                json!({"error":"grande", "code":"ANALYTICS_OUTPUT_TOO_LARGE"}),
            ),
            _ => (200, body),
        }
    }

    fn render_window(cx: &mut gpui::VisualTestContext) {
        for _ in 0..8 {
            let callbacks = cx.update(|window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
                window.simulate_next_frame(cx)
            });
            cx.run_until_parked();
            if callbacks == 0 {
                return;
            }
        }
        panic!("workspace rendering did not return to an idle frame");
    }

    fn enter_analytics(
        view: &Entity<ClinicalApp>,
        host: &SyntheticHost,
        cx: &mut gpui::VisualTestContext,
    ) {
        view.update(cx, |app, cx| {
            app.session = Some(host.session.clone());
            app.scope = Some("scope-a".into());
            app.area = Area::Analytics;
            app.analytics.time_zone_source = std::rc::Rc::new(|| Some("Europe/Rome".to_owned()));
            app.load_analytics(cx);
        });
        cx.run_until_parked();
    }

    #[test]
    fn view_names_the_host_reported_time_zone_as_the_calendar_used() {
        let label = calendar_label("UTC", "2026-10-20T08:30:00.000Z");
        assert!(
            label.starts_with("Età calcolate con il calendario di UTC alla data di osservazione "),
            "{label}"
        );
    }

    #[gpui::test]
    fn analytics_gpui_renders_host_counts_and_distinguishes_every_failure(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = SyntheticHost::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        assert!(host.session.can_write(POPULATION_DEMOGRAPHICS_CAPABILITY));
        enter_analytics(&view, &host, cx);
        view.read_with(cx, |app, _| {
            let demographics = app.analytics.state.ready().unwrap();
            assert_eq!(demographics.age_range, [0, 120]);
            assert_eq!(demographics.stats.total_in_range, 7);
            assert_eq!(demographics.stats.adi_count, 3);
        });
        let request = host.demographics_requests().pop().unwrap();
        assert!(
            request.starts_with(
                "GET /api/v1/network/analytics/demographics?minAge=0&maxAge=120&timeZone=Europe%2FRome "
            ),
            "{request}"
        );
        assert!(request.contains("\r\nx-mediflow-expected-ambulatory-id: scope-a\r\n"));
        assert!(request.contains("\r\nx-mediflow-archive-generation: synthetic-generation\r\n"));
        render_window(cx);
        let row = cx
            .debug_bounds("clinical-analytics-population-summary")
            .unwrap();
        let number = cx
            .debug_bounds("clinical-analytics-population-summary-number")
            .unwrap();
        let meaning = cx
            .debug_bounds("clinical-analytics-population-summary-meaning")
            .unwrap();
        assert!(number.right() <= meaning.left());
        assert!(number.top() < meaning.bottom() && meaning.top() < number.bottom());
        assert!(row.top() <= number.top() && row.bottom() >= meaning.bottom());

        host.mode.store(RESPONSE_EMPTY, Ordering::Release);
        view.update(cx, |app, cx| app.load_analytics(cx));
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            let demographics = app.analytics.state.ready().unwrap();
            assert_eq!(demographics.stats.total_in_range, 0);
            assert_eq!(demographics.stats.without_birth_date, 1);
        });
        render_window(cx);

        for (mode, expected) in [
            (RESPONSE_DENIED, "forbidden"),
            (RESPONSE_CANCELLED, "cancelled"),
            (RESPONSE_REPLACED, "replaced"),
            (RESPONSE_TOO_LARGE, "too-large"),
        ] {
            host.mode.store(mode, Ordering::Release);
            view.update(cx, |app, cx| app.load_analytics(cx));
            cx.run_until_parked();
            view.read_with(cx, |app, _| match (expected, &app.analytics.state) {
                ("forbidden", AnalyticsState::Denied(_))
                | ("cancelled", AnalyticsState::Cancelled)
                | ("replaced", AnalyticsState::Stale(_))
                | ("too-large", AnalyticsState::Failed(_)) => {}
                _ => panic!("unexpected state for {expected}"),
            });
            render_window(cx);
        }
    }

    #[gpui::test]
    fn analytics_gpui_re_reads_the_time_zone_on_every_read(cx: &mut gpui::TestAppContext) {
        let host = SyntheticHost::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        let calls = std::rc::Rc::new(std::cell::Cell::new(0usize));
        let counted = calls.clone();
        view.update(cx, |app, cx| {
            app.session = Some(host.session.clone());
            app.scope = Some("scope-a".into());
            app.area = Area::Analytics;
            app.analytics.time_zone_source = std::rc::Rc::new(move || {
                let index = counted.get();
                counted.set(index + 1);
                Some(["Europe/Rome", "Europe/Berlin"][index.min(1)].to_owned())
            });
            app.load_analytics(cx);
        });
        cx.run_until_parked();
        assert_eq!(calls.get(), 1);
        view.update(cx, |app, cx| app.load_analytics(cx));
        cx.run_until_parked();
        assert_eq!(calls.get(), 2);
        let requests = host.demographics_requests();
        assert!(
            requests[0].starts_with(
                "GET /api/v1/network/analytics/demographics?minAge=0&maxAge=120&timeZone=Europe%2FRome "
            ),
            "{}",
            requests[0]
        );
        assert!(
            requests[1].starts_with(
                "GET /api/v1/network/analytics/demographics?minAge=0&maxAge=120&timeZone=Europe%2FBerlin "
            ),
            "{}",
            requests[1]
        );
        view.read_with(cx, |app, _| {
            assert_eq!(
                app.analytics.state.ready().unwrap().time_zone,
                "Europe/Berlin"
            );
        });
    }

    #[gpui::test]
    fn analytics_gpui_refuses_an_edited_range_without_touching_the_archive(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = SyntheticHost::new();
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        enter_analytics(&view, &host, cx);
        let before = host.demographics_requests().len();
        view.update(cx, |app, cx| {
            app.analytics
                .min_age
                .update(cx, |input, cx| input.set_content("oltre", cx));
            app.load_analytics(cx);
        });
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            assert!(matches!(app.analytics.state, AnalyticsState::Invalid(_)));
        });
        assert_eq!(host.demographics_requests().len(), before);
    }
}

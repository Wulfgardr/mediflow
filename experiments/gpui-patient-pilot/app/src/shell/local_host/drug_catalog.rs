use super::references::line;
use super::*;
use mediflow_runtime_client::{
    DRUG_CATALOG_FIELDS, DRUG_CATALOG_MAX_BYTES, DrugCatalogCommit, DrugCatalogPreview,
    DrugCatalogReply, PreparedDrugCatalogImport,
};
use serde_json::{Value, json};

const SOURCE_FIELDS: [(&str, &str); 5] = [
    (
        "drug-catalog-agency",
        "Agenzia o ente che pubblica il catalogo",
    ),
    (
        "drug-catalog-code-system",
        "Nome della codifica dei farmaci",
    ),
    ("drug-catalog-version", "Versione del catalogo"),
    ("drug-catalog-date", "Data del catalogo AAAA-MM-GG"),
    ("drug-catalog-url", "URL della fonte (facoltativo, https)"),
];
const COLUMN_IDS: [&str; 8] = [
    "drug-catalog-column-0",
    "drug-catalog-column-1",
    "drug-catalog-column-2",
    "drug-catalog-column-3",
    "drug-catalog-column-4",
    "drug-catalog-column-5",
    "drug-catalog-column-6",
    "drug-catalog-column-7",
];

/// Catalogo farmaci di un'altra agenzia caricato da file (ADR 0177): stesso percorso del Web.
pub(super) struct DrugCatalogArea {
    pub(super) preview: Option<DrugCatalogPreview>,
    pub(super) command: Option<Arc<PreparedDrugCatalogImport>>,
    pub(super) reduction: Option<(u64, u64)>,
    pub(super) message: Option<(String, bool)>,
    pub(super) receipt: Option<Value>,
    columns: Vec<Entity<TextInput>>,
    delimiter: Entity<TextInput>,
    source: Vec<Entity<TextInput>>,
}
impl DrugCatalogArea {
    pub(super) fn new(theme: Theme, cx: &mut Context<ClinicalApp>) -> Self {
        Self {
            preview: None,
            command: None,
            reduction: None,
            message: None,
            receipt: None,
            columns: DRUG_CATALOG_FIELDS
                .iter()
                .enumerate()
                .map(|(i, (_, label))| {
                    cx.new(|cx| TextInput::new(COLUMN_IDS[i], label, label, false, theme, cx))
                })
                .collect(),
            delimiter: cx.new(|cx| {
                TextInput::new(
                    "drug-catalog-delimiter",
                    "Separatore",
                    "Separatore: ; oppure , oppure tab",
                    false,
                    theme,
                    cx,
                )
            }),
            source: SOURCE_FIELDS
                .iter()
                .map(|(id, label)| cx.new(|cx| TextInput::new(id, label, label, false, theme, cx)))
                .collect(),
        }
    }
    fn inputs(&self) -> impl Iterator<Item = &Entity<TextInput>> {
        self.columns
            .iter()
            .chain([&self.delimiter])
            .chain(self.source.iter())
    }
    pub(super) fn withdraw(&mut self, cx: &mut App) {
        self.preview = None;
        self.command = None;
        self.reduction = None;
        self.message = None;
        self.receipt = None;
        for input in self.inputs() {
            input.update(cx, |input, cx| input.retire(cx));
        }
    }
    pub(super) fn configure(&self, theme: Theme, locked: bool, cx: &mut Context<ClinicalApp>) {
        let locked = locked || self.command.is_some();
        for input in self.inputs() {
            input.update(cx, |input, cx| input.configure(theme, locked, cx));
        }
    }
    /// Le colonne proposte dal server riempiono i campi, numerate da 1 come le vede chi legge il file.
    fn fill_mapping(&self, mapping: &Value, cx: &mut Context<ClinicalApp>) {
        for (i, (key, _)) in DRUG_CATALOG_FIELDS.iter().enumerate() {
            let text = mapping["columns"][*key]
                .as_u64()
                .map(|index| (index + 1).to_string())
                .unwrap_or_default();
            self.columns[i].update(cx, |input, cx| input.set_content(text, cx));
        }
        let delimiter = match mapping["delimiter"].as_str() {
            Some("\t") => "tab",
            Some(other) => other,
            None => "",
        }
        .to_owned();
        self.delimiter
            .update(cx, |input, cx| input.set_content(delimiter, cx));
    }
    fn mapping(&self, header: usize, cx: &App) -> std::result::Result<Value, String> {
        let delimiter = match self.delimiter.read(cx).value().trim() {
            ";" => ";",
            "," => ",",
            "tab" | "\\t" => "\t",
            _ => return Err("Il separatore deve essere ; oppure , oppure tab.".into()),
        };
        let mut columns = json!({});
        for (i, (key, label)) in DRUG_CATALOG_FIELDS.iter().enumerate() {
            let raw = self.columns[i].read(cx).value().trim().to_owned();
            if raw.is_empty() {
                continue;
            }
            let position = raw
                .parse::<usize>()
                .ok()
                .filter(|p| (1..=header).contains(p))
                .ok_or_else(|| format!("{label}: indica una colonna da 1 a {header}."))?;
            columns[*key] = json!(position - 1);
        }
        Ok(json!({"delimiter":delimiter,"columns":columns}))
    }
    fn source_value(&self, cx: &App) -> Value {
        let text = |i: usize| self.source[i].read(cx).value().trim().to_owned();
        let url = text(4);
        json!({"agency":text(0),"codeSystem":text(1),"version":text(2),"date":text(3),
            "sourceUrl":if url.is_empty() { Value::Null } else { json!(url) }})
    }
}

fn reply_message(error: RuntimeError) -> (String, bool) {
    (
        format!("{} Il catalogo attivo non è cambiato.", ui_error(error)),
        true,
    )
}

impl ClinicalApp {
    fn pick_drug_catalog_file(&mut self, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        let area = &mut self.local_host.references;
        area.busy = true;
        area.drug.preview = None;
        area.drug.command = None;
        area.drug.reduction = None;
        area.drug.message = None;
        area.drug.receipt = None;
        let generation = self.local_host.generation;
        let chosen = cx.prompt_for_paths(gpui::PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Scegli il catalogo farmaci CSV".into()),
        });
        cx.spawn(async move |this, cx| {
            let result = chosen.await;
            let _ = this.update(cx, |this, cx| {
                if this.local_host.generation != generation {
                    return;
                }
                let Ok(Ok(Some(paths))) = result else {
                    this.local_host.references.busy = false;
                    cx.notify();
                    return;
                };
                let Some(path) = paths.into_iter().next() else {
                    this.local_host.references.busy = false;
                    cx.notify();
                    return;
                };
                this.run_local_host(
                    move || {
                        let bytes = archives::read_selected(&path, DRUG_CATALOG_MAX_BYTES as u64)
                            .map_err(|_| RuntimeError::InvalidInput)?;
                        let name = path
                            .file_name()
                            .and_then(|n| n.to_str())
                            .ok_or(RuntimeError::InvalidInput)?
                            .to_owned();
                        access.preview_drug_catalog(&name, Arc::new(bytes.to_vec()), None)
                    },
                    |this, result, cx| this.drug_catalog_previewed(result, cx),
                    cx,
                );
            });
        })
        .detach();
        cx.notify();
    }
    fn drug_catalog_previewed(
        &mut self,
        result: Result<DrugCatalogReply<DrugCatalogPreview>, RuntimeError>,
        cx: &mut Context<Self>,
    ) {
        self.local_host.references.busy = false;
        let area = &mut self.local_host.references.drug;
        match result {
            Ok(DrugCatalogReply::Ready(preview)) => {
                // I campi mostrano sempre la mappatura su cui il server ha risposto.
                area.fill_mapping(preview.mapping(), cx);
                area.preview = Some(preview);
            }
            Ok(DrugCatalogReply::Refused(message)) => area.message = Some((message, true)),
            Err(error) if error.retires_session() => {
                self.disconnect(cx);
                self.message = Some((ui_error(error), true));
            }
            Err(error) => area.message = Some(reply_message(error)),
        }
        cx.notify();
    }
    fn count_drug_catalog(&mut self, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        let area = &mut self.local_host.references.drug;
        let Some(preview) = area.preview.clone() else {
            return;
        };
        let mapping = match area.mapping(preview.header().len(), cx) {
            Ok(mapping) => mapping,
            Err(message) => {
                area.message = Some((message, true));
                cx.notify();
                return;
            }
        };
        area.message = None;
        self.local_host.references.busy = true;
        self.run_local_host(
            move || {
                access.preview_drug_catalog(preview.file_name(), preview.bytes(), Some(&mapping))
            },
            |this, result, cx| this.drug_catalog_previewed(result, cx),
            cx,
        );
        cx.notify();
    }
    fn prepare_drug_catalog(&mut self, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        let area = &mut self.local_host.references.drug;
        let Some(preview) = area.preview.clone().filter(DrugCatalogPreview::counted) else {
            return;
        };
        // La sostituzione usa le colonne contate: se i campi sono cambiati dopo il conteggio, si conta di nuovo.
        if area.mapping(preview.header().len(), cx).ok().as_ref() != Some(preview.mapping()) {
            area.message = Some((
                "Le colonne o il separatore sono cambiati dopo il conteggio: conta di nuovo le righe prima della sostituzione.".into(),
                true,
            ));
            cx.notify();
            return;
        }
        match access.prepare_drug_catalog_import(&preview, area.source_value(cx)) {
            Ok(command) => {
                area.command = Some(Arc::new(command));
                area.message = None;
            }
            Err(error) => area.message = Some(reply_message(error)),
        }
        cx.notify();
    }
    fn commit_drug_catalog(&mut self, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        let Some(command) = self.local_host.references.drug.command.take() else {
            return;
        };
        self.local_host.references.busy = true;
        self.run_local_host(
            move || access.commit_drug_catalog_import(&command),
            |this, result, cx| {
                this.local_host.references.busy = false;
                let area = &mut this.local_host.references.drug;
                match result {
                    Ok(DrugCatalogCommit::Recorded(receipt)) => {
                        let count = receipt["count"].as_u64().unwrap_or(0);
                        area.preview = None;
                        area.reduction = None;
                        area.message = Some((
                            format!("Catalogo sostituito: {count} voci da {}. Stato riletto dall’home-base.",
                                receipt["imported"]["agency"].as_str().unwrap_or("fonte dichiarata")),
                            false,
                        ));
                        area.receipt = Some(receipt);
                        this.read_reference_catalog(cx);
                    }
                    Ok(DrugCatalogCommit::Reduction { command, previous, next }) => {
                        area.reduction = Some((previous, next));
                        area.command = Some(Arc::new(command));
                        area.message = Some((
                            format!("Il file ha {next} voci, meno del 90% delle {previous} attive. Catalogo conservato: conferma di nuovo solo se vuoi davvero ridurlo."),
                            true,
                        ));
                    }
                    Ok(DrugCatalogCommit::CatalogChanged(message)) => {
                        area.reduction = None;
                        area.message = Some((message, true));
                    }
                    Ok(DrugCatalogCommit::Refused(message)) => area.message = Some((message, true)),
                    Err(error) if error.retires_session() => {
                        this.disconnect(cx);
                        this.message = Some((ui_error(error), true));
                    }
                    Err(error) => {
                        area.preview = None;
                        area.message = Some((
                            format!("{} L’esito potrebbe non essere noto: rileggi lo stato prima di riprovare.", ui_error(error)),
                            true,
                        ));
                        this.read_reference_catalog(cx);
                    }
                }
                cx.notify();
            },
            cx,
        );
        cx.notify();
    }
    fn discard_drug_catalog(&mut self, cx: &mut Context<Self>) {
        let area = &mut self.local_host.references.drug;
        area.preview = None;
        area.command = None;
        area.reduction = None;
        area.message = None;
        cx.notify();
    }

    pub(super) fn drug_catalog_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let area = &self.local_host.references.drug;
        let enabled = !self.local_host.has_work();
        let mut pane = div()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(10.))
            .child(section("drug-catalog-heading", "Catalogo farmaci di un’altra agenzia", theme))
            .child(text!("CSV UTF-8 fino a 100 MB con intestazione. Sostituisce il catalogo attivo, anche quello AIFA; terapie e prescrizioni già salvate non cambiano."));
        if let Some((message, error)) = &area.message {
            pane = pane.child(notice(
                "drug-catalog-message",
                message.clone(),
                theme,
                *error,
            ));
        }
        let Some(preview) = &area.preview else {
            return pane.child(
                button(
                    "drug-catalog-file",
                    "Scegli il file del catalogo…",
                    theme,
                    false,
                    enabled,
                )
                .on_click(cx.listener(|this, _, _, cx| this.pick_drug_catalog_file(cx))),
            );
        };
        let header = preview.header();
        pane = pane
            .child(line("File", preview.file_name(), theme))
            .child(line(
                "Colonne del file",
                header.iter().enumerate().map(|(i, h)| format!("{} {h}", i + 1)).collect::<Vec<_>>().join(" · "),
                theme,
            ))
            .child(text!("Associa a ogni campo il numero della colonna. Codice e denominazione sono obbligatori; lascia vuoti i campi che il file non ha."));
        for (i, input) in area.columns.iter().enumerate() {
            pane = pane.child(
                div()
                    .id(("drug-catalog-column", i))
                    .flex()
                    .flex_col()
                    .gap(px(4.))
                    .child(text!(DRUG_CATALOG_FIELDS[i].1))
                    .child(input.clone()),
            );
        }
        pane = pane.child(area.delimiter.clone()).child(
            button(
                "drug-catalog-count",
                "Conta le righe con queste colonne",
                theme,
                false,
                enabled && area.command.is_none(),
            )
            .on_click(cx.listener(|this, _, _, cx| this.count_drug_catalog(cx))),
        );
        if preview.counted() {
            let counts = &preview.data()["counts"];
            pane = pane
                .child(line(
                    "Righe importabili",
                    counts["importable"].to_string(),
                    theme,
                ))
                .child(line(
                    "Righe scartate",
                    counts["rejected"].to_string(),
                    theme,
                ))
                .child(line(
                    "Codici duplicati",
                    counts["duplicateCodes"].to_string(),
                    theme,
                ))
                .child(line(
                    "Voci nel catalogo attivo",
                    preview.current_count().to_string(),
                    theme,
                ));
            for (i, row) in preview.data()["sample"]
                .as_array()
                .into_iter()
                .flatten()
                .take(5)
                .enumerate()
            {
                pane = pane.child(div().id(("drug-catalog-sample", i)).child(text!(format!(
                        "{} · {}{}",
                        row["code"].as_str().unwrap_or(""),
                        row["name"].as_str().unwrap_or(""),
                        row["activePrinciple"]
                            .as_str()
                            .map(|p| format!(" · {p}"))
                            .unwrap_or_default()
                    ))));
            }
            for (i, item) in preview.data()["diagnostics"]
                .as_array()
                .into_iter()
                .flatten()
                .take(5)
                .enumerate()
            {
                pane = pane.child(
                    div()
                        .id(("drug-catalog-diagnostic", i))
                        .child(text!(format!(
                            "Riga {}: {}",
                            item["row"],
                            item["reason"].as_str().unwrap_or("")
                        ))),
                );
            }
            if preview.reduction_required() {
                pane = pane.child(notice(
                    "drug-catalog-reduction-warning",
                    "Il file ha meno del 90% delle voci attive: dopo la conferma servirà una seconda conferma.",
                    theme,
                    true,
                ));
            }
            pane = pane
                .child(section(
                    "drug-catalog-source-heading",
                    "Fonte dichiarata",
                    theme,
                ))
                .child(text!(
                    "La fonte resta nel manifesto del catalogo e nelle ricette che lo usano."
                ));
            for input in &area.source {
                pane = pane.child(input.clone());
            }
            if let Some(command) = &area.command {
                let (label, critical) = if command.reduction_confirmed() {
                    let (previous, next) = area.reduction.unwrap_or_default();
                    (
                        format!("Riduci il catalogo da {previous} a {next} voci"),
                        true,
                    )
                } else {
                    (
                        format!("Sostituisci il catalogo con {} voci", preview.importable()),
                        false,
                    )
                };
                pane = pane
                    .child(notice(
                        "drug-catalog-confirm-question",
                        format!(
                            "Sostituire il catalogo farmaci con il file di {}? Il catalogo attivo viene rimpiazzato per intero.",
                            command.source()["agency"].as_str().unwrap_or("")
                        ),
                        theme,
                        false,
                    ))
                    .child(
                        button("drug-catalog-confirm", label, theme, true, enabled)
                            .when(critical, |el| el.bg(theme.critical).border_color(theme.critical).text_color(theme.paper))
                            .on_click(cx.listener(|this, _, _, cx| this.commit_drug_catalog(cx))),
                    );
            } else {
                pane = pane.child(
                    button(
                        "drug-catalog-prepare",
                        "Rivedi la sostituzione",
                        theme,
                        false,
                        enabled && preview.importable() > 0,
                    )
                    .on_click(cx.listener(|this, _, _, cx| this.prepare_drug_catalog(cx))),
                );
            }
        }
        pane.child(
            button("drug-catalog-discard", "Annulla", theme, false, enabled)
                .on_click(cx.listener(|this, _, _, cx| this.discard_drug_catalog(cx))),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const SNAPSHOT_BEFORE: &str =
        "1111111111111111111111111111111111111111111111111111111111111111";
    const SNAPSHOT_AFTER: &str = "2222222222222222222222222222222222222222222222222222222222222222";
    const POST: &str = "POST /api/drugs/catalog-import";

    fn preview(counted: bool) -> Value {
        json!({"header":["code","name","active_ingredient","atc"],
            "mapping":{"delimiter":";","columns":{"codice":0,"denominazione":1,"principio_attivo":2,"atc":3}},
            "suggested":!counted,"sha256":"a".repeat(64),
            "counts":if counted { json!({"total":2,"importable":2,"rejected":0,"duplicateCodes":0}) } else { Value::Null },
            "diagnostics":[],"sample":if counted { json!([{"code":"X0001","name":"Farmaco inventato uno","activePrinciple":"Sostanza inventata","atc":"A01AA01"}]) } else { json!([]) },
            "current":{"count":10,"snapshot":SNAPSHOT_BEFORE,"state":"ready","manifest":null},"reductionRequired":counted})
    }
    fn field<'a>(body: &'a Value, name: &str) -> Option<&'a str> {
        let text = body.as_str()?;
        let marker = format!("name=\"{name}\"\r\n\r\n");
        let start = text.find(&marker)? + marker.len();
        Some(&text[start..start + text[start..].find("\r\n")?])
    }

    #[gpui::test]
    fn drug_catalog_file_flow_counts_declares_source_and_confirms_a_reduction_twice(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = notes_recovery_tests::Host::new();
        let access = Arc::new(
            host.session
                .authenticate_local_host(
                    "Synthetic scales fixture passphrase",
                    RetirementNotice::new(None),
                )
                .unwrap(),
        );
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, _| {
            app.session = Some(host.session.clone());
            app.area = Area::Settings;
            app.settings_page = SettingsPage::References;
            app.local_host.authority = Authority::Open(access.clone());
        });
        let csv = Arc::new(b"code;name;active_ingredient;atc\nX0001;Farmaco inventato uno;Sostanza inventata;A01AA01\n".to_vec());

        // 1. Anteprima senza colonne: il server propone la mappatura, GPUI la mostra numerata da 1.
        host.plan(POST).send((200, preview(false))).unwrap();
        let (bytes, reader) = (csv.clone(), access.clone());
        view.update(cx, |app, cx| {
            app.local_host.references.busy = true;
            app.run_local_host(
                move || reader.preview_drug_catalog("/tmp/scelto/catalogo.csv", bytes, None),
                |this, result, cx| this.drug_catalog_previewed(result, cx),
                cx,
            )
        });
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            let area = &app.local_host.references.drug;
            assert_eq!(area.columns[0].read(cx).value(), "1");
            assert_eq!(area.columns[3].read(cx).value(), "4");
            assert_eq!(area.columns[4].read(cx).value(), "");
            assert_eq!(area.delimiter.read(cx).value(), ";");
            // Chi importa toglie l'ATC: il conteggio deve partire senza quella colonna.
            area.columns[3].update(cx, |input, cx| input.set_content("", cx));
        });
        let first = host.bodies(POST);
        assert_eq!(field(&first[0], "mode"), Some("preview"));
        assert_eq!(field(&first[0], "mapping"), None);
        assert!(
            first[0]
                .as_str()
                .unwrap()
                .contains("filename=\"catalogo.csv\""),
            "no local path in the upload"
        );

        // 2. Conteggio con le colonne scelte.
        host.plan(POST).send((200, preview(true))).unwrap();
        view.update(cx, |app, cx| app.count_drug_catalog(cx));
        cx.run_until_parked();
        let counted = &host.bodies(POST)[1];
        assert_eq!(
            serde_json::from_str::<Value>(field(counted, "mapping").unwrap()).unwrap(),
            json!({"delimiter":";","columns":{"codice":0,"denominazione":1,"principio_attivo":2}})
        );

        // 2b. Una colonna corretta dopo il conteggio non passa con la mappatura vecchia: va contata di nuovo.
        view.update(cx, |app, cx| {
            app.local_host.references.drug.columns[2]
                .update(cx, |input, cx| input.set_content("", cx));
            app.prepare_drug_catalog(cx);
            let area = &app.local_host.references.drug;
            assert!(area.command.is_none());
            assert!(
                area.message.as_ref().is_some_and(|(m, error)| *error
                    && m.starts_with("Le colonne o il separatore sono cambiati"))
            );
            area.columns[2].update(cx, |input, cx| input.set_content("3", cx));
            app.local_host
                .references
                .drug
                .delimiter
                .update(cx, |input, cx| input.set_content(",", cx));
            app.prepare_drug_catalog(cx);
            assert!(
                app.local_host.references.drug.command.is_none(),
                "a changed delimiter also needs a recount"
            );
            app.local_host
                .references
                .drug
                .delimiter
                .update(cx, |input, cx| input.set_content(";", cx));
            app.local_host.references.drug.message = None;
        });

        // 3. Fonte dichiarata e revisione: nessuna scrittura prima della conferma.
        let requests = host.request_count();
        view.update(cx, |app, cx| {
            let area = &app.local_host.references.drug;
            for (input, value) in area.source.iter().zip([
                "Agenzia inventata",
                "Codice inventato",
                "2026-11",
                "2026-11-01",
                "",
            ]) {
                input.update(cx, |input, cx| input.set_content(value, cx));
            }
            app.prepare_drug_catalog(cx);
            assert!(app.local_host.references.drug.command.is_some());
        });
        assert_eq!(host.request_count(), requests);
        let ids = rendered_command::button_ids(|| {
            cx.update(|window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
            });
        });
        assert!(ids.iter().any(|id| id == "drug-catalog-confirm"), "{ids:?}");

        // 4. Il server chiede di confermare la riduzione: catalogo conservato, seconda conferma esplicita.
        let token = format!("{}:{}", "c".repeat(64), "d".repeat(64));
        host.plan(POST)
            .send((409, json!({"code":"DRUG_CATALOG_REDUCTION_CONFIRMATION_REQUIRED","confirmation":token,"previousCount":10,"nextCount":2,"error":"riduzione"})))
            .unwrap();
        view.update(cx, |app, cx| app.commit_drug_catalog(cx));
        cx.run_until_parked();
        view.update(cx, |app, _| {
            let area = &app.local_host.references.drug;
            assert_eq!(area.reduction, Some((10, 2)));
            assert!(
                area.command
                    .as_ref()
                    .is_some_and(|c| c.reduction_confirmed())
            );
            assert!(area.receipt.is_none());
        });

        // 5. Seconda conferma: sostituzione, rilettura del catalogo e ricevuta.
        let status = json!({"count":2,"state":"ready","manifest":null,"snapshot":SNAPSHOT_AFTER});
        host.plan(POST)
            .send((
                200,
                json!({"count":2,"state":"ready","manifest":null,"snapshot":SNAPSHOT_AFTER,
                "imported":{"sha256":"a".repeat(64),"rowCount":2,"agency":"Agenzia inventata"}}),
            ))
            .unwrap();
        host.plan("GET /api/drugs")
            .send((200, status.clone()))
            .unwrap();
        host.plan("GET /api/drugs").send((200, status)).unwrap();
        view.update(cx, |app, cx| app.commit_drug_catalog(cx));
        cx.run_until_parked();
        let commits = host.bodies(POST);
        let last = &commits[3];
        assert_eq!(field(last, "mode"), Some("commit"));
        assert_eq!(field(last, "confirmed"), Some("true"));
        assert_eq!(field(last, "reductionConfirmation"), Some(token.as_str()));
        assert_eq!(field(last, "expectedSnapshot"), Some(SNAPSHOT_BEFORE));
        assert_eq!(
            field(&commits[2], "reductionConfirmation"),
            None,
            "the first confirmation never forces a reduction"
        );
        assert_eq!(
            serde_json::from_str::<Value>(field(last, "source").unwrap()).unwrap(),
            json!({"agency":"Agenzia inventata","codeSystem":"Codice inventato","version":"2026-11","date":"2026-11-01","sourceUrl":null})
        );
        view.update(cx, |app, _| {
            let area = &app.local_host.references.drug;
            assert!(area.command.is_none() && area.preview.is_none());
            assert_eq!(area.receipt.as_ref().unwrap()["count"], 2);
            assert!(
                area.message.as_ref().is_some_and(
                    |(m, error)| !error && m.starts_with("Catalogo sostituito: 2 voci")
                )
            );
            assert_eq!(
                app.local_host.references.snapshot.as_ref().unwrap().data["count"],
                2
            );
        });
    }

    #[gpui::test]
    fn drug_catalog_reports_server_refusals_and_a_changed_catalog_without_writing(
        cx: &mut gpui::TestAppContext,
    ) {
        let host = notes_recovery_tests::Host::new();
        let access = Arc::new(
            host.session
                .authenticate_local_host(
                    "Synthetic scales fixture passphrase",
                    RetirementNotice::new(None),
                )
                .unwrap(),
        );
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, _| {
            app.session = Some(host.session.clone());
            app.area = Area::Settings;
            app.settings_page = SettingsPage::References;
            app.local_host.authority = Authority::Open(access.clone());
        });
        host.plan(POST)
            .send((400, json!({"error":"Il file deve essere un CSV UTF-8."})))
            .unwrap();
        let reader = access.clone();
        view.update(cx, |app, cx| {
            app.run_local_host(
                move || reader.preview_drug_catalog("x.csv", Arc::new(vec![0xff, 0xfe]), None),
                |this, result, cx| this.drug_catalog_previewed(result, cx),
                cx,
            )
        });
        cx.run_until_parked();
        view.update(cx, |app, _| {
            let area = &app.local_host.references.drug;
            assert!(area.preview.is_none());
            assert_eq!(
                area.message,
                Some(("Il file deve essere un CSV UTF-8.".into(), true))
            );
        });

        host.plan(POST).send((200, preview(true))).unwrap();
        let reader = access.clone();
        view.update(cx, |app, cx| {
            app.run_local_host(
                move || {
                    reader.preview_drug_catalog(
                        "catalogo.csv",
                        Arc::new(b"a;b\n1;2\n".to_vec()),
                        Some(&json!({"delimiter":";","columns":{"codice":0,"denominazione":1}})),
                    )
                },
                |this, result, cx| this.drug_catalog_previewed(result, cx),
                cx,
            )
        });
        cx.run_until_parked();
        view.update(cx, |app, cx| {
            for (input, value) in
                app.local_host
                    .references
                    .drug
                    .source
                    .iter()
                    .zip(["A", "B", "1", "2026-11-01", ""])
            {
                input.update(cx, |input, cx| input.set_content(value, cx));
            }
            app.prepare_drug_catalog(cx);
        });
        host.plan(POST)
            .send((409, json!({"code":"DRUG_CATALOG_CHANGED","error":"Il catalogo è cambiato dopo l’anteprima: ripeti l’anteprima."})))
            .unwrap();
        view.update(cx, |app, cx| app.commit_drug_catalog(cx));
        cx.run_until_parked();
        view.update(cx, |app, _| {
            let area = &app.local_host.references.drug;
            let retained = area
                .preview
                .as_ref()
                .expect("a conflict must preserve the selected file and mapping");
            assert_eq!(retained.file_name(), "catalogo.csv");
            assert_eq!(retained.bytes().as_ref(), b"a;b\n1;2\n");
            assert!(area.command.is_none() && area.receipt.is_none());
            assert_eq!(
                area.message.as_ref().map(|(m, _)| m.as_str()),
                Some("Il catalogo è cambiato dopo l’anteprima: ripeti l’anteprima.")
            );
        });
        let requests = host.request_count();
        view.update(cx, |app, cx| app.commit_drug_catalog(cx));
        cx.run_until_parked();
        assert_eq!(
            host.request_count(),
            requests,
            "no implicit retry after conflict"
        );
        assert!(
            !host
                .routes()
                .iter()
                .any(|r| r.starts_with("GET /api/drugs")),
            "no reread is claimed after a refused commit"
        );
    }
}

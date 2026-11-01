use super::*;
use mediflow_runtime_client::{
    PreparedReferenceImport, ReferenceCatalog, ReferenceImportResult, ReferenceStatus,
};
use serde_json::{Value, json};

pub(super) struct ReferencesArea {
    catalog: ReferenceCatalog,
    snapshot: Option<ReferenceStatus>,
    pub(super) preview: Option<Arc<PreparedReferenceImport>>,
    pub(super) busy: bool,
    message: Option<String>,
    receipt: Option<Value>,
    in_flight: Option<Arc<PreparedReferenceImport>>,
    source_status: Option<Value>,
    progress: Option<Value>,
    pub(super) who_consent: bool,
    fields: [Entity<TextInput>; 3],
    prosthetics_fields: Vec<Entity<TextInput>>,
    source_entries: Option<Value>,
    pub(super) document: Option<Arc<mediflow_runtime_client::PreparedProstheticsDocument>>,
}
const PROSTHETICS_FIELD_LABELS: [&str; 13] = [
    "Posizione codice sistema",
    "Posizione codice",
    "Posizione descrizione",
    "Posizione versione",
    "Posizione fonte",
    "Posizione ambito",
    "Posizione data inizio",
    "Posizione data fine",
    "Separatore (, oppure ;)",
    "Ente della fonte",
    "Data della fonte YYYY-MM-DD",
    "Note della fonte",
    "Pagina originale (facoltativa)",
];
impl ReferencesArea {
    pub(super) fn new(theme: Theme, cx: &mut Context<ClinicalApp>) -> Self {
        Self {
            catalog: ReferenceCatalog::Aifa,
            snapshot: None,
            preview: None,
            busy: false,
            message: None,
            receipt: None,
            in_flight: None,
            source_status: None,
            progress: None,
            who_consent: false,
            source_entries: None,
            document: None,
            prosthetics_fields: PROSTHETICS_FIELD_LABELS
                .into_iter()
                .enumerate()
                .map(|(i, label)| {
                    cx.new(|cx| {
                        TextInput::new(
                            [
                                "prosthetics-option-0",
                                "prosthetics-option-1",
                                "prosthetics-option-2",
                                "prosthetics-option-3",
                                "prosthetics-option-4",
                                "prosthetics-option-5",
                                "prosthetics-option-6",
                                "prosthetics-option-7",
                                "prosthetics-option-8",
                                "prosthetics-option-9",
                                "prosthetics-option-10",
                                "prosthetics-option-11",
                                "prosthetics-option-12",
                            ][i],
                            label,
                            label,
                            false,
                            theme,
                            cx,
                        )
                    })
                })
                .collect(),
            fields: [
                ("aifa-source", "URL fonte"),
                ("aifa-date", "Data di scarico YYYY-MM-DD"),
                ("aifa-version", "Versione dataset"),
            ]
            .map(|(id, label)| cx.new(|cx| TextInput::new(id, label, label, false, theme, cx))),
        }
    }
    pub(super) fn withdraw(&mut self, cx: &mut App) {
        if let Some(c) = self.in_flight.take() {
            c.cancel_acquisition();
        }
        self.source_status = None;
        self.progress = None;
        self.snapshot = None;
        self.preview = None;
        self.busy = false;
        self.message = None;
        self.receipt = None;
        self.who_consent = false;
        self.source_entries = None;
        self.document = None;
        for field in self.fields.iter().chain(self.prosthetics_fields.iter()) {
            field.update(cx, |input, cx| input.retire(cx));
        }
    }
    pub(super) fn configure(&mut self, theme: Theme, cx: &mut Context<ClinicalApp>) {
        for field in self.fields.iter().chain(self.prosthetics_fields.iter()) {
            field.update(cx, |input, cx| {
                input.configure(
                    theme,
                    self.busy || self.preview.is_some() || self.document.is_some(),
                    cx,
                )
            });
        }
    }
}
fn line(label: &str, value: impl AsRef<str>, theme: Theme) -> Div {
    div().min_w_0().text_color(theme.secondary).child({
        let text = gpui::Text::new(
            gpui::ElementId::Name(label.to_owned().into()),
            format!("{label}: {}", value.as_ref()).into(),
        );
        #[cfg(test)]
        let text = rendered_command::observe_text(text);
        text
    })
}
fn exemption_sample(value: &Value) -> Vec<(&'static str, String)> {
    let mut rows = Vec::new();
    for (key, label) in [
        ("type", "Tipo"),
        ("isPharma", "Ambito farmaceutico"),
        ("isSpecialist", "Ambito specialistico"),
        ("isNational", "Nazionale"),
    ] {
        let text = match &value[key] {
            Value::Bool(true) => "Sì".into(),
            Value::Bool(false) => "No".into(),
            Value::String(s) if !s.is_empty() => s.clone(),
            _ => "Non indicato".into(),
        };
        rows.push((label, text));
    }
    for (key, label) in [
        ("startDate", "Inizio validità dichiarata"),
        ("endDate", "Fine validità dichiarata"),
    ] {
        let text = value[key]
            .as_i64()
            .and_then(|t| chrono::DateTime::from_timestamp(t, 0))
            .map(|d| d.format("%d/%m/%Y").to_string())
            .unwrap_or_else(|| "Non indicata".into());
        rows.push((label, text));
    }
    rows
}
fn aifa_outcome(receipt: &Value) -> &'static str {
    if receipt["rejectedRecords"].as_u64().is_some_and(|n| n > 0) {
        "Importazione AIFA parziale registrata. Verifica le righe scartate e i motivi nella ricevuta."
    } else if receipt["review"]["duplicateRows"]
        .as_u64()
        .is_some_and(|n| n > 0)
    {
        "Importazione AIFA con duplicati registrata. Per ogni AIC è stata conservata l’ultima riga."
    } else {
        "Operazione registrata."
    }
}
fn diagnostics_warning(value: &Value) -> Option<String> {
    (value["diagnosticsTruncated"] == true).then(|| {
        if !value["rejectedRecords"].is_number() {
            return "Mostrati i primi 200 errori. Correggi il file e ripeti l’anteprima.".into();
        }
        let shown = value["diagnostics"].as_array().map_or(0, Vec::len);
        let total = value["rejectedRecords"].as_u64().unwrap_or(0)
            + value["duplicateRows"].as_u64().unwrap_or(0);
        format!("Mostrati {shown} motivi su {total} totali. L’elenco è incompleto.")
    })
}
fn details(value: &Value, theme: Theme) -> Div {
    let mut pane = div().min_w_0().flex().flex_col().gap(px(6.));
    if let Some(warning) = diagnostics_warning(value) {
        pane = pane.child(line("Diagnostiche", warning, theme));
    }
    let exemption = value.get("isPharma").is_some()
        || value.get("isSpecialist").is_some()
        || value.get("isNational").is_some();
    if exemption {
        for (label, text) in exemption_sample(value) {
            pane = pane.child(line(label, text, theme));
        }
    }
    for (key, label) in [
        ("state", "Stato"),
        ("totalRecords", "Righe totali"),
        ("rejectedRecords", "Righe scartate"),
        ("count", "Voci"),
        ("sourceCount", "Fonti locali"),
        ("revision", "Revisione"),
        ("sourceName", "File"),
        ("sourceUrl", "Fonte"),
        ("source", "Fonte"),
        ("authority", "Ente"),
        ("scope", "Ambito"),
        ("name", "Nome"),
        ("codeSystem", "Codifica"),
        ("code", "Codice"),
        ("description", "Descrizione"),
        ("version", "Versione"),
        ("release", "Release"),
        ("releaseId", "Release"),
        ("language", "Lingua"),
        ("downloadedAt", "Scaricato il"),
        ("importedAt", "Importato il"),
        ("committedAt", "Registrato il"),
        ("date", "Data della fonte"),
        ("versionDate", "Data della versione WHO"),
        ("startDate", "Inizio validità dichiarata"),
        ("endDate", "Fine validità dichiarata"),
        ("sha256", "SHA-256"),
        ("sourceSha256", "SHA-256"),
        ("bytes", "Byte"),
        ("byteLength", "Byte"),
        ("rowCount", "Righe"),
        ("rows", "Righe"),
        ("categories", "Categorie"),
        ("withoutCode", "Righe senza codice escluse"),
        ("validRows", "Righe valide"),
        ("errorCount", "Errori"),
        ("duplicateRows", "Duplicati"),
        ("total", "Totali"),
        ("valid", "Valide"),
        ("invalid", "Non valide"),
        ("duplicates", "Duplicati"),
        ("errors", "Errori"),
        ("inserted", "Nuove"),
        ("updated", "Aggiornate"),
        ("unchanged", "Invariate"),
        ("applied", "Applicate"),
        ("line", "Riga"),
        ("row", "Riga"),
        ("column", "Colonna"),
        ("message", "Messaggio"),
        ("nonNullValues", "Valori esclusi"),
        ("previousCount", "Voci precedenti"),
        ("nextCount", "Voci proposte"),
        ("notes", "Note"),
        ("size", "Byte"),
        ("page", "Pagina o sezione"),
    ] {
        if exemption && matches!(key, "startDate" | "endDate") {
            continue;
        }
        let v = &value[key];
        let text = match v {
            Value::String(s) => Some(
                match s.as_str() {
                    "ready" => "Pronto",
                    "absent" | "not-imported" => "Assente",
                    "unverified" => "Non verificato",
                    _ => s,
                }
                .to_owned(),
            ),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        };
        if let Some(text) = text {
            pane = pane.child(div().id(key).child(line(label, text, theme)));
        }
    }
    for key in [
        "manifest",
        "metadata",
        "counts",
        "changes",
        "latestReceipt",
        "receipt",
        "reduction",
        "review",
    ] {
        if value[key].is_object() {
            pane = pane.child(div().id(key).child(details(&value[key], theme)));
        }
    }
    for (key, label) in [
        ("sample", "Campione"),
        ("diagnostics", "Errore"),
        ("excludedColumns", "Colonna esclusa"),
        ("sources", "Fonte"),
        ("documents", "Originale"),
    ] {
        if let Some(rows) = value[key].as_array() {
            if rows.is_empty() {
                pane = pane.child(line(label, "Nessuno", theme));
            }
            for (index, row) in rows.iter().enumerate() {
                pane = pane.child(div().id((key, index)).child(if let Some(s) = row.as_str() {
                    line(label, s, theme)
                } else {
                    details(row, theme)
                }));
            }
        }
    }
    pane
}
impl ClinicalApp {
    pub(in crate::shell) fn read_reference_catalog(&mut self, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        let catalog = self.local_host.references.catalog;
        let area = &mut self.local_host.references;
        area.busy = true;
        area.snapshot = None;
        area.preview = None;
        area.who_consent = false;
        area.message = None;
        self.run_local_host(
            move || access.read_reference_catalog(catalog),
            |this, result, cx| {
                let area = &mut this.local_host.references;
                area.busy = false;
                match result {
                    Ok(s) => area.snapshot = Some(s),
                    Err(e) => area.message = Some(ui_error(e)),
                }
                cx.notify();
            },
            cx,
        );
        cx.notify();
    }
    fn aifa_activity_view(&self, cx: &Context<Self>) -> Div {
        let area = &self.local_host.references;
        let theme = self.theme;
        let mut pane = div().flex().flex_col().gap(px(8.));
        if area
            .in_flight
            .as_ref()
            .is_some_and(|c| c.acquisition_cancellable())
        {
            pane=pane.child(button("aifa-progress-read","Rileggi avanzamento",theme,false,true).on_click(cx.listener(|this,_,_,cx|this.read_aifa_progress(cx))))
                        .child(button("aifa-download-cancel","Interrompi acquisizione AIFA",theme,false,true).on_click(cx.listener(|this,_,_,cx| {
                            if let Some(c)=&this.local_host.references.in_flight {c.cancel_acquisition();}
                            this.local_host.references.message=Some("Interruzione richiesta. L’esito potrebbe essere già registrato: rileggi il catalogo al termine.".into());cx.notify();
                        })));
        }
        if let Some(p) = area.progress.as_ref().and_then(|p| p.get("progress")) {
            pane = pane.child(line(
                "Acquisizione osservata sulla postazione",
                if p.is_null() {
                    "Nessuna acquisizione attiva".into()
                } else {
                    format!(
                        "{}: {} byte ricevuti su {}",
                        if p["phase"] == "validating" {
                            "Validazione"
                        } else {
                            "Download"
                        },
                        p["receivedBytes"],
                        p["totalBytes"]
                            .as_u64()
                            .map(|n| n.to_string())
                            .unwrap_or_else(|| "totale non noto".into())
                    )
                },
                theme,
            ));
        }
        pane
    }
    fn change_aifa_network(&mut self, expected: bool, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        self.local_host.references.busy = true;
        self.run_local_host(
            move || access.set_aifa_network_preference(expected, !expected),
            |this, result, cx| {
                let area = &mut this.local_host.references;
                area.busy = false;
                match result {
                    Ok(v) => {
                        area.source_status = Some(v);
                        area.message =
                            Some("Preferenza di accesso Internet AIFA salvata e riletta.".into());
                    }
                    Err(e) => {
                        area.source_status = None;
                        area.message = Some(format!(
                            "{} Rileggi la preferenza prima di riprovare.",
                            ui_error(e)
                        ));
                    }
                }
                cx.notify();
            },
            cx,
        );
    }
    fn read_aifa_source(&mut self, remote: bool, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        self.local_host.references.busy = true;
        self.run_local_host(
            move || access.aifa_source_status(remote),
            |this, result, cx| {
                this.local_host.references.busy = false;
                match result {
                    Ok(v) => this.local_host.references.source_status = Some(v),
                    Err(e) => {
                        this.local_host.references.source_status = None;
                        this.local_host.references.message = Some(ui_error(e));
                    }
                }
                cx.notify();
            },
            cx,
        );
    }
    fn read_aifa_progress(&mut self, cx: &mut Context<Self>) {
        let Some(access) = self.local_host.access() else {
            return;
        };
        self.run_local_host(
            move || access.aifa_download_progress(),
            |this, result, cx| {
                match result {
                    Ok(v) => this.local_host.references.progress = Some(v),
                    Err(e) => {
                        this.local_host.references.progress = None;
                        this.local_host.references.message = Some(ui_error(e));
                    }
                }
                cx.notify();
            },
            cx,
        );
    }
    fn pick_reference_file(&mut self, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        let area = &mut self.local_host.references;
        let catalog = area.catalog;
        if catalog == ReferenceCatalog::Who {
            return;
        }
        let metadata = if catalog == ReferenceCatalog::Prosthetics {
            match prosthetics_options(
                &area
                    .prosthetics_fields
                    .iter()
                    .map(|f| f.read(cx).value().to_owned())
                    .collect::<Vec<_>>(),
            ) {
                Ok(value) => value,
                Err(message) => {
                    area.message = Some(message.into());
                    cx.notify();
                    return;
                }
            }
        } else {
            json!({"sourceUrl":area.fields[0].read(cx).value(),"downloadedAt":area.fields[1].read(cx).value(),"version":area.fields[2].read(cx).value()})
        };
        area.busy = true;
        area.preview = None;
        area.receipt = None;
        area.message = None;
        let generation = self.local_host.generation;
        let chosen = cx.prompt_for_paths(gpui::PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Scegli il file del repertorio".into()),
        });
        cx.spawn(async move |this, cx| {
            let result = chosen.await;
            let _ = this.update(cx, |this, cx| {
                if this.local_host.generation != generation {
                    return;
                }
                match result {
                    Ok(Ok(Some(paths))) if paths.len() == 1 => {
                        let path = paths.into_iter().next().unwrap();
                        this.run_local_host(
                            move || {
                                let bytes = archives::read_selected(&path, catalog.file_limit())
                                    .map_err(|_| RuntimeError::InvalidInput)?;
                                let name = path
                                    .file_name()
                                    .and_then(|n| n.to_str())
                                    .ok_or(RuntimeError::InvalidInput)?;
                                access
                                    .prepare_reference_file(catalog, name, &bytes, metadata)
                                    .map(Arc::new)
                            },
                            |this, result, cx| {
                                let area = &mut this.local_host.references;
                                area.busy = false;
                                match result {
                                    Ok(p) => area.preview = Some(p),
                                    Err(e) => area.message = Some(ui_error(e)),
                                }
                                cx.notify();
                            },
                            cx,
                        );
                    }
                    _ => {
                        this.local_host.references.busy = false;
                        cx.notify();
                    }
                }
            });
        })
        .detach();
        cx.notify();
    }
    fn acquire_who_preview(&mut self, cx: &mut Context<Self>) {
        if self.local_host.has_work() || !self.local_host.references.who_consent {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        let area = &mut self.local_host.references;
        area.busy = true;
        area.who_consent = false;
        area.message = None;
        area.preview = None;
        area.receipt = None;
        self.run_local_host(
            move || access.prepare_who_acquisition().map(Arc::new),
            |this, result, cx| {
                let area = &mut this.local_host.references;
                area.busy = false;
                match result {
                    Ok(p) => area.preview = Some(p),
                    Err(e) => {
                        area.message = Some(format!(
                            "{} Rileggi lo stato prima di riprovare.",
                            ui_error(e)
                        ))
                    }
                }
                cx.notify();
            },
            cx,
        );
        cx.notify();
    }
    fn commit_reference_import(&mut self, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        let Some(command) = self.local_host.references.preview.take() else {
            return;
        };
        if !command.can_commit() {
            return;
        }
        let catalog = command.catalog();
        self.local_host.references.busy = true;
        self.local_host.references.message = None;
        self.local_host.references.in_flight = Some(command.clone());
        let retained = command.clone();
        self.run_local_host(move || {
            let result=access.commit_reference_import(&command)?;
            let status=if matches!(result,ReferenceImportResult::Recorded(_)) {Some(access.read_reference_catalog(catalog))} else {None};
            Ok((result,status))
        },move |this,result,cx| {
            let area=&mut this.local_host.references;area.busy=false;area.in_flight=None;
            match result {
                Ok((ReferenceImportResult::CatalogChanged,_)) => {
                    area.preview=Some(retained);
                    area.message=Some("Il catalogo AIFA è cambiato dopo l’anteprima. Importazione non applicata; bozza conservata. Scarta l’anteprima e preparala di nuovo sul catalogo corrente.".into());
                },
                Ok((ReferenceImportResult::Reduction(p),_))=> {area.preview=Some(Arc::new(p));area.message=Some("Il file riduce il catalogo. Verifica i conteggi e conferma di nuovo solo se intendi applicare la riduzione.".into());},
                Ok((ReferenceImportResult::Recorded(receipt),reread))=> {
                    area.receipt=Some(receipt.clone());
                    match reread {
                        Some(Ok(s))=> {
                            let same=if catalog==ReferenceCatalog::Aifa {s.data["manifest"]==receipt["manifest"]}
                                else if catalog==ReferenceCatalog::Who {s.data["revision"]==receipt["revision"]}
                                else {s.data["revision"]==receipt["receipt"]["revision"] && s.data["latestReceipt"]["operationKey"]==receipt["receipt"]["operationKey"]};
                            area.snapshot=Some(s);area.message=Some(if same {format!("{} Stato riletto.", aifa_outcome(&receipt))}else{format!("{} Il repertorio è cambiato dopo l’import. Verifica lo stato corrente.", aifa_outcome(&receipt))});
                        },
                        Some(Err(e)) if e.retires_session()=> { this.disconnect(cx);this.message=Some((ui_error(e),true));cx.notify();return; },
                        _=>{area.snapshot=None;area.message=Some(format!("{} Rilettura non riuscita. Rileggi lo stato.", aifa_outcome(&receipt)));}
                    }
                },
                Err(e)=>{area.snapshot=None;area.message=Some(format!("{} L’esito potrebbe non essere noto. Rileggi lo stato prima di una nuova anteprima.",ui_error(e)));}
            } cx.notify();
        },cx);
        cx.notify();
    }
    pub(in crate::shell) fn reference_administration_view(&self, cx: &Context<Self>) -> Div {
        let theme = self.theme;
        let area = &self.local_host.references;
        let mut pane = div()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(16.))
            .child(heading("references-heading", "Repertori", theme))
            .child(self.local_host_panel(cx));
        if self.local_host.access().is_none() {
            return pane;
        }
        let enabled = !self.local_host.has_work();
        pane = pane
            .child(
                div().flex().flex_wrap().gap(px(8.)).children(
                    ReferenceCatalog::ALL
                        .into_iter()
                        .enumerate()
                        .map(|(i, catalog)| {
                            button(
                                format!("references-select-{i}"),
                                catalog.title(),
                                theme,
                                false,
                                enabled,
                            )
                            .aria_selected(area.catalog == catalog)
                            .on_click(cx.listener(
                                move |this, _, _, cx| {
                                    if this.local_host.has_work() {
                                        return;
                                    }
                                    let area = &mut this.local_host.references;
                                    area.document = None;
                                    area.source_entries = None;
                                    area.source_status = None;
                                    area.progress = None;
                                    area.catalog = catalog;
                                    area.snapshot = None;
                                    area.preview = None;
                                    area.message = None;
                                    area.receipt = None;
                                    area.who_consent = false;
                                    this.read_reference_catalog(cx);
                                },
                            ))
                        }),
                ),
            )
            .child(section("reference-selected", area.catalog.title(), theme))
            .child(
                button(
                    "references-read",
                    "Rileggi stato e fonti",
                    theme,
                    false,
                    enabled,
                )
                .on_click(cx.listener(|this, _, _, cx| this.read_reference_catalog(cx))),
            );
        if area.busy {
            return pane
                .child(notice(
                    "references-busy",
                    "Operazione in corso…",
                    theme,
                    false,
                ))
                .child(self.aifa_activity_view(cx));
        }
        if let Some(message) = &area.message {
            pane = pane.child(notice("references-message", message.clone(), theme, false));
        }
        if let Some(snapshot) = &area.snapshot {
            if area.catalog == ReferenceCatalog::Who {
                pane = pane
                    .child(line(
                        "Catalogo incorporato",
                        if snapshot.data["enabled"] == true {
                            "Abilitato dal gestore"
                        } else {
                            "Disattivato dal gestore"
                        },
                        theme,
                    ))
                    .child(line(
                        "Versione precedente",
                        if snapshot.data["previousAvailable"] == true {
                            "Conservata"
                        } else {
                            "Non disponibile"
                        },
                        theme,
                    ));
            }
            pane=pane.child(div().id("reference-status").child(details(&snapshot.data,theme))).child(text!("La lettura locale non attesta che questa sia l’ultima pubblicazione della fonte. Le ricevute documentano l’import locale, non la validità normativa."));
            if snapshot.data["latestReceipt"].is_null()
                && matches!(
                    area.catalog,
                    ReferenceCatalog::Exemptions | ReferenceCatalog::Prosthetics
                )
            {
                pane=pane.child(text!("Nessuna ricevuta di import disponibile. La provenienza delle voci precedenti non è attestata."));
            }
            if let Some(sources) = &snapshot.sources {
                pane = pane.child(div().id("reference-sources").child(match sources {
                    Ok(v) => details(v, theme),
                    Err(e) => div().child(notice(
                        "references-source-error",
                        format!("Fonti non leggibili: {}", ui_error(*e)),
                        theme,
                        true,
                    )),
                }));
            }
        } else {
            pane = pane.child(text!("Stato non disponibile. Rileggi il repertorio."));
        }
        if let Some(receipt) = &area.receipt {
            pane = pane
                .child(section("reference-receipt", "Ricevuta registrata", theme))
                .child(details(receipt, theme));
        }
        if let Some(preview) = &area.preview {
            pane = pane
                .child(section("reference-preview", "Anteprima", theme))
                .child(details(preview.data(), theme));
            pane=pane.child(text!(if preview.data()["acquisition"]==true {"Scarica il feed ufficiale AIFA via Internet. Nessun dato clinico viene inviato. Il catalogo viene validato e sostituito al completamento; una riduzione richiede una seconda conferma."}else if area.catalog==ReferenceCatalog::Aifa {"Verifica righe scartate, motivi e duplicati. Le righe scartate non vengono importate. Il servizio sostituisce il catalogo con le righe importabili. Il servizio verifica la versione del catalogo prima di sostituirlo. Se è cambiata, l’importazione viene fermata e la bozza resta disponibile."}else if area.catalog==ReferenceCatalog::Exemptions {"Sono importate solo le otto colonne previste. I campi esclusi non sono interpretati. I codici assenti restano; le esenzioni dei pazienti non cambiano."}else{"Verifica fonte, versione, ambito e campi. Cambia solo il repertorio; i dati clinici salvati non cambiano."}));
            if preview.can_commit() {
                pane = pane.child(
                    button(
                        "references-confirm",
                        if preview.data()["review"]["rejectedRecords"]
                            .as_u64()
                            .is_some_and(|n| n > 0)
                        {
                            "Conferma importazione parziale con gli scarti indicati"
                        } else if preview.data()["reduction"].is_object() {
                            "Conferma riduzione e importazione"
                        } else {
                            "Confermo fonte e campi: applica al repertorio"
                        },
                        theme,
                        false,
                        enabled,
                    )
                    .on_click(cx.listener(|this, _, _, cx| this.commit_reference_import(cx))),
                );
            } else {
                pane = pane.child(text!(
                    "Import bloccato. Correggi il file e genera una nuova anteprima."
                ));
            }
            return pane.child(
                button(
                    "references-cancel",
                    "Scarta anteprima",
                    theme,
                    false,
                    enabled,
                )
                .on_click(cx.listener(|this, _, _, cx| {
                    this.local_host.references.preview = None;
                    cx.notify();
                })),
            );
        }
        match area.catalog {
            ReferenceCatalog::Aifa => {
                pane=pane.child(text!("Confezioni AIFA, dati descrittivi e provvisori. Non certificano disponibilità, rimborsabilità o appropriatezza. File CSV locale fino a 100 MiB. Fonte: https://drive.aifa.gov.it/farmaci/confezioni_fornitura.csv. Condizioni: https://www.aifa.gov.it/copyright."));
                pane = pane.child(
                    button(
                        "references-aifa-update",
                        "Aggiorna da AIFA…",
                        theme,
                        false,
                        enabled && area.snapshot.is_some(),
                    )
                    .on_click(cx.listener(|this, _, _, cx| this.prepare_aifa_acquisition(cx))),
                );
                for field in &area.fields {
                    pane = pane.child(field.clone());
                }
                pane = pane.child(text!(
                    "Svuotamento amministrativo non disponibile. Il catalogo resta conservato."
                ));
                pane = pane.child(
                    div()
                        .flex()
                        .flex_wrap()
                        .gap(px(8.))
                        .child(
                            button(
                                "aifa-source-read",
                                "Rileggi freschezza della fonte",
                                theme,
                                false,
                                enabled,
                            )
                            .on_click(
                                cx.listener(|this, _, _, cx| this.read_aifa_source(false, cx)),
                            ),
                        )
                        .child(
                            button(
                                "aifa-source-check",
                                "Verifica pubblicazione su AIFA",
                                theme,
                                false,
                                enabled,
                            )
                            .on_click(
                                cx.listener(|this, _, _, cx| this.read_aifa_source(true, cx)),
                            ),
                        ),
                );
                if let Some(status) = &area.source_status {
                    let expected = status["networkPreference"] == true;
                    pane=pane.child(button("aifa-network-preference",if expected {"Disattiva verifiche e download AIFA via Internet"}else{"Consenti verifiche e download del catalogo pubblico AIFA via Internet"},theme,false,enabled).on_click(cx.listener(move|this,_,_,cx|this.change_aifa_network(expected,cx))));
                    pane = pane
                        .child(line(
                            "Ultima verifica della fonte",
                            display_date(status["remote"]["checkedAt"].as_str()),
                            theme,
                        ))
                        .child(line(
                            "Pubblicazione",
                            match status["remote"]["outcome"].as_str() {
                                Some("unchanged") => "Invariata rispetto al catalogo locale",
                                Some("available") => "Pubblicazione disponibile da valutare",
                                _ => "Freschezza non verificabile",
                            },
                            theme,
                        ))
                        .child(line(
                            "Accesso Internet AIFA",
                            if status["networkAllowed"] == true {
                                "Consentito dalla postazione"
                            } else {
                                "Disattivato sulla postazione"
                            },
                            theme,
                        ));
                }
                pane = pane.child(self.aifa_activity_view(cx));
            }
            ReferenceCatalog::Exemptions => {
                pane=pane.child(text!("File UTF-8 con separatore |, massimo 2 MiB e 20.000 righe. Colonne: CD_ESENZIONE, DS_ESENZIONE, CD_TIPO_ESENZIONE, DT_INIZIO_VALIDITA, DT_FINE_VALIDITA, FL_AMBITO_FARMACEUTICO, FL_AMBITO_SPECIALISTICO, FL_NAZIONALE. Anteprima e conferma obbligatorie."));
            }
            ReferenceCatalog::Prosthetics => {
                pane=pane.child(text!("CSV UTF-8, virgola o punto e virgola, massimo 2 MiB e 20.000 righe. Colonne: codice_sistema,codice,descrizione,versione,fonte,ambito,data_inizio,data_fine. Una codifica, versione, fonte e ambito per file. Errori e duplicati bloccano l’import. I codici assenti restano. Originali in chiaro: allega solo documenti di repertorio privi di dati dei pazienti. Le posizioni delle colonne partono da 1. Lascia tutte le posizioni vuote per usare le intestazioni. I metadati saranno applicati alla fonte con questo import."));
                for (index, field) in area.prosthetics_fields.iter().enumerate() {
                    pane = pane.child(
                        div()
                            .id(("prosthetics-field", index))
                            .flex()
                            .flex_col()
                            .gap(px(6.))
                            .child(text!(PROSTHETICS_FIELD_LABELS[index]))
                            .child(field.clone()),
                    );
                }
                pane = pane.child(self.prosthetics_sources_view(cx));
            }
            ReferenceCatalog::Who => {
                pane=pane.child(text!("ICD-11 MMS 2026-01, inglese. World Health Organization, CC BY-ND 3.0 IGO. Solo categorie e titoli inglesi, senza sinonimi o postcoordinazione. Il servizio locale opzionale resta gestito dall’host tramite Setup_WHO.command. Nessun import da file o svuotamento WHO disponibile. Il ripristino della versione precedente non è disponibile da questa pagina."));
                let can_acquire = area
                    .snapshot
                    .as_ref()
                    .is_some_and(|s| s.data["enabled"] == true);
                return if area.who_consent {
                    pane.child(text!("Scarica la SimpleTabulation MMS 2026-01 inglese da icdcdn.who.int. Non invia dati clinici. L’attivazione richiede una seconda conferma; il catalogo in uso resta disponibile."))
                        .child(button("references-who-download-confirm","Conferma download dell’anteprima WHO",theme,false,enabled && can_acquire).on_click(cx.listener(|this,_,_,cx|this.acquire_who_preview(cx))))
                        .child(button("references-who-download-cancel","Annulla",theme,false,enabled).on_click(cx.listener(|this,_,_,cx|{this.local_host.references.who_consent=false;cx.notify();})))
                } else {
                    pane.child(
                        button(
                            "references-who-download",
                            "Aggiorna dalla WHO…",
                            theme,
                            false,
                            enabled && can_acquire,
                        )
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.local_host.references.who_consent = true;
                            cx.notify();
                        })),
                    )
                };
            }
        }
        pane.child(
            button(
                "references-file",
                "Seleziona file e prepara anteprima",
                theme,
                false,
                enabled,
            )
            .on_click(cx.listener(|this, _, _, cx| this.pick_reference_file(cx))),
        )
    }
}

fn prosthetics_options(fields: &[String]) -> std::result::Result<Value, &'static str> {
    let mut options = json!({});
    if !fields[8].trim().is_empty() && !matches!(fields[8].trim(), "," | ";") {
        return Err("Il separatore deve essere una virgola o un punto e virgola.");
    }
    if fields[..8].iter().all(|s| s.trim().is_empty()) && fields[8].trim() == ";" {
        return Err("Per usare il punto e virgola indica tutte le otto posizioni delle colonne.");
    }

    if fields[..8].iter().any(|f| !f.trim().is_empty()) {
        let mut columns = json!({});
        for (i, key) in [
            "codice_sistema",
            "codice",
            "descrizione",
            "versione",
            "fonte",
            "ambito",
            "data_inizio",
            "data_fine",
        ]
        .iter()
        .enumerate()
        {
            let index = fields[i]
                .trim()
                .parse::<u8>()
                .ok()
                .filter(|i| (1..=100).contains(i))
                .ok_or("Indica tutte le otto posizioni delle colonne, da 1 a 100.")?;
            columns[*key] = json!(index - 1);
        }
        let delimiter = if fields[8].trim().is_empty() {
            ","
        } else {
            fields[8].trim()
        };
        if !matches!(delimiter, "," | ";") {
            return Err("Il separatore deve essere una virgola o un punto e virgola.");
        }
        options["mapping"] = json!({"delimiter":delimiter,"columns":columns});
    }
    if fields[9..12].iter().any(|s| !s.trim().is_empty()) {
        options["sourceDetails"] = json!({"authority":fields[9].trim(),"date":if fields[10].trim().is_empty(){Value::Null}else{json!(fields[10].trim())},"notes":fields[11].trim()});
    }
    Ok(options)
}
impl ClinicalApp {
    fn prepare_aifa_acquisition(&mut self, cx: &mut Context<Self>) {
        if self.local_host.has_work() || self.local_host.references.snapshot.is_none() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        match access.prepare_aifa_update() {
            Ok(command) => self.local_host.references.preview = Some(Arc::new(command)),
            Err(error) => self.local_host.references.message = Some(ui_error(error)),
        }
        cx.notify();
    }
    fn prosthetics_sources_view(&self, cx: &Context<Self>) -> Stateful<Div> {
        let area = &self.local_host.references;
        let enabled = !self.local_host.has_work();
        let mut pane = div()
            .id("prosthetics-source-management")
            .flex()
            .flex_col()
            .gap(px(12.));
        if let Some(command) = &area.document {
            let review = command.review();
            pane = pane
                .child(line(
                    "Fonte selezionata",
                    review["sourceId"].as_str().unwrap_or("Non indicata"),
                    self.theme,
                ))
                .child(line(
                    "Revisione del repertorio",
                    review["revision"].as_str().unwrap_or("Non indicata"),
                    self.theme,
                ))
                .child(line(
                    "Pagina o sezione",
                    review["page"].as_str().unwrap_or("Non indicata"),
                    self.theme,
                ))
                .child(line(
                    "Originale da allegare",
                    review["name"].as_str().unwrap_or("Non indicato"),
                    self.theme,
                ))
                .child(line(
                    "Impronta SHA-256",
                    review["sha256"].as_str().unwrap_or("Non indicata"),
                    self.theme,
                ))
                .child(text!(
                    "Conferma solo documenti di repertorio privi di dati dei pazienti."
                ))
                .child(
                    button(
                        "prosthetics-document-confirm",
                        "Conferma allegato originale",
                        self.theme,
                        true,
                        enabled,
                    )
                    .on_click(cx.listener(|this, _, _, cx| this.attach_prosthetics_original(cx))),
                )
                .child(
                    button(
                        "prosthetics-document-discard",
                        "Scarta allegato",
                        self.theme,
                        false,
                        enabled,
                    )
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.local_host.references.document = None;
                        cx.notify();
                    })),
                );
        }
        if let Some(entries) = &area.source_entries {
            let mut list = div()
                .id("prosthetics-source-entries")
                .flex()
                .flex_col()
                .gap(px(4.));
            if let Some(rows) = entries["entries"].as_array() {
                for (index, row) in rows.iter().enumerate() {
                    list = list.child(div().id(("entry", index)).child(line(
                        row["code"].as_str().unwrap_or("Codice"),
                        row["description"].as_str().unwrap_or("Non indicata"),
                        self.theme,
                    )));
                }
                if rows.is_empty() {
                    list = list.child(text!("Nessuna voce per questa fonte."));
                }
            }
            if entries["truncated"] == true {
                list = list.child(text!(
                    "Mostrate le prime 50 voci della fonte. L’elenco è incompleto."
                ));
            }
            pane = pane.child(list);
        }
        if let Some(Ok(sources)) = area.snapshot.as_ref().and_then(|s| s.sources.as_ref())
            && let Some(rows) = sources["sources"].as_array()
        {
            for source in rows {
                let Some(id) = source["id"].as_str() else {
                    continue;
                };
                let mut row = div()
                    .id(format!("prosthetics-source-{id}"))
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .child(line(
                        "Fonte",
                        source["name"].as_str().unwrap_or("Non indicata"),
                        self.theme,
                    ));
                let source_id = id.to_owned();
                let revision = sources["revision"].as_str().unwrap_or("").to_owned();
                row = row
                    .child(
                        button(
                            format!("prosthetics-entries-{id}"),
                            "Leggi le voci della fonte",
                            self.theme,
                            false,
                            enabled,
                        )
                        .on_click(cx.listener({
                            let source_id = source_id.clone();
                            move |this, _, _, cx| {
                                this.read_prosthetics_entries(source_id.clone(), cx)
                            }
                        })),
                    )
                    .child(
                        button(
                            format!("prosthetics-attach-{id}"),
                            "Allega originale alla fonte…",
                            self.theme,
                            false,
                            enabled && area.document.is_none(),
                        )
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.pick_prosthetics_original(source_id.clone(), revision.clone(), cx)
                        })),
                    );
                if let Some(documents) = source["documents"].as_array() {
                    for doc in documents {
                        let (Some(doc_id), Some(hash), Some(name)) = (
                            doc["id"].as_str(),
                            doc["sha256"].as_str(),
                            doc["name"].as_str(),
                        ) else {
                            continue;
                        };
                        let (doc_id, hash, name) =
                            (doc_id.to_owned(), hash.to_owned(), name.to_owned());
                        row = row.child(
                            button(
                                format!("prosthetics-original-{doc_id}"),
                                format!("Salva originale: {name}…"),
                                self.theme,
                                false,
                                enabled,
                            )
                            .on_click(cx.listener(
                                move |this, _, _, cx| {
                                    this.save_prosthetics_original(
                                        doc_id.clone(),
                                        hash.clone(),
                                        name.clone(),
                                        cx,
                                    )
                                },
                            )),
                        );
                    }
                }
                pane = pane.child(row);
            }
        }
        pane
    }
    fn read_prosthetics_entries(&mut self, id: String, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        self.local_host.references.busy = true;
        self.run_local_host(
            move || access.read_prosthetics_source_entries(&id),
            |this, result, cx| {
                let area = &mut this.local_host.references;
                area.busy = false;
                match result {
                    Ok(v) => area.source_entries = Some(v),
                    Err(e) => {
                        area.source_entries = None;
                        area.message = Some(ui_error(e));
                    }
                }
                cx.notify();
            },
            cx,
        );
    }
    fn pick_prosthetics_original(&mut self, id: String, revision: String, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        let page = self.local_host.references.prosthetics_fields[12]
            .read(cx)
            .value();
        let page = (!page.trim().is_empty()).then(|| page.trim().to_owned());
        let generation = self.local_host.generation;
        self.local_host.references.busy = true;
        let chosen = cx.prompt_for_paths(gpui::PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Scegli l’originale del repertorio, senza dati dei pazienti".into()),
        });
        cx.spawn(async move |this, cx| {
            let selected = chosen.await;
            let _ = this.update(cx, |this, cx| {
                if this.local_host.generation != generation {
                    return;
                }
                if let Ok(Ok(Some(paths))) = selected
                    && paths.len() == 1
                {
                    let path = paths[0].clone();
                    this.run_local_host(
                        move || {
                            let bytes = archives::read_selected(&path, 25 * 1024 * 1024)
                                .map_err(|_| RuntimeError::InvalidInput)?;
                            let name = path
                                .file_name()
                                .and_then(|n| n.to_str())
                                .ok_or(RuntimeError::InvalidInput)?;
                            access
                                .prepare_prosthetics_document(
                                    &id,
                                    &revision,
                                    name,
                                    &bytes,
                                    page.as_deref(),
                                )
                                .map(Arc::new)
                        },
                        |this, result, cx| {
                            let area = &mut this.local_host.references;
                            area.busy = false;
                            match result {
                                Ok(c) => area.document = Some(c),
                                Err(e) => area.message = Some(ui_error(e)),
                            }
                            cx.notify();
                        },
                        cx,
                    );
                } else {
                    this.local_host.references.busy = false;
                    cx.notify();
                }
            });
        })
        .detach();
    }
    fn attach_prosthetics_original(&mut self, cx: &mut Context<Self>) {
        if self.local_host.has_work() {
            return;
        }
        let (Some(access), Some(command)) = (
            self.local_host.access(),
            self.local_host.references.document.take(),
        ) else {
            return;
        };
        self.local_host.references.busy = true;
        self.run_local_host(move||{let receipt=access.attach_prosthetics_document(&command)?;let current=access.read_reference_catalog(ReferenceCatalog::Prosthetics);Ok((receipt,current))},|this,result,cx|{
            let area=&mut this.local_host.references;area.busy=false;
            match result {
                Ok((receipt,Ok(current)))=>{
                    let found=current.sources.as_ref().and_then(|s|s.as_ref().ok()).and_then(|v|v["sources"].as_array()).is_some_and(|sources|sources.iter().any(|s|s["documents"].as_array().is_some_and(|docs|docs.iter().any(|d|d["id"]==receipt["id"] && d["sha256"]==receipt["sha256"]))));
                    area.snapshot=Some(current);area.receipt=Some(receipt);area.message=Some(if found {"Originale allegato e riletto."}else{"Originale registrato. La rilettura non ne conferma la presenza: rileggi le fonti prima di riprovare."}.into());
                },
                Ok((receipt,Err(_)))=>{area.receipt=Some(receipt);area.snapshot=None;area.message=Some("Originale registrato; rilettura non riuscita. Rileggi le fonti.".into());},
                Err(e)=>{area.snapshot=None;area.message=Some(format!("{} Rileggi le fonti prima di riprovare.",ui_error(e)));}
            }cx.notify();
        },cx);
    }
    fn save_prosthetics_original(
        &mut self,
        id: String,
        hash: String,
        name: String,
        cx: &mut Context<Self>,
    ) {
        if self.local_host.has_work() {
            return;
        }
        let Some(access) = self.local_host.access() else {
            return;
        };
        let generation = self.local_host.generation;
        self.local_host.references.busy = true;
        let chosen = cx.prompt_for_new_path(&documents::initial_save_directory(), Some(&name));
        cx.spawn(async move |this, cx| {
            let selected = chosen.await;
            let _ = this.update(cx, |this, cx| {
                if this.local_host.generation != generation {
                    return;
                }
                if let Ok(Ok(Some(path))) = selected {
                    this.run_local_host(
                        move || {
                            let bytes = access.read_prosthetics_original(&id, &hash)?;
                            access.admit_archive_file_effect()?;
                            archives::write_new(&path, &bytes)
                                .map_err(|_| RuntimeError::Indeterminate)
                        },
                        |this, result, cx| {
                            this.local_host.references.busy = false;
                            this.local_host.references.message = Some(match result {
                                Ok(()) => "Originale salvato, impronta verificata.".into(),
                                Err(e) => ui_error(e),
                            });
                            cx.notify();
                        },
                        cx,
                    );
                } else {
                    this.local_host.references.busy = false;
                    cx.notify();
                }
            });
        })
        .detach();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prosthetics_mapping_converts_positions_and_keeps_source_metadata() {
        let mut fields = [
            "3",
            "1",
            "2",
            "4",
            "5",
            "6",
            "7",
            "8",
            ";",
            "Ente inventato",
            "2026-11-01",
            "Fonte di prova",
            "",
        ]
        .map(str::to_owned)
        .to_vec();
        let options = prosthetics_options(&fields).unwrap();
        assert_eq!(options["mapping"]["columns"]["codice"], 0);
        assert_eq!(options["mapping"]["columns"]["descrizione"], 1);
        assert_eq!(options["mapping"]["columns"]["codice_sistema"], 2);
        assert_eq!(options["sourceDetails"]["authority"], "Ente inventato");
        fields[1].clear();
        assert!(prosthetics_options(&fields).is_err());
        fields[..8].iter_mut().for_each(String::clear);
        assert!(prosthetics_options(&fields).is_err());
        fields[8] = "|".into();
        assert!(prosthetics_options(&fields).is_err());
        assert_eq!(
            prosthetics_options(&vec![String::new(); 13]).unwrap(),
            json!({})
        );
    }
    #[gpui::test]
    fn aifa_busy_download_keeps_progress_and_cancellation_reachable(cx: &mut gpui::TestAppContext) {
        let host = notes_recovery_tests::Host::new();
        let access = Arc::new(
            host.session
                .authenticate_local_host(
                    "Synthetic scales fixture passphrase",
                    RetirementNotice::new(None),
                )
                .unwrap(),
        );
        let command = Arc::new(access.prepare_aifa_update().unwrap());
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, _| {
            app.session = Some(host.session.clone());
            app.area = Area::Settings;
            app.settings_page = SettingsPage::References;
            app.local_host.authority = Authority::Open(access);
            app.local_host.references.busy = true;
            app.local_host.references.in_flight = Some(command);
        });
        let ids = rendered_command::button_ids(|| {
            cx.update(|window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
            })
        });
        assert!(ids.contains(&"aifa-progress-read".to_owned()));
        assert!(ids.contains(&"aifa-download-cancel".to_owned()));
        view.update(cx, |app, _| {
            app.local_host.references.busy = false;
            app.local_host.references.in_flight = None;
            app.local_host.references.snapshot = None;
        });
        view.update(cx, |app, cx| {
            app.prepare_aifa_acquisition(cx);
            assert!(app.local_host.references.preview.is_none());
            app.local_host.references.snapshot = Some(ReferenceStatus {
                catalog: ReferenceCatalog::Aifa,
                data: json!({"count":0}),
                sources: None,
            });
            app.prepare_aifa_acquisition(cx);
            assert!(app.local_host.references.preview.is_some());
        });
        view.update(cx, |app, cx| {
            app.withdraw_local_host(cx);
            assert!(app.local_host.references.in_flight.is_none());
            assert!(!app.local_host.references.busy);
        });
    }
    #[test]
    fn truncated_aifa_review_reports_total_before_and_after_import() {
        let review = json!({"diagnosticsTruncated":true,"rejectedRecords":201,"duplicateRows":0,"diagnostics":vec![json!({"message":"AIC non valido"});200]});
        for value in [
            json!({"review":review.clone()}),
            json!({"count":1,"review":review}),
        ] {
            assert_eq!(
                diagnostics_warning(&value["review"]).as_deref(),
                Some("Mostrati 200 motivi su 201 totali. L’elenco è incompleto.")
            );
        }
        assert!(diagnostics_warning(&json!({"diagnosticsTruncated":false})).is_none());
    }

    #[gpui::test]
    fn references_render_partial_counts_reasons_and_exemption_fields(
        cx: &mut gpui::TestAppContext,
    ) {
        struct Fixture;
        impl Render for Fixture {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                details(
                    &json!({
                        "count":9,"rejectedRecords":1,"totalRecords":10,
                        "review":{"diagnosticsTruncated":true,"rejectedRecords":201,"diagnostics":vec![json!({"row":2,"message":"AIC non valido"});200]},
                        "diagnostics":[{"row":11,"message":"AIC non valido"}],
                        "sample":[{"code":"SYN","description":"Sintetica","type":"TYPE_A","isPharma":true,"isSpecialist":false,"isNational":null,"startDate":1767225600,"endDate":1798675200}]
                    }),
                    Theme::for_dark(false),
                )
            }
        }
        let (_, cx) = cx.add_window_view(|_, _| Fixture);
        rendered_command::take_text_nodes();
        cx.update(|window, cx| {
            window.refresh();
            window.draw(cx).clear(cx);
        });
        let texts = rendered_command::take_text_nodes()
            .into_iter()
            .map(|(_, node)| node.value().unwrap_or_default().to_owned())
            .collect::<Vec<_>>();
        for expected in [
            "Diagnostiche: Mostrati 200 motivi su 201 totali. L’elenco è incompleto.",
            "Righe scartate: 1",
            "Righe totali: 10",
            "Messaggio: AIC non valido",
            "Codice: SYN",
            "Descrizione: Sintetica",
            "Tipo: TYPE_A",
            "Ambito farmaceutico: Sì",
            "Ambito specialistico: No",
            "Nazionale: Non indicato",
            "Inizio validità dichiarata: 01/01/2026",
            "Fine validità dichiarata: 31/12/2026",
        ] {
            assert!(
                texts.iter().any(|s| s == expected),
                "missing {expected}: {texts:?}"
            );
        }
    }
    #[test]
    fn references_exemption_sample_shows_every_field_and_calendar_dates() {
        let rows = exemption_sample(
            &json!({"type":"TYPE_A","isPharma":true,"isSpecialist":false,"isNational":null,"startDate":1767225600,"endDate":1798675200}),
        );
        assert_eq!(
            rows,
            vec![
                ("Tipo", "TYPE_A".into()),
                ("Ambito farmaceutico", "Sì".into()),
                ("Ambito specialistico", "No".into()),
                ("Nazionale", "Non indicato".into()),
                ("Inizio validità dichiarata", "01/01/2026".into()),
                ("Fine validità dichiarata", "31/12/2026".into())
            ]
        );
        let other = exemption_sample(
            &json!({"type":"TYPE_B","isPharma":false,"isSpecialist":true,"isNational":true}),
        );
        assert_ne!(rows, other);
        assert_eq!(other[3].1, "Sì");
        assert_eq!(other[4].1, "Non indicata");
    }
    #[test]
    fn references_aifa_partial_receipt_cannot_claim_complete() {
        assert!(
            aifa_outcome(&json!({"rejectedRecords":1,"totalRecords":10,"count":9}))
                .contains("parziale")
        );
        assert!(aifa_outcome(&json!({"rejectedRecords":1})).contains("scartate"));
        assert!(!aifa_outcome(&json!({"rejectedRecords":0})).contains("parziale"));
    }
    #[gpui::test]
    fn references_draws_file_review_sources_failures_and_withdraws_on_lock(
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
        for catalog in ReferenceCatalog::ALL {
            view.update(cx,|app,_|{
                app.session=Some(host.session.clone());app.area=Area::Settings;app.settings_page=SettingsPage::References;
                app.local_host.authority=Authority::Open(access.clone());
                let area=&mut app.local_host.references;area.catalog=catalog;
                area.snapshot=Some(ReferenceStatus {catalog,data:json!({"count":0,"state":"absent","revision":0,"enabled":true,"previousAvailable":false}), sources:if catalog==ReferenceCatalog::Prosthetics {Some(Err(RuntimeError::Missing))}else{None}});
            });
            let commands = rendered_command::button_ids(|| {
                cx.update(|window, cx| {
                    window.refresh();
                    window.draw(cx).clear(cx);
                })
            });
            assert!(commands.contains(&"references-read".into()));
            assert_eq!(
                commands.contains(&"references-file".into()),
                catalog != ReferenceCatalog::Who
            );
            assert_eq!(
                commands.contains(&"references-who-download".into()),
                catalog == ReferenceCatalog::Who
            );
            assert!(!commands.iter().any(|s| s.contains("clear")
                || s.contains("rollback")
                || s.contains("seeder")
                || s == "references-confirm"));
            assert_eq!(
                commands.len(),
                commands.iter().collect::<HashSet<_>>().len()
            );
        }
        view.update(cx, |app, _| {
            let area = &mut app.local_host.references;
            area.catalog = ReferenceCatalog::Aifa;
            area.preview = Some(Arc::new(access.prepare_aifa_update().unwrap()));
        });
        let commands = rendered_command::button_ids(|| {
            cx.update(|window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
            })
        });
        assert!(commands.contains(&"references-confirm".into()));
        assert!(commands.contains(&"references-cancel".into()));
        assert!(!commands.contains(&"references-file".into()));
        view.update(cx, |app, cx| {
            app.request_discard(Discard::Lock, cx);
            assert!(app.local_host.references.snapshot.is_none());
            assert!(app.local_host.references.preview.is_none());
        });
    }
    #[gpui::test]
    fn references_no_authority_and_late_results_stay_empty(cx: &mut gpui::TestAppContext) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        view.update(cx, |app, _| {
            app.area = Area::Settings;
            app.settings_page = SettingsPage::References;
        });
        let commands = rendered_command::button_ids(|| {
            cx.update(|window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
            })
        });
        assert!(!commands.iter().any(|id| id.starts_with("references-")));
        view.update(cx, |app, cx| {
            app.run_local_host(
                || {
                    Ok(ReferenceStatus {
                        catalog: ReferenceCatalog::Exemptions,
                        data: json!({"count":1}),
                        sources: None,
                    })
                },
                |this, r, _| this.local_host.references.snapshot = r.ok(),
                cx,
            );
            app.local_host.withdraw(cx);
        });
        cx.run_until_parked();
        view.read_with(cx, |app, _| {
            assert!(app.local_host.references.snapshot.is_none())
        });
    }
}

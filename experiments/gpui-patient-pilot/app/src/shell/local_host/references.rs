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
    pub(super) who_consent: bool,
    fields: [Entity<TextInput>; 3],
}
impl ReferencesArea {
    pub(super) fn new(theme: Theme, cx: &mut Context<ClinicalApp>) -> Self {
        Self {
            catalog: ReferenceCatalog::Aifa,
            snapshot: None,
            preview: None,
            busy: false,
            message: None,
            receipt: None,
            who_consent: false,
            fields: [
                ("aifa-source", "URL fonte"),
                ("aifa-date", "Data di scarico YYYY-MM-DD"),
                ("aifa-version", "Versione dataset"),
            ]
            .map(|(id, label)| cx.new(|cx| TextInput::new(id, label, label, false, theme, cx))),
        }
    }
    pub(super) fn withdraw(&mut self, cx: &mut App) {
        self.snapshot = None;
        self.preview = None;
        self.busy = false;
        self.message = None;
        self.receipt = None;
        self.who_consent = false;
        for field in &self.fields {
            field.update(cx, |input, cx| input.retire(cx));
        }
    }
    pub(super) fn configure(&mut self, theme: Theme, cx: &mut Context<ClinicalApp>) {
        for field in &self.fields {
            field.update(cx, |input, cx| {
                input.configure(theme, self.busy || self.preview.is_some(), cx)
            });
        }
    }
}
fn line(label: &str, value: impl AsRef<str>, theme: Theme) -> Div {
    div().min_w_0().text_color(theme.secondary).child({
        let text = text!(format!("{label}: {}", value.as_ref()));
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
            pane = pane.child(line(label, text, theme));
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
            pane = pane.child(details(&value[key], theme));
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
            for row in rows {
                pane = pane.child(if let Some(s) = row.as_str() {
                    line(label, s, theme)
                } else {
                    details(row, theme)
                });
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
        let metadata = json!({"sourceUrl":area.fields[0].read(cx).value(),"downloadedAt":area.fields[1].read(cx).value(),"version":area.fields[2].read(cx).value()});
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
        let retained = command.clone();
        self.run_local_host(move || {
            let result=access.commit_reference_import(&command)?;
            let status=if matches!(result,ReferenceImportResult::Recorded(_)) {Some(access.read_reference_catalog(catalog))} else {None};
            Ok((result,status))
        },move |this,result,cx| {
            let area=&mut this.local_host.references;area.busy=false;
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
            return pane.child(notice(
                "references-busy",
                "Operazione in corso…",
                theme,
                false,
            ));
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
            pane=pane.child(details(&snapshot.data,theme)).child(text!("La lettura locale non attesta che questa sia l’ultima pubblicazione della fonte. Le ricevute documentano l’import locale, non la validità normativa."));
            if snapshot.data["latestReceipt"].is_null()
                && matches!(
                    area.catalog,
                    ReferenceCatalog::Exemptions | ReferenceCatalog::Prosthetics
                )
            {
                pane=pane.child(text!("Nessuna ricevuta di import disponibile. La provenienza delle voci precedenti non è attestata."));
            }
            if let Some(sources) = &snapshot.sources {
                pane = pane.child(match sources {
                    Ok(v) => details(v, theme),
                    Err(e) => div().child(notice(
                        "references-source-error",
                        format!("Fonti non leggibili: {}", ui_error(*e)),
                        theme,
                        true,
                    )),
                });
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
                        enabled,
                    )
                    .on_click(cx.listener(|this, _, _, cx| {
                        let Some(access) = this.local_host.access() else {
                            return;
                        };
                        match access.prepare_aifa_update() {
                            Ok(p) => this.local_host.references.preview = Some(Arc::new(p)),
                            Err(e) => this.local_host.references.message = Some(ui_error(e)),
                        }
                        cx.notify();
                    })),
                );
                for field in &area.fields {
                    pane = pane.child(field.clone());
                }
                pane = pane.child(text!(
                    "Lo svuotamento del catalogo non è disponibile da questa pagina."
                ));
            }
            ReferenceCatalog::Exemptions => {
                pane=pane.child(text!("File UTF-8 con separatore |, massimo 2 MiB e 20.000 righe. Colonne: CD_ESENZIONE, DS_ESENZIONE, CD_TIPO_ESENZIONE, DT_INIZIO_VALIDITA, DT_FINE_VALIDITA, FL_AMBITO_FARMACEUTICO, FL_AMBITO_SPECIALISTICO, FL_NAZIONALE. Anteprima e conferma obbligatorie."));
            }
            ReferenceCatalog::Prosthetics => {
                pane=pane.child(text!("CSV UTF-8, virgola o punto e virgola, massimo 2 MiB e 20.000 righe. Colonne: codice_sistema,codice,descrizione,versione,fonte,ambito,data_inizio,data_fine. Una codifica, versione, fonte e ambito per file. Errori e duplicati bloccano l’import. I codici assenti restano. Originali in chiaro: allega solo documenti di repertorio privi di dati dei pazienti. Mappatura colonne e allegati agli originali non ancora gestibili qui."));
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

#[cfg(test)]
mod tests {
    use super::*;
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

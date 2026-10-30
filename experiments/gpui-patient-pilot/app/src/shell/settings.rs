use super::*;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) enum SettingsPage {
    #[default]
    Overview,
    Profile,
    Appearance,
    Models,
    Ambulatories,
    AiPreferences,
}

impl SettingsPage {
    fn index(self) -> usize {
        match self {
            Self::Overview => 0,
            Self::Profile => 1,
            Self::Appearance => 2,
            Self::Models => 3,
            Self::Ambulatories => 4,
            Self::AiPreferences => 5,
        }
    }
}

impl ClinicalApp {
    pub(super) fn select_settings_page(
        &mut self,
        page: SettingsPage,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.ambulatory_management.is_saving() || self.ai_preferences_blocks_navigation(cx) {
            return;
        }
        let previous = self.settings_page;
        self.settings_page = page;
        self.area_scroll.set_offset(gpui::point(px(0.), px(0.)));
        if page == SettingsPage::Profile {
            self.ensure_account_profile_loaded(cx);
        }
        if page == SettingsPage::Models {
            self.load_ai_status(cx);
        }
        if page == SettingsPage::AiPreferences {
            self.load_ai_preferences(cx);
        }
        if page == SettingsPage::Ambulatories {
            self.load_ambulatories(cx);
            self.load_ambulatory_command_recovery(cx);
        }
        let target = if page == SettingsPage::Overview {
            &self.settings_targets[previous.index()]
        } else {
            &self.settings_targets[0]
        };
        window.focus(&target.focus, cx);
        cx.notify();
    }

    pub(super) fn settings_view(&self, layout: Layout, cx: &Context<Self>) -> Div {
        match self.settings_page {
            SettingsPage::Ambulatories => return self.ambulatory_management_view(cx),
            SettingsPage::AiPreferences => return self.ai_preferences_view(cx),
            _ => {}
        }
        let theme = self.theme;
        let mut view = div()
            .reading_surface(theme)
            .w_full()
            .min_w_0()
            .max_w(px(760.))
            .flex()
            .flex_col()
            .gap(px(28.));
        if self.settings_page != SettingsPage::Overview {
            view = view.child(
                self.settings_targets[0]
                    .attach(button(
                        "clinical-workspace-settings-back",
                        "Torna alle impostazioni",
                        theme,
                        false,
                        true,
                    ))
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.select_settings_page(SettingsPage::Overview, window, cx)
                    })),
            );
        }
        match self.settings_page {
            SettingsPage::Profile => view.child(self.account_profile_view(cx)),
            SettingsPage::Appearance => view.child(heading("clinical-workspace-settings-heading", "Aspetto", theme))
            .child(div().flex().flex_col().gap(px(12.))
                .child(section("clinical-workspace-appearance-heading", "ASPETTO", theme))
                .child(self.appearance((layout.width-if layout.compact {0.} else {layout.navigation}-if layout.magnified {0.} else {16.}-2.*layout.margin).min(760.),false,cx)))
            .child(div().flex().flex_col().gap(px(12.))
                .child(section("clinical-workspace-text-scale-heading", "DIMENSIONE DEL TESTO", theme))
                .child(div().text_color(theme.secondary).child(text!("La pagina passa a una sola colonna quando serve più spazio per leggere.")))
                .child(div().flex().flex_wrap().gap(px(8.))
                    .children([(1., "100%"), (1.25, "125%"), (1.5, "150%"), (2., "200%"), (3., "300%"), (4., "400%")].into_iter().map(|(scale, label)| {
                        button(format!("clinical-workspace-text-scale-{}", (scale * 100.) as u32), label, theme, false, true)
                            .aria_selected(self.text_scale == scale).when(self.text_scale == scale, |el| el.bg(theme.selected).border_color(theme.fresh))
                            .on_click(cx.listener(move |this, _, _, cx| this.change_local_preference(PreferenceChange::TextScale(scale), cx)))
                    }))))
            .child(button("clinical-workspace-increased-contrast", if self.increased_contrast { "Contrasto dei filetti: aumentato" } else { "Aumenta il contrasto dei filetti" }, theme, false, true)
                .on_click(cx.listener(|this, _, _, cx| this.change_local_preference(PreferenceChange::Contrast(!this.increased_contrast), cx))))
            .child(self.local_preferences_status(cx))
            .child(div().border_t_1().border_color(theme.rule).pt(px(24.)).flex().flex_col().gap(px(12.))
                .child(section("clinical-workspace-privacy-heading", "Privacy", theme))
                .child(div().text_color(theme.secondary).child(text!("Copre questa finestra e conserva la bozza. L’accesso resta aperto finché non scegli Blocca. Puoi oscurare e mostrare i contenuti anche con Ctrl/Cmd + Maiusc + P.")))
                .child(button("clinical-workspace-privacy-cover", "Oscura contenuti", theme, false, true)
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.change_local_preference(PreferenceChange::Privacy(true), cx);
                        window.focus(&this.focus, cx);
                    }))))
,
            SettingsPage::Models => view
                .child(heading("clinical-workspace-settings-heading", "Modelli", theme))
                .child(self.ai_status_view(cx))
                .child(notice("clinical-workspace-models-native-limits", "Installazione dei modelli, profilo hardware e interruttori delle funzioni non ancora disponibili in questa app.", theme, false)),
            SettingsPage::Overview => {
                let origin = self.session.as_ref().map(|session| session.base_url().to_owned()).unwrap_or_default();
                view.child(heading("clinical-workspace-settings-heading", "Impostazioni", theme))
                    .child(section("clinical-workspace-settings-postazione", "Postazione", theme))
                    .children([
                        (SettingsPage::Profile, "Profilo", "Nome medico e ambulatorio"),
                        (SettingsPage::Appearance, "Aspetto", "Tema, dimensione del testo e privacy"),
                        (SettingsPage::Ambulatories, "Ambulatori", "Sedi e contesti clinici"),
                    ].into_iter().map(|(page, label, description)| self.settings_item(page, label, description, cx)))
                    .child(section("clinical-workspace-settings-intelligenza", "Intelligenza", theme))
                    .children([
                        (SettingsPage::Models, "Modelli", "Stato della configurazione sull’host"),
                        (SettingsPage::AiPreferences, "Funzioni AI", "Preferenze e scelta del modello per funzione"),
                    ].into_iter().map(|(page, label, description)| self.settings_item(page, label, description, cx)))
                    .child(section("clinical-workspace-connection-heading", "Archivio collegato", theme))
                    .child(text!(origin))
                    .child(button("clinical-workspace-lock", "Blocca e nascondi i dati", theme, false, true)
                        .on_click(cx.listener(|this, _, _, cx| this.request_discard(Discard::Lock, cx))))
                    .child(notice("clinical-workspace-settings-native-limits", "Cambio PIN e dispositivi, account ChatGPT, Fabric, governance, repertori amministrativi e diagnostica non ancora disponibili in questa app.", theme, false))
            }
            SettingsPage::Ambulatories | SettingsPage::AiPreferences => unreachable!(),
        }
    }

    fn settings_item(
        &self,
        page: SettingsPage,
        label: &'static str,
        description: &'static str,
        cx: &Context<Self>,
    ) -> Div {
        let theme = self.theme;
        div()
            .min_w_0()
            .border_b_1()
            .border_color(theme.rule)
            .pb(px(16.))
            .flex()
            .flex_col()
            .gap(px(4.))
            .child(
                self.settings_targets[page.index()]
                    .attach(button(
                        format!("clinical-workspace-settings-page-{}", page.index()),
                        label,
                        theme,
                        false,
                        true,
                    ))
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.select_settings_page(page, window, cx)
                    })),
            )
            .child(div().text_color(theme.secondary).child(text!(description)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[gpui::test]
    fn settings_pages_preserve_profile_draft_and_return_to_the_opening_control(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) =
            cx.add_window_view(|window, cx| ClinicalApp::new(String::new(), window, cx));
        cx.update(|window, cx| {
            view.update(cx, |app, cx| {
                app.area = Area::Settings;
                let editor = app.account_profile.synthetic_draft(cx);
                for page in [
                    SettingsPage::Profile,
                    SettingsPage::Appearance,
                    SettingsPage::Models,
                ] {
                    app.select_settings_page(page, window, cx);
                    assert_eq!(app.settings_page, page);
                    assert!(app.settings_targets[0].focus.is_focused(window));
                    app.select_settings_page(SettingsPage::Overview, window, cx);
                    assert!(app.settings_targets[page.index()].focus.is_focused(window));
                    assert_eq!(editor.read(cx).value(), "Bozza account sintetica");
                }
                app.disconnect(cx);
                assert_eq!(app.settings_page, SettingsPage::Overview);
                assert!(editor.read(cx).value().is_empty());
            })
        });
    }
}

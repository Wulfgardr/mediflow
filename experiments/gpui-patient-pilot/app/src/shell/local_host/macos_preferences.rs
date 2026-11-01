use super::*;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(in crate::shell) struct SystemAccessibility {
    pub text_scale: f32,
    pub contrast: bool,
    #[cfg(target_os = "macos")]
    pub reduce_motion: bool,
    #[cfg(target_os = "macos")]
    pub reduce_transparency: bool,
}
#[cfg(any(not(test), target_os = "macos"))]
pub(in crate::shell) fn read_system_accessibility() -> Option<SystemAccessibility> {
    #[cfg(target_os = "macos")]
    {
        unsafe extern "C" {
            fn mf_preferred_text_scale() -> f64;
            fn mf_accessibility_preferences() -> u32;
        }
        let scale = unsafe { mf_preferred_text_scale() };
        let flags = unsafe { mf_accessibility_preferences() };
        Some(SystemAccessibility {
            text_scale: if scale.is_finite() {
                (scale as f32).clamp(1., 4.)
            } else {
                1.
            },
            contrast: flags & 1 != 0,
            reduce_motion: flags & 2 != 0,
            reduce_transparency: flags & 4 != 0,
        })
    }
    #[cfg(not(target_os = "macos"))]
    None
}
pub(in crate::shell) fn effective_preferences(
    scale: f32,
    contrast: bool,
    system: Option<SystemAccessibility>,
) -> (f32, bool) {
    system
        .map(|s| (scale.max(s.text_scale), contrast || s.contrast))
        .unwrap_or((scale, contrast))
}
impl ClinicalApp {
    pub(in crate::shell) fn system_accessibility_view(&self, cx: &Context<Self>) -> Div {
        let pane = div().min_w_0().flex().flex_col().gap(px(8.));
        #[cfg(target_os = "macos")]
        let mut pane = pane;
        #[cfg(target_os = "macos")]
        {
            pane = pane.child(section(
                "macos-accessibility-title",
                "Preferenze di macOS",
                self.theme,
            ));
            if let Some(system) = read_system_accessibility() {
                pane = pane
                    .child(governance::fact(
                        "Dimensione testo di sistema",
                        format!("{:.0}%", system.text_scale * 100.),
                        self.theme,
                    ))
                    .child(governance::fact(
                        "Contrasto di sistema",
                        if system.contrast {
                            "Aumentato"
                        } else {
                            "Standard"
                        },
                        self.theme,
                    ))
                    .child(governance::fact(
                        "Riduzione movimento",
                        if system.reduce_motion {
                            "Attiva"
                        } else {
                            "Non richiesta"
                        },
                        self.theme,
                    ))
                    .child(governance::fact(
                        "Riduzione trasparenza",
                        if system.reduce_transparency {
                            "Attiva"
                        } else {
                            "Non richiesta"
                        },
                        self.theme,
                    ));
            }
            pane=pane.child(text!("La dimensione del testo e il contrasto rispettano almeno la preferenza di macOS. Le pagine usano superfici opache e non hanno animazioni di transizione. Dopo una modifica nelle impostazioni di sistema, rileggi le preferenze."))
                .child(div().flex().flex_wrap().gap(px(8.))
                    .child(button("macos-accessibility-refresh","Rileggi preferenze macOS",self.theme,false,true).on_click(cx.listener(|_,_,_,cx|cx.notify())))
                    .child(button("macos-accessibility-open","Apri Accessibilità di macOS",self.theme,false,true).on_click(cx.listener(|_,_,_,cx|cx.open_url("x-apple.systempreferences:com.apple.preference.universalaccess")))));
        }
        #[cfg(not(target_os = "macos"))]
        let _ = cx;
        pane
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn system_minimum_does_not_reduce_manual_text_or_contrast() {
        let system = SystemAccessibility {
            text_scale: 1.4,
            contrast: true,
            #[cfg(target_os = "macos")]
            reduce_motion: true,
            #[cfg(target_os = "macos")]
            reduce_transparency: true,
        };
        assert_eq!(effective_preferences(1., false, Some(system)), (1.4, true));
        assert_eq!(effective_preferences(2., true, Some(system)), (2., true));
        assert_eq!(effective_preferences(1.5, false, None), (1.5, false));
    }
}

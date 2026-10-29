use crate::theme::{Theme, TypeRole};
use gpui::{
    App, AvailableSpace, Bounds, Element, ElementId, GlobalElementId, InspectorElementId,
    IntoElement, LayoutId, Pixels, ShapedLine, SharedString, Size, Style, TextAlign, TextStyle,
    Window, WindowTextSystem, px,
};
use hyphenation::{Hyphenator, Load};
use std::{cell::RefCell, rc::Rc};

pub fn title(text: impl Into<SharedString>, theme: Theme) -> Title {
    Title {
        text: text.into(),
        theme,
    }
}

pub struct Title {
    text: SharedString,
    theme: Theme,
}

#[derive(Default)]
pub struct TitleLayout {
    lines: Vec<ShapedLine>,
    line_height: Pixels,
    size: Size<Pixels>,
}

fn layout_title(
    text: &str,
    style: &TextStyle,
    preferred: f32,
    theme: Theme,
    width: f32,
    system: &WindowTextSystem,
) -> TitleLayout {
    let shape = |text: &str, size: f32| {
        system.shape_line(
            text.to_owned().into(),
            px(size),
            &[style.to_run(text.len())],
            None,
        )
    };
    let minimum = theme.body().min(preferred);
    let mut sizes = vec![preferred];
    sizes.extend(
        [
            TypeRole::Person { compact: false },
            TypeRole::PageTitle,
            TypeRole::PersonPreview,
            TypeRole::Brand,
            TypeRole::Prose,
            TypeRole::Threshold,
            TypeRole::Body,
        ]
        .map(|role| theme.role(role).size),
    );
    sizes.push(minimum);
    sizes.retain(|s| *s <= preferred && *s >= minimum);
    sizes.sort_by(|a, b| b.total_cmp(a));
    sizes.dedup();
    let size = sizes
        .into_iter()
        .find(|size| {
            text.split_whitespace()
                .all(|word| f32::from(shape(word, *size).width()) <= width)
        })
        .unwrap_or(minimum);
    let mut rows = Vec::new();
    let mut row = String::new();
    for word in text.split_whitespace() {
        let candidate = if row.is_empty() {
            word.to_owned()
        } else {
            format!("{row} {word}")
        };
        if !row.is_empty() && f32::from(shape(&candidate, size).width()) > width {
            rows.push(shape(&row, size));
            row.clear();
        }
        if !row.is_empty() {
            row.push(' ');
        }
        let mut remaining = word;
        if f32::from(shape(remaining, size).width()) > width {
            if let Some((index, apostrophe)) = remaining
                .char_indices()
                .find(|(_, c)| matches!(c, '\'' | '’'))
            {
                let end = index + apostrophe.len_utf8();
                let prefix = &remaining[..end];
                if f32::from(shape(prefix, size).width()) <= width {
                    rows.push(shape(prefix, size));
                    remaining = &remaining[end..];
                }
            }
            while f32::from(shape(remaining, size).width()) > width {
                let Some(index) = italian()
                    .hyphenate(remaining)
                    .breaks
                    .into_iter()
                    .rev()
                    .find(|index| {
                        f32::from(shape(&format!("{}-", &remaining[..*index]), size).width())
                            <= width
                    })
                else {
                    break;
                };
                rows.push(shape(&format!("{}-", &remaining[..index]), size));
                remaining = &remaining[index..];
            }
        }
        row.push_str(remaining);
    }
    if !row.is_empty() {
        rows.push(shape(&row, size));
    }
    let line_height = px(size * 1.2);
    let measured = Size {
        width: rows
            .iter()
            .map(ShapedLine::width)
            .fold(px(0.), Pixels::max)
            .ceil(),
        height: line_height * rows.len(),
    };
    TitleLayout {
        lines: rows,
        line_height,
        size: measured,
    }
}

fn italian() -> &'static hyphenation::Standard {
    static ITALIAN: std::sync::OnceLock<hyphenation::Standard> = std::sync::OnceLock::new();
    ITALIAN.get_or_init(|| {
        hyphenation::Standard::from_reader(
            hyphenation::Language::Italian,
            &mut &include_bytes!("../assets/hyphenation/it.standard.bincode")[..],
        )
        .expect("bundled Italian hyphenation dictionary")
    })
}

impl IntoElement for Title {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}

impl Element for Title {
    type RequestLayoutState = Rc<RefCell<TitleLayout>>;
    type PrepaintState = ();
    fn id(&self) -> Option<ElementId> {
        None
    }
    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }
    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        _: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let state = Rc::new(RefCell::new(TitleLayout::default()));
        let result = state.clone();
        let text = self.text.clone();
        let theme = self.theme;
        let style = window.text_style();
        let preferred = f32::from(style.font_size.to_pixels(window.rem_size()));
        let id =
            window.request_measured_layout(Style::default(), move |known, available, window, _| {
                let width = known
                    .width
                    .or(match available.width {
                        AvailableSpace::Definite(width) => Some(width),
                        _ => None,
                    })
                    .map(f32::from)
                    .unwrap_or(f32::MAX);
                let layout =
                    layout_title(&text, &style, preferred, theme, width, window.text_system());
                let size = layout.size;
                *result.borrow_mut() = layout;
                size
            });
        (id, state)
    }
    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        _: &mut Window,
        _: &mut App,
    ) {
    }
    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        layout: &mut Self::RequestLayoutState,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        let layout = layout.borrow();
        let mut origin = bounds.origin;
        for line in &layout.lines {
            line.paint(
                origin,
                layout.line_height,
                TextAlign::Left,
                Some(bounds.size.width),
                window,
                cx,
            )
            .expect("title painting");
            origin.y += layout.line_height;
        }
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use crate::theme::{TypeRole, TypeStyle};
    use gpui::{Context, Render, TestAppContext, div, prelude::*, size};

    struct Fixture {
        theme: Theme,
        label: &'static str,
        role: TypeRole,
    }
    impl Render for Fixture {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div().size_full().p(px(20.)).child(
                crate::components::heading("title-under-test", self.label, self.theme)
                    .debug_selector(|| "title-under-test".into())
                    .type_role(self.theme, self.role),
            )
        }
    }

    #[gpui::test]
    fn hcg4_titles_fit_whole_words(cx: &mut TestAppContext) {
        let mut native = TestAppContext::build_with_text_system(
            cx.dispatcher.clone(),
            None,
            std::sync::Arc::new(gpui_apple::AppleTextSystem::new()),
        );
        let cx = &mut native;
        cx.update(|cx| {
            cx.text_system()
                .add_fonts(vec![std::borrow::Cow::Borrowed(include_bytes!(
                    "../../../../app/fonts/Newsreader-Native-Regular.ttf"
                ))])
                .unwrap()
        });
        let (view, cx) = cx.add_window_view(|_, _| Fixture {
            theme: Theme::for_dark(false),
            label: "",
            role: TypeRole::PageTitle,
        });
        let labels = [
            ("Collega questo dispositivo", TypeRole::PageTitle),
            ("Accedi al tuo archivio", TypeRole::PageTitle),
            (
                "Registrare le note nella scheda di Moretti Elena?",
                TypeRole::Threshold,
            ),
            ("Pazienti", TypeRole::PageTitle),
            ("Scheda", TypeRole::PageTitle),
            ("Impostazioni", TypeRole::PageTitle),
            ("Preferenze funzioni AI", TypeRole::PageTitle),
            ("La scheda non è disponibile", TypeRole::PageTitle),
            ("Seleziona una scheda di prova", TypeRole::PageTitle),
            ("Modifica anagrafica", TypeRole::PageTitle),
            ("Elettroencefalografico", TypeRole::PageTitle),
            (
                "Creare la scheda nell’ambulatorio selezionato?",
                TypeRole::Threshold,
            ),
            (
                "Della Valle Scarpetta Maria Antonietta",
                TypeRole::Person { compact: false },
            ),
            (
                "Creare la scheda di Della Valle Scarpetta Maria Antonietta nell'ambulatorio selezionato?",
                TypeRole::Threshold,
            ),
            (
                "Ripetere l’invio della stessa valutazione per Moretti Elena?",
                TypeRole::Threshold,
            ),
        ];
        for dark in [false, true] {
            for width in [390., 420., 800.] {
                for scale in [4., 2., 1.] {
                    for (label, role) in labels {
                        let theme = Theme::for_dark(dark).sized(scale, false);
                        view.update(cx, |view, cx| {
                            view.theme = theme;
                            view.label = label;
                            view.role = role;
                            cx.notify();
                        });
                        cx.simulate_resize(size(px(width), px(2400.)));
                        cx.update(|window, cx| {
                            window.refresh();
                            window.draw(cx).clear(cx);
                        });
                        let bounds = cx.debug_bounds("title-under-test").unwrap();
                        assert!(
                            bounds.left() >= px(20.) && bounds.right() <= px(width - 19.),
                            "heading outside viewport: {label} {width} {scale}"
                        );
                        cx.update(|window, _| {
                            let typography = theme.role(role);
                            let style = TextStyle {
                                font_family: typography.family.into(),
                                font_weight: typography.weight,
                                ..Default::default()
                            };
                            let layout = layout_title(
                                label,
                                &style,
                                typography.size,
                                theme,
                                width - 40.,
                                window.text_system(),
                            );
                            let visible = layout
                                .lines
                                .iter()
                                .map(|line| line.text.as_ref())
                                .collect::<Vec<_>>()
                                .join("\n");
                            if !label.contains("ambulatorio") && label != "Elettroencefalografico" {
                                assert_eq!(
                                    visible.split_whitespace().collect::<Vec<_>>(),
                                    label.split_whitespace().collect::<Vec<_>>(),
                                    "fitting words must remain whole: {visible}"
                                );
                            }
                            if visible.contains("-\n")
                                || visible.contains("'\n")
                                || visible.contains("’\n")
                            {
                                assert_eq!(
                                    layout.line_height,
                                    px(theme.body() * 1.2),
                                    "exhaust the typography scale before breaking a word"
                                );
                            }
                            if width == 390. && scale == 4. {
                                if label.contains("nell'ambulatorio") {
                                    assert!(
                                        visible.contains("nell'\nambulatorio"),
                                        "elision precedes hyphenation: {visible}"
                                    );
                                }
                                if label == "Elettroencefalografico" {
                                    assert!(
                                        visible.contains("-\n"),
                                        "visible Italian hyphen: {visible}"
                                    );
                                }
                            }
                            let actual = layout
                                .lines
                                .iter()
                                .map(|line| line.text.as_ref())
                                .collect::<Vec<_>>()
                                .join("\n")
                                .replace("-\n", "")
                                .replace("'\n", "'")
                                .replace("’\n", "’")
                                .replace("\n", " ");
                            assert_eq!(actual, label, "no word may be split or lost");
                            assert!(
                                layout.size.width <= px(width - 40.),
                                "glyph overflow: {label}, {width}, {scale}, {dark}, {:?}",
                                layout.size
                            );
                            assert!(
                                layout.line_height >= px(theme.body().min(typography.size) * 1.2)
                            );
                            assert!(layout.line_height <= px(typography.size * 1.2));
                            assert!(
                                (bounds.size.height - layout.size.height).abs() <= px(1.),
                                "renderer must use measured title layout: {label}"
                            );
                        });
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod accessibility_tests {
    use super::*;
    #[test]
    fn title_accessibility_keeps_the_original_phrase_without_layout_hyphens() {
        let phrase = "Creare la scheda di Della Valle Scarpetta Maria Antonietta nell'ambulatorio selezionato?";
        let heading = crate::components::confirmation_heading(
            phrase.into(),
            Theme::for_dark(false).sized(4., false),
        );
        let mut node = gpui::accesskit::Node::new(gpui::Role::Heading);
        heading.write_a11y_info(&mut node);
        assert_eq!(node.label(), Some(phrase));
        assert_eq!(italian().language(), hyphenation::Language::Italian);
    }
}

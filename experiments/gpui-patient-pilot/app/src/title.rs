use crate::theme::{Theme, TypeRole};
use gpui::{
    App, AvailableSpace, Bounds, Element, ElementId, GlobalElementId, InspectorElementId,
    IntoElement, LayoutId, Pixels, ShapedLine, SharedString, Size, Style, TextStyle, Window,
    WindowTextSystem, px,
};
use hyphenation::{Hyphenator, Load};
use std::hash::{Hash, Hasher};
use std::ops::Range;
use std::{cell::RefCell, rc::Rc};
use unicode_segmentation::UnicodeSegmentation;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SegmentRole {
    ItalianProse,
    Name,
    Code,
}

#[derive(Clone)]
pub struct TitleText {
    text: SharedString,
    segments: Vec<(Range<usize>, SegmentRole)>,
}
impl TitleText {
    pub fn name(text: impl Into<SharedString>) -> Self {
        Self::new(text.into(), SegmentRole::Name)
    }
    pub fn code(text: impl Into<SharedString>) -> Self {
        Self::new(text.into(), SegmentRole::Code)
    }
    fn new(text: SharedString, role: SegmentRole) -> Self {
        let end = text.len();
        Self {
            text,
            segments: vec![(0..end, role)],
        }
    }
    pub fn append(self, role: SegmentRole, text: impl Into<SharedString>) -> Self {
        let text = text.into();
        let start = self.text.len();
        let end = start + text.len();
        let mut segments = self.segments;
        segments.push((start..end, role));
        Self {
            text: format!("{}{text}", self.text).into(),
            segments,
        }
    }
    pub fn patient_question(
        prefix: impl Into<SharedString>,
        name: impl Into<SharedString>,
        suffix: &str,
    ) -> Self {
        Self::from(prefix.into())
            .append(SegmentRole::Name, name)
            .append(SegmentRole::ItalianProse, suffix.to_owned())
    }
    pub fn text(&self) -> &str {
        &self.text
    }
    fn tokens(&self) -> Vec<(&str, SegmentRole)> {
        let mut offset = 0;
        self.text
            .split_whitespace()
            .map(|word| {
                let start = offset + self.text[offset..].find(word).expect("title token");
                offset = start + word.len();
                let role = self
                    .segments
                    .iter()
                    .find(|(range, role)| {
                        *role != SegmentRole::ItalianProse
                            && range.start < offset
                            && range.end > start
                    })
                    .map_or(SegmentRole::ItalianProse, |(_, role)| *role);
                (word, role)
            })
            .collect()
    }
}
impl From<SharedString> for TitleText {
    fn from(text: SharedString) -> Self {
        Self::new(text, SegmentRole::ItalianProse)
    }
}
impl From<String> for TitleText {
    fn from(text: String) -> Self {
        SharedString::from(text).into()
    }
}
impl From<&str> for TitleText {
    fn from(text: &str) -> Self {
        SharedString::from(text.to_owned()).into()
    }
}

#[track_caller]
pub fn title(text: impl Into<TitleText>, theme: Theme) -> Title {
    let text = text.into();
    let location = std::panic::Location::caller();
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    (location.file(), location.line(), location.column()).hash(&mut hash);
    let id = ElementId::Integer(hash.finish());
    Title { text, theme, id }
}
pub struct Title {
    text: TitleText,
    theme: Theme,
    id: ElementId,
}

fn italian_prose(word: &str, role: SegmentRole) -> bool {
    if role != SegmentRole::ItalianProse
        || word.chars().any(|c| c.is_numeric())
        || !word.chars().any(char::is_lowercase)
    {
        return false;
    }
    let lower = word
        .trim_matches(|c: char| !c.is_alphabetic())
        .to_lowercase();
    let base = if let Some((prefix, base)) = lower.rsplit_once(['\'', '’']) {
        if !italian_elision(prefix) {
            return false;
        }
        base
    } else {
        &lower
    };
    const WORDS: &[&str] = &[
        "accesso",
        "accedi",
        "acqua",
        "agenda",
        "aiuola",
        "altre",
        "ambulatori",
        "ambulatorio",
        "anagrafica",
        "archivio",
        "collega",
        "conferma",
        "consenti",
        "contenuti",
        "controlli",
        "creare",
        "dati",
        "diagnostica",
        "disponibile",
        "dispositivo",
        "documenti",
        "documento",
        "elettroencefalografico",
        "elettroencefalogramma",
        "farmacia",
        "figlio",
        "funzioni",
        "gatto",
        "impostazioni",
        "lasciare",
        "magnesio",
        "modifica",
        "nascosti",
        "note",
        "nuova",
        "nuovo",
        "occhiali",
        "oscurati",
        "parametri",
        "pazienti",
        "poesia",
        "preferenze",
        "preghiera",
        "prima",
        "prova",
        "questo",
        "registrare",
        "repertori",
        "ripetere",
        "riunione",
        "scale",
        "scheda",
        "seleziona",
        "selezionato",
        "sillabazione",
        "sogno",
        "stessa",
        "terapia",
        "terapie",
        "valutazione",
    ];
    WORDS.contains(&base)
}
fn italian_elision(prefix: &str) -> bool {
    [
        "l", "nell", "dell", "all", "dall", "sull", "un", "quest", "quell", "sant", "senz",
    ]
    .contains(&prefix)
}
fn elision_end(word: &str) -> Option<usize> {
    let (index, mark) = word.char_indices().find(|(_, c)| matches!(c, '\'' | '’'))?;
    let prefix = word[..index].to_lowercase();
    (prefix.chars().count() > 1 && italian_elision(&prefix)).then_some(index + mark.len_utf8())
}

#[derive(Default)]
pub struct TitleLayout {
    lines: Vec<ShapedLine>,
    line_height: Pixels,
    size: Size<Pixels>,
}

fn layout_title(
    text: &TitleText,
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
            text.tokens()
                .into_iter()
                .all(|(word, _)| f32::from(shape(word, *size).width()) <= width)
        })
        .unwrap_or(minimum);
    let mut rows = Vec::new();
    let mut row = String::new();
    for (word, role) in text.tokens() {
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
            let syllabic = italian_prose(word, role);
            let breaks = if syllabic {
                italian().hyphenate(word).breaks
            } else {
                Vec::new()
            };
            if let Some(end) = syllabic.then(|| elision_end(remaining)).flatten()
                && f32::from(shape(&remaining[..end], size).width()) <= width
            {
                rows.push(shape(&remaining[..end], size));
                remaining = &remaining[end..];
            }
            while f32::from(shape(remaining, size).width()) > width {
                let consumed = word.len() - remaining.len();
                let syllable = breaks
                    .iter()
                    .copied()
                    .rev()
                    .filter(|index| *index > consumed)
                    .map(|index| index - consumed)
                    .find(|index| {
                        f32::from(shape(&format!("{}-", &remaining[..*index]), size).width())
                            <= width
                    });
                let index = syllable.unwrap_or_else(|| {
                    remaining
                        .grapheme_indices(true)
                        .map(|(start, g)| start + g.len())
                        .take_while(|end| {
                            f32::from(shape(&remaining[..*end], size).width()) <= width
                        })
                        .last()
                        .unwrap_or_else(|| {
                            remaining
                                .graphemes(true)
                                .next()
                                .expect("nonempty title remainder")
                                .len()
                        })
                });
                let fragment = if syllable.is_some() {
                    format!("{}-", &remaining[..index])
                } else {
                    remaining[..index].to_owned()
                };
                rows.push(shape(&fragment, size));
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
        Some(self.id.clone())
    }
    fn a11y_role(&self) -> Option<gpui::Role> {
        Some(gpui::Role::Label)
    }
    fn write_a11y_info(&self, node: &mut gpui::accesskit::Node) {
        node.set_value(self.text.text().to_owned());
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
        id: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        layout: &mut Self::RequestLayoutState,
        _: &mut Window,
        _: &mut App,
    ) {
        #[cfg(test)]
        {
            let mut node =
                gpui::accesskit::Node::new(self.a11y_role().expect("accessible title role"));
            self.write_a11y_info(&mut node);
            let layout = layout.borrow();
            CAPTURED.with(|nodes| {
                nodes.borrow_mut().push((
                    id.expect("accessible title ID").clone(),
                    node,
                    bounds,
                    layout.size.width,
                ))
            });
        }
        #[cfg(not(test))]
        let _ = (id, bounds, layout);
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
                window.text_style().text_align,
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
                                &TitleText::from(label),
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
    struct ProtectedFixture {
        text: TitleText,
        theme: Theme,
        role: TypeRole,
        padding: f32,
    }
    impl Render for ProtectedFixture {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div().size_full().p(px(self.padding)).child(
                div()
                    .debug_selector(|| "protected-title".into())
                    .min_w_0()
                    .max_w_full()
                    .type_role(self.theme, self.role)
                    .child(title(self.text.clone(), self.theme)),
            )
        }
    }
    #[gpui::test]
    fn hcg4_review_semantic_matrix(cx: &mut TestAppContext) {
        let mut native = TestAppContext::build_with_text_system(
            cx.dispatcher.clone(),
            None,
            std::sync::Arc::new(gpui_apple::AppleTextSystem::new()),
        );
        native.update(|cx| {
            cx.text_system()
                .add_fonts(vec![std::borrow::Cow::Borrowed(include_bytes!(
                    "../../../../app/fonts/Newsreader-Native-Regular.ttf"
                ))])
                .unwrap()
        });
        let (view, cx) = native.add_window_view(|_, _| ProtectedFixture {
            text: "".into(),
            theme: Theme::for_dark(false),
            role: TypeRole::PageTitle,
            padding: 20.,
        });
        let cases = [
            (
                TitleText::name("Александровская"),
                TypeRole::Person { compact: false },
            ),
            (TitleText::name("Schwarzenegger"), TypeRole::PersonPreview),
            (
                TitleText::name("O'Shaughnessy"),
                TypeRole::Person { compact: true },
            ),
            (TitleText::name("Worcestershire"), TypeRole::PersonPreview),
            (TitleText::name("Schwarzenegger Elena"), TypeRole::Strong),
            (TitleText::name("D'Agostinantonio"), TypeRole::PersonPreview),
            (
                TitleText::name("Elettroencefalografico"),
                TypeRole::PersonPreview,
            ),
            (TitleText::code("RSSMRA80A01H501U"), TypeRole::PageTitle),
            (
                TitleText::from("Codice fiscale ").append(SegmentRole::Code, "RSSMRA80A01H501U"),
                TypeRole::PageTitle,
            ),
            (
                TitleText::from("Diagnosi ").append(SegmentRole::Code, "S52.521A"),
                TypeRole::PageTitle,
            ),
            (TitleText::code("9B71.0"), TypeRole::Threshold),
            (TitleText::from("RSSMRA80A01H501U"), TypeRole::Threshold),
            (
                TitleText::from("ELETTROENCEFALOGRAFICO"),
                TypeRole::Threshold,
            ),
            (TitleText::from("Worcestershire"), TypeRole::PageTitle),
            (
                TitleText::name(
                    "A\u{301}A\u{301}A\u{301}A\u{301}A\u{301}A\u{301}A\u{301}A\u{301}A\u{301}A\u{301}A\u{301}A\u{301}",
                ),
                TypeRole::PersonPreview,
            ),
            (TitleText::name("👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦"), TypeRole::PersonPreview),
            (
                TitleText::patient_question(
                    "Creare la scheda di ",
                    "O'Shaughnessy Worcestershire",
                    " nell'ambulatorio selezionato?",
                ),
                TypeRole::Threshold,
            ),
        ];
        for dark in [false, true] {
            for width in [304., 390., 420., 800.] {
                for scale in [1., 2., 4.] {
                    for (text, role) in &cases {
                        let theme = Theme::for_dark(dark).sized(scale, false);
                        let padding = if width == 304. { 24. } else { 20. };
                        let available = width - 2. * padding;
                        view.update(cx, |view, cx| {
                            view.text = text.clone();
                            view.theme = theme;
                            view.role = *role;
                            view.padding = padding;
                            cx.notify();
                        });
                        cx.simulate_resize(size(px(width), px(2400.)));
                        take_title_nodes();
                        cx.update(|window, cx| {
                            window.refresh();
                            window.draw(cx).clear(cx);
                        });
                        let nodes = take_title_nodes();
                        let (_, node, bounds, glyph_width) = nodes
                            .iter()
                            .find(|(_, node, _, _)| node.value() == Some(text.text()))
                            .expect("original accessible title at real caller");
                        assert!(
                            bounds.left() >= px(padding)
                                && bounds.right() <= px(width - padding + 1.)
                        );
                        assert!(
                            *glyph_width <= px(available),
                            "glyph overflow: {} {width} {scale}",
                            text.text()
                        );
                        assert_eq!(node.value(), Some(text.text()));
                        cx.update(|window, _| {
                            let ty = theme.role(*role);
                            let style = TextStyle {
                                font_family: ty.family.into(),
                                font_weight: ty.weight,
                                ..Default::default()
                            };
                            let layout = layout_title(
                                text,
                                &style,
                                ty.size,
                                theme,
                                available,
                                window.text_system(),
                            );
                            let pieces: Vec<_> =
                                layout.lines.iter().map(|l| l.text.as_ref()).collect();
                            let normalized = pieces
                                .join("")
                                .chars()
                                .filter(|c| !c.is_whitespace())
                                .collect::<String>();
                            for (word, token_role) in text.tokens() {
                                if !italian_prose(word, token_role) {
                                    assert!(
                                        normalized.contains(word),
                                        "protected token received a hyphen: {word}: {pieces:?}"
                                    );
                                }
                            }
                            let reconstructed = pieces.join("\n").replace("-\n", "");
                            assert_eq!(
                                reconstructed
                                    .chars()
                                    .filter(|c| !c.is_whitespace())
                                    .collect::<String>(),
                                text.text()
                                    .chars()
                                    .filter(|c| !c.is_whitespace())
                                    .collect::<String>(),
                                "no glyph lost: {pieces:?}"
                            );
                            if !text.text().contains(' ') {
                                let ends: Vec<_> = text
                                    .text()
                                    .grapheme_indices(true)
                                    .map(|(i, g)| i + g.len())
                                    .collect();
                                let mut offset = 0;
                                for part in &pieces {
                                    offset += part.len();
                                    assert!(ends.contains(&offset), "split grapheme: {pieces:?}");
                                }
                                if pieces.len() > 1 {
                                    assert_eq!(
                                        layout.line_height,
                                        px(theme.body() * 1.2),
                                        "reduce before anywhere fallback"
                                    );
                                }
                            }
                            if text.text() == "Schwarzenegger" && width == 304. && scale == 2. {
                                assert_eq!(
                                    pieces.len(),
                                    1,
                                    "preview must reduce before wrapping a name"
                                );
                            }
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
            phrase,
            Theme::for_dark(false).sized(4., false),
        );
        let mut node = gpui::accesskit::Node::new(gpui::Role::Heading);
        heading.write_a11y_info(&mut node);
        assert_eq!(node.label(), Some(phrase));
        assert_eq!(italian().language(), hyphenation::Language::Italian);
    }
}

#[cfg(all(test, target_os = "macos"))]
mod review_regressions {
    use super::*;
    #[test]
    fn hcg4_review_bare_title_accessibility() {
        let element = title("Modifica terapia", Theme::for_dark(false));
        let mut node = gpui::accesskit::Node::new(gpui::Role::Label);
        element.write_a11y_info(&mut node);
        assert!(element.id().is_some());
        assert_eq!(element.a11y_role(), Some(gpui::Role::Label));
        assert_eq!(node.value(), Some("Modifica terapia"));
    }
    #[gpui::test]
    fn hcg4_review_overflow_and_protected_tokens(cx: &mut gpui::TestAppContext) {
        let system = gpui::WindowTextSystem::new(std::sync::Arc::new(gpui::TextSystem::new(
            std::sync::Arc::new(gpui_apple::AppleTextSystem::new()),
        )));
        let theme = Theme::for_dark(false).sized(4., false);
        let typography = theme.role(TypeRole::Threshold);
        let style = TextStyle {
            font_family: typography.family.into(),
            font_weight: typography.weight,
            ..Default::default()
        };
        for word in ["RSSMRA80A01H501U", "Александровская", "Worcestershire"] {
            let layout = layout_title(
                &TitleText::from(word),
                &style,
                typography.size,
                theme,
                350.,
                &system,
            );
            assert!(
                layout.lines.iter().all(|line| !line.text.contains('-')),
                "protected token: {word}"
            );
            assert!(layout.size.width <= px(350.), "overflow: {word}");
        }
        let _ = cx;
    }
}

#[cfg(test)]
type CapturedTitle = (
    GlobalElementId,
    gpui::accesskit::Node,
    Bounds<Pixels>,
    Pixels,
);
#[cfg(test)]
thread_local! { static CAPTURED: RefCell<Vec<CapturedTitle>> = const { RefCell::new(Vec::new()) }; }
#[cfg(test)]
pub(crate) fn take_title_nodes() -> Vec<CapturedTitle> {
    CAPTURED.with(|nodes| std::mem::take(&mut *nodes.borrow_mut()))
}

#[cfg(test)]
mod caller_contract_tests {
    use super::*;
    #[test]
    fn hcg4_review_every_title_caller_exposes_original_text() {
        take_title_nodes();
        for phrase in [
            "Pazienti",
            "Dati di prova nascosti",
            "La scheda non è disponibile",
            "Seleziona una scheda di prova",
            "Modifica terapia",
            "Moretti Elena",
            "Schwarzenegger",
            "Александровская",
            "RSSMRA80A01H501U",
            "ICD-11 WHO",
        ] {
            for theme in [
                Theme::for_dark(false),
                Theme::for_dark(true).sized(4., false),
            ] {
                let element = title(phrase, theme);
                let mut node =
                    gpui::accesskit::Node::new(element.a11y_role().expect("accessible role"));
                element.write_a11y_info(&mut node);
                assert!(element.id().is_some());
                assert_eq!(node.value(), Some(phrase));
                let button = crate::components::title_button(
                    "test-person-button",
                    TitleText::name(phrase),
                    theme,
                    false,
                    true,
                );
                let mut button_node = gpui::accesskit::Node::new(gpui::Role::Button);
                button.write_a11y_info(&mut button_node);
                assert_eq!(button_node.label(), Some(phrase));
                let wrapped = crate::components::heading("test-heading", phrase, theme);
                let mut node = gpui::accesskit::Node::new(gpui::Role::Heading);
                wrapped.write_a11y_info(&mut node);
                assert_eq!(node.label(), Some(phrase));
            }
        }
        for source in [
            include_str!("shell.rs"),
            include_str!("demo_app.rs"),
            include_str!("shell/scales.rs"),
        ] {
            assert!(!source.contains(".child(text!(patient.display_name()))"));
            assert!(!source.contains(".child(text!(profile.display_name()))"));
        }
    }
    #[test]
    fn hcg4_review_syllabation_requires_recognized_italian_prose() {
        for word in [
            "elettroencefalografico",
            "nell'ambulatorio",
            "nell’ambulatorio",
        ] {
            assert!(italian_prose(word, SegmentRole::ItalianProse));
            assert!(!italian_prose(word, SegmentRole::Name));
            assert!(!italian_prose(word, SegmentRole::Code));
        }
        for word in [
            "Worcestershire",
            "Schwarzenegger",
            "Александровская",
            "RSSMRA80A01H501U",
            "S52.521A",
            "9B71.0",
            "ELETTROENCEFALOGRAFICO",
            "elettroencefalografico2",
            "xyz’ambulatorio",
            "O'ambulatorio",
        ] {
            assert!(!italian_prose(word, SegmentRole::ItalianProse));
        }
        assert_eq!(elision_end("O'Shaughnessy"), None);
        assert_eq!(elision_end("l'elettroencefalogramma"), None);
    }
}

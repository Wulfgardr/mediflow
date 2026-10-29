use super::*;

pub(super) fn observe(element: Stateful<Div>) -> gpui::AnyElement {
    Observed(element).into_any_element()
}

pub(super) fn clip(id: &str) -> gpui::Bounds<gpui::Pixels> {
    MASKS.with(|masks| *masks.borrow().get(id).expect("real prepaint mask"))
}

thread_local! {
    static MASKS: std::cell::RefCell<HashMap<String, gpui::Bounds<gpui::Pixels>>> = std::cell::RefCell::new(HashMap::new());
    static NODES: std::cell::RefCell<HashMap<String, (gpui::accesskit::Node, gpui::Bounds<gpui::Pixels>)>> = std::cell::RefCell::new(HashMap::new());
}

pub(super) fn node(id: &str) -> (gpui::accesskit::Node, gpui::Bounds<gpui::Pixels>) {
    NODES.with(|nodes| {
        nodes
            .borrow()
            .get(id)
            .expect("command prepainted in this frame")
            .clone()
    })
}

struct Observed(Stateful<Div>);

impl gpui::IntoElement for Observed {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}

impl gpui::Element for Observed {
    type RequestLayoutState = <Stateful<Div> as gpui::Element>::RequestLayoutState;
    type PrepaintState = <Stateful<Div> as gpui::Element>::PrepaintState;
    fn id(&self) -> Option<gpui::ElementId> {
        gpui::Element::id(&self.0)
    }
    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        self.0.source_location()
    }
    fn a11y_role(&self) -> Option<Role> {
        self.0.a11y_role()
    }
    fn write_a11y_info(&self, node: &mut gpui::accesskit::Node) {
        self.0.write_a11y_info(node);
    }
    fn a11y_synthetic_children(
        &mut self,
        state: &mut Self::PrepaintState,
        builder: &mut gpui::A11ySubtreeBuilder,
    ) {
        gpui::Element::a11y_synthetic_children(&mut self.0, state, builder);
    }
    fn request_layout(
        &mut self,
        id: Option<&gpui::GlobalElementId>,
        inspector: Option<&gpui::InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (gpui::LayoutId, Self::RequestLayoutState) {
        self.0.request_layout(id, inspector, window, cx)
    }
    fn prepaint(
        &mut self,
        id: Option<&gpui::GlobalElementId>,
        inspector: Option<&gpui::InspectorElementId>,
        bounds: gpui::Bounds<gpui::Pixels>,
        state: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        let mut node = gpui::accesskit::Node::new(self.0.a11y_role().expect("real command role"));
        self.0.write_a11y_info(&mut node);
        MASKS.with(|masks| {
            masks.borrow_mut().insert(
                node.author_id().unwrap().to_string(),
                window.content_mask().bounds,
            );
        });
        NODES.with(|nodes| {
            nodes
                .borrow_mut()
                .insert(node.author_id().unwrap().to_string(), (node, bounds));
        });
        self.0.prepaint(id, inspector, bounds, state, window, cx)
    }
    fn paint(
        &mut self,
        id: Option<&gpui::GlobalElementId>,
        inspector: Option<&gpui::InspectorElementId>,
        bounds: gpui::Bounds<gpui::Pixels>,
        state: &mut Self::RequestLayoutState,
        prepaint: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        self.0
            .paint(id, inspector, bounds, state, prepaint, window, cx)
    }
}

pub(crate) fn observe_text(text: impl IntoElement) -> gpui::AnyElement {
    ObservedText(text.into_element(), true).into_any_element()
}
pub(crate) fn observe_ink(text: gpui::Text) -> ObservedText<gpui::Text> {
    ObservedText(text, false)
}

thread_local! {
    static TEXT_NODES: std::cell::RefCell<Vec<(gpui::GlobalElementId, gpui::accesskit::Node)>> = const { std::cell::RefCell::new(Vec::new()) };
}

pub(super) fn take_text_nodes() -> Vec<(gpui::GlobalElementId, gpui::accesskit::Node)> {
    TEXT_NODES.with(|nodes| std::mem::take(&mut *nodes.borrow_mut()))
}

pub(crate) struct ObservedText<E: gpui::Element>(E, bool);

impl<E: gpui::Element> gpui::IntoElement for ObservedText<E> {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}

impl<E: gpui::Element> gpui::Element for ObservedText<E> {
    type RequestLayoutState = <E as gpui::Element>::RequestLayoutState;
    type PrepaintState = <E as gpui::Element>::PrepaintState;
    fn id(&self) -> Option<gpui::ElementId> {
        gpui::Element::id(&self.0)
    }
    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        self.0.source_location()
    }
    fn a11y_role(&self) -> Option<Role> {
        self.0.a11y_role()
    }
    fn write_a11y_info(&self, node: &mut gpui::accesskit::Node) {
        self.0.write_a11y_info(node);
    }
    fn a11y_synthetic_children(
        &mut self,
        state: &mut Self::PrepaintState,
        builder: &mut gpui::A11ySubtreeBuilder,
    ) {
        gpui::Element::a11y_synthetic_children(&mut self.0, state, builder);
    }
    fn request_layout(
        &mut self,
        id: Option<&gpui::GlobalElementId>,
        inspector: Option<&gpui::InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (gpui::LayoutId, Self::RequestLayoutState) {
        self.0.request_layout(id, inspector, window, cx)
    }
    fn prepaint(
        &mut self,
        id: Option<&gpui::GlobalElementId>,
        inspector: Option<&gpui::InspectorElementId>,
        bounds: gpui::Bounds<gpui::Pixels>,
        state: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        let mut node = gpui::accesskit::Node::new(self.0.a11y_role().expect("accessible text"));
        self.0.write_a11y_info(&mut node);
        if self.1 {
            TEXT_NODES.with(|nodes| {
                nodes
                    .borrow_mut()
                    .push((id.expect("text GlobalElementId").clone(), node));
            });
        }
        self.0.prepaint(id, inspector, bounds, state, window, cx)
    }
    fn paint(
        &mut self,
        id: Option<&gpui::GlobalElementId>,
        inspector: Option<&gpui::InspectorElementId>,
        bounds: gpui::Bounds<gpui::Pixels>,
        state: &mut Self::RequestLayoutState,
        prepaint: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        let mut node = gpui::accesskit::Node::new(self.0.a11y_role().expect("accessible text"));
        self.0.write_a11y_info(&mut node);
        self.0
            .paint(id, inspector, bounds, state, prepaint, window, cx);
        record_ink(node.value().unwrap_or_default().to_owned(), bounds, window);
    }
}

pub(crate) fn assert_unique_texts(
    cx: &mut gpui::TestAppContext,
    render: impl FnMut(&mut Window, &mut App) -> gpui::AnyElement + 'static,
    expected: usize,
) {
    struct Fixture<F>(F);
    impl<F: FnMut(&mut Window, &mut App) -> gpui::AnyElement + 'static> gpui::Render for Fixture<F> {
        fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            (self.0)(window, cx)
        }
    }
    let (_, cx) = cx.add_window_view(|_, _| Fixture(render));
    let mut previous = None;
    for _ in 0..2 {
        take_text_nodes();
        cx.update(|window, cx| {
            window.refresh();
            window.draw(cx).clear(cx);
        });
        let nodes = take_text_nodes();
        assert_eq!(
            nodes.len(),
            expected,
            "all expected texts remain accessible"
        );
        let mut ids = HashSet::new();
        for (id, node) in &nodes {
            assert_eq!(node.role(), Role::Label);
            assert!(node.value().is_some_and(|value| !value.is_empty()));
            assert!(
                ids.insert(id.clone()),
                "duplicate accessible text ID: {id:?}, {node:?}"
            );
        }
        let current: Vec<_> = nodes.into_iter().map(|(id, _)| id).collect();
        if let Some(previous) = previous {
            assert_eq!(current, previous, "IDs survive redraw");
        }
        previous = Some(current);
    }
}

thread_local! {
    static ACTIVE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static INKS: std::cell::RefCell<Vec<InkSample>> = const { std::cell::RefCell::new(Vec::new()) };
    static FIELDS: std::cell::RefCell<Vec<(String, gpui::Hsla, gpui::Hsla, gpui::Hsla)>> = const { std::cell::RefCell::new(Vec::new()) };
}
const INK_TAG_SCALE: f32 = 8192.;

pub(crate) struct InkSample {
    pub label: String,
}
pub(crate) struct ContrastProbe;
impl Drop for ContrastProbe {
    fn drop(&mut self) {
        ACTIVE.with(|a| a.set(false));
    }
}
pub(crate) fn begin_inks() -> ContrastProbe {
    ACTIVE.with(|a| a.set(true));
    INKS.with(|v| v.borrow_mut().clear());
    ContrastProbe
}
/// Paints a test swatch so GPUI applies the same ancestor opacity as the text.
pub(crate) fn record_ink(label: String, bounds: gpui::Bounds<gpui::Pixels>, window: &mut Window) {
    if !ACTIVE.with(|a| a.get()) || label.is_empty() {
        return;
    }
    let bounds = bounds.intersect(&window.content_mask().bounds);
    if bounds.is_empty() {
        return;
    }
    let tag = INKS.with(|v| {
        let mut v = v.borrow_mut();
        v.push(InkSample { label });
        v.len()
    });
    let mut quad = gpui::fill(
        gpui::Bounds::new(bounds.center(), gpui::size(px(1.), px(1.))),
        window.text_style().color,
    );
    quad.corner_radii.top_left = px(tag as f32 / INK_TAG_SCALE);
    window.paint_quad(quad);
}
pub(crate) fn take_inks() -> Vec<InkSample> {
    INKS.with(|v| std::mem::take(&mut *v.borrow_mut()))
}
pub(crate) fn record_field(label: String, ink: gpui::Hsla, paper: gpui::Hsla, border: gpui::Hsla) {
    FIELDS.with(|v| v.borrow_mut().push((label, ink, paper, border)));
}
pub(crate) fn take_fields() -> Vec<(String, gpui::Hsla, gpui::Hsla, gpui::Hsla)> {
    FIELDS.with(|v| std::mem::take(&mut *v.borrow_mut()))
}
fn over(fg: gpui::Rgba, bg: gpui::Rgba) -> gpui::Rgba {
    let a = fg.a + bg.a * (1. - fg.a);
    if a == 0. {
        return gpui::Rgba {
            r: 0.,
            g: 0.,
            b: 0.,
            a: 0.,
        };
    }
    let channel = |f, b| (f * fg.a + b * bg.a * (1. - fg.a)) / a;
    gpui::Rgba {
        r: channel(fg.r, bg.r),
        g: channel(fg.g, bg.g),
        b: channel(fg.b, bg.b),
        a,
    }
}
pub(crate) fn contrast(a: gpui::Rgba, b: gpui::Rgba) -> f64 {
    fn lum(c: gpui::Rgba) -> f64 {
        let linear = |x: f32| {
            let x = f64::from(x);
            if x <= 0.04045 {
                x / 12.92
            } else {
                ((x + 0.055) / 1.055).powf(2.4)
            }
        };
        0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b)
    }
    let a = lum(a);
    let b = lum(b);
    (a.max(b) + 0.05) / (a.min(b) + 0.05)
}
pub(crate) fn painted_contrasts(
    samples: Vec<InkSample>,
    quads: &[gpui::Quad],
    scale: f32,
) -> Vec<(String, f64)> {
    let tag = |q: &gpui::Quad| (q.corner_radii.top_left.0 / scale * INK_TAG_SCALE).round() as usize;
    let marker = |q: &gpui::Quad| (1..=samples.len()).contains(&tag(q));
    samples
        .iter()
        .enumerate()
        .map(|(index, sample)| {
            let Some(position) = quads.iter().position(|q| tag(q) == index + 1) else {
                return (sample.label.clone(), 1.);
            };
            let point = quads[position].bounds.center();
            let covers = |q: &gpui::Quad| {
                q.bounds.contains(&point) && q.content_mask.bounds.contains(&point) && !marker(q)
            };
            let color = |q: &gpui::Quad| {
                q.background
                    .as_solid()
                    .expect("contrast probe requires an observed solid surface")
                    .to_rgb()
            };
            let mut bg = gpui::Rgba {
                r: 0.,
                g: 0.,
                b: 0.,
                a: 0.,
            };
            for q in quads[..position].iter().filter(|q| covers(q)) {
                bg = over(color(q), bg);
            }
            assert!(
                bg.a >= 0.999,
                "no opaque painted background under {}",
                sample.label
            );
            let mut fg = over(color(&quads[position]), bg);
            for q in quads[position + 1..].iter().filter(|q| covers(q)) {
                let c = color(q);
                bg = over(c, bg);
                fg = over(c, fg);
            }
            (sample.label.clone(), contrast(fg, bg))
        })
        .collect()
}

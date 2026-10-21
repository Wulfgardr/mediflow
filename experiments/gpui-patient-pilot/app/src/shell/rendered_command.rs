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

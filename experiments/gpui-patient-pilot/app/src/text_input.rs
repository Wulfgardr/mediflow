// Portions adapted from Zed Industries' GPUI examples/input.rs, Apache-2.0.
// Upstream: zed-industries/zed@56934ec0560bce8929025497411de7f5322fb6ca.
// Changes: wrapped multiline text, read-only selection, bounded undo/redo,
// Italian labels, AccessKit identifiers, and MediFlow design tokens.

use std::ops::Range;

use gpui::{
    App, Bounds, ClipboardItem, Context, CursorStyle, ElementId, ElementInputHandler, Entity,
    EntityInputHandler, EventEmitter, FocusHandle, Focusable, GlobalElementId, HighlightStyle,
    InspectorElementId, KeyBinding, LayoutId, MouseButton, MouseDownEvent, MouseMoveEvent,
    MouseUpEvent, Pixels, Point, Role, ScrollHandle, SharedString, StyledText, Subscription,
    TextLayout, UTF16Selection, UnderlineStyle, Window, actions, fill, point, prelude::*, px, size,
};
use unicode_segmentation::UnicodeSegmentation;

use crate::components::{WritingInk, WritingStyle, WritingSurface};
use crate::theme::{Theme, TypeRole, TypeStyle};

actions!(
    mediflow_text,
    [
        Backspace,
        Delete,
        Left,
        Right,
        Up,
        Down,
        SelectLeft,
        SelectRight,
        SelectUp,
        SelectDown,
        SelectAll,
        Home,
        End,
        SelectHome,
        SelectEnd,
        DocumentStart,
        DocumentEnd,
        Newline,
        Paste,
        Cut,
        Copy,
        Undo,
        Redo
    ]
);

pub struct InputChanged(pub String);

#[derive(Clone)]
struct Snapshot {
    content: SharedString,
    range: Range<usize>,
    reversed: bool,
}

pub struct TextInput {
    id: &'static str,
    label: &'static str,
    focus: FocusHandle,
    content: SharedString,
    placeholder: SharedString,
    range: Range<usize>,
    reversed: bool,
    marked: Option<Range<usize>>,
    layout: Option<TextLayout>,
    painted_content: SharedString,
    selecting: bool,
    autoscroll: bool,
    scroll: ScrollHandle,
    focus_subscription: Option<Subscription>,
    pub read_only: bool,
    multiline: bool,
    secret: bool,
    theme: Theme,
    writing_ink: Option<WritingInk>,
    undo: Vec<Snapshot>,
    redo: Vec<Snapshot>,
}

impl EventEmitter<InputChanged> for TextInput {}

impl TextInput {
    pub fn new(
        id: &'static str,
        label: &'static str,
        placeholder: &'static str,
        multiline: bool,
        theme: Theme,
        cx: &mut Context<Self>,
    ) -> Self {
        Self {
            id,
            label,
            focus: cx.focus_handle().tab_stop(true),
            content: "".into(),
            placeholder: placeholder.into(),
            range: 0..0,
            reversed: false,
            marked: None,
            layout: None,
            painted_content: "".into(),
            selecting: false,
            autoscroll: true,
            scroll: ScrollHandle::new(),
            focus_subscription: None,
            read_only: false,
            multiline,
            secret: false,
            theme,
            writing_ink: None,
            undo: Vec::new(),
            redo: Vec::new(),
        }
    }

    pub fn configure(&mut self, theme: Theme, read_only: bool, cx: &mut Context<Self>) {
        if self.theme.ink == theme.ink
            && self.theme.scale == theme.scale
            && self.read_only == read_only
        {
            return;
        }
        self.theme = theme;
        self.read_only = read_only;
        cx.notify();
    }

    #[cfg(test)]
    pub fn accessible_label(&self) -> &'static str {
        self.label
    }

    pub fn set_label(&mut self, label: &'static str, cx: &mut Context<Self>) {
        if self.label != label {
            self.label = label;
            cx.notify();
        }
    }

    pub fn set_writing_ink(&mut self, ink: WritingInk, cx: &mut Context<Self>) {
        if self.writing_ink != Some(ink) {
            self.writing_ink = Some(ink);
            cx.notify();
        }
    }

    pub fn secret(mut self) -> Self {
        self.secret = true;
        self
    }

    pub fn value(&self) -> &str {
        &self.content
    }

    fn display_index(&self, byte: usize) -> usize {
        if self.secret {
            masked_index(&self.content, byte)
        } else {
            byte
        }
    }

    fn content_index(&self, displayed: usize) -> usize {
        if self.secret {
            unmasked_index(&self.content, displayed)
        } else {
            floor_boundary(&self.content, displayed)
        }
    }

    /// Authoritative reads replace editor content without emitting an edit.
    pub fn set_content(&mut self, content: impl Into<SharedString>, cx: &mut Context<Self>) {
        self.content = content.into();
        self.range = 0..0;
        self.reversed = false;
        self.marked = None;
        self.layout = None;
        self.painted_content = "".into();
        self.autoscroll = true;
        self.scroll.set_offset(point(px(0.), px(0.)));
        self.undo.clear();
        self.redo.clear();
        cx.notify();
    }

    pub fn retire(&mut self, cx: &mut Context<Self>) {
        self.set_content("", cx);
        self.read_only = true;
    }

    pub fn focus(&self, window: &mut Window, cx: &mut App) {
        window.focus(&self.focus, cx);
    }

    pub fn focus_and_select(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.focus(window, cx);
        self.select_all(&SelectAll, window, cx);
    }

    fn snapshot(&self) -> Snapshot {
        Snapshot {
            content: self.content.clone(),
            range: self.range.clone(),
            reversed: self.reversed,
        }
    }

    fn changed(&mut self, window: &Window, cx: &mut Context<Self>) {
        self.autoscroll = true;
        window.notify_text_input_changed(&self.focus);
        // Secret controls are read explicitly at submission, never broadcast.
        if !self.secret {
            cx.emit(InputChanged(self.content.to_string()));
        }
        cx.notify();
    }

    fn checkpoint(&mut self) {
        if self.secret {
            return;
        }
        if self.undo.len() == 64 {
            self.undo.remove(0);
        }
        self.undo.push(self.snapshot());
        self.redo.clear();
    }

    fn undo(&mut self, _: &Undo, window: &mut Window, cx: &mut Context<Self>) {
        if self.read_only {
            return;
        }
        if let Some(previous) = self.undo.pop() {
            self.redo.push(self.snapshot());
            self.restore(previous, window, cx);
        }
    }

    fn redo(&mut self, _: &Redo, window: &mut Window, cx: &mut Context<Self>) {
        if self.read_only {
            return;
        }
        if let Some(next) = self.redo.pop() {
            self.undo.push(self.snapshot());
            self.restore(next, window, cx);
        }
    }

    fn restore(&mut self, snapshot: Snapshot, window: &Window, cx: &mut Context<Self>) {
        self.content = snapshot.content;
        self.range = snapshot.range;
        self.reversed = snapshot.reversed;
        self.marked = None;
        self.changed(window, cx);
    }

    fn cursor(&self) -> usize {
        if self.reversed {
            self.range.start
        } else {
            self.range.end
        }
    }

    fn move_to(&mut self, offset: usize, select: bool, window: &Window, cx: &mut Context<Self>) {
        let offset = floor_boundary(&self.content, offset);
        if select {
            let anchor = if self.reversed {
                self.range.end
            } else {
                self.range.start
            };
            self.range = anchor.min(offset)..anchor.max(offset);
            self.reversed = offset < anchor;
        } else {
            self.range = offset..offset;
            self.reversed = false;
        }
        window.notify_text_selection_changed(&self.focus);
        self.autoscroll = true;
        cx.notify();
    }

    fn previous(&self) -> usize {
        self.content
            .grapheme_indices(true)
            .rev()
            .find_map(|(i, _)| (i < self.cursor()).then_some(i))
            .unwrap_or(0)
    }

    fn next(&self) -> usize {
        self.content
            .grapheme_indices(true)
            .find_map(|(i, _)| (i > self.cursor()).then_some(i))
            .unwrap_or(self.content.len())
    }

    fn left(&mut self, _: &Left, w: &mut Window, cx: &mut Context<Self>) {
        self.move_to(
            if self.range.is_empty() {
                self.previous()
            } else {
                self.range.start
            },
            false,
            w,
            cx,
        );
    }
    fn right(&mut self, _: &Right, w: &mut Window, cx: &mut Context<Self>) {
        self.move_to(
            if self.range.is_empty() {
                self.next()
            } else {
                self.range.end
            },
            false,
            w,
            cx,
        );
    }
    fn select_left(&mut self, _: &SelectLeft, w: &mut Window, cx: &mut Context<Self>) {
        self.move_to(self.previous(), true, w, cx);
    }
    fn select_right(&mut self, _: &SelectRight, w: &mut Window, cx: &mut Context<Self>) {
        self.move_to(self.next(), true, w, cx);
    }
    fn select_all(&mut self, _: &SelectAll, w: &mut Window, cx: &mut Context<Self>) {
        self.range = 0..0;
        self.reversed = false;
        self.move_to(self.content.len(), true, w, cx);
    }
    fn home_offset(&self) -> usize {
        self.content[..self.cursor()]
            .rfind('\n')
            .map_or(0, |i| i + 1)
    }
    fn end_offset(&self) -> usize {
        self.content[self.cursor()..]
            .find('\n')
            .map_or(self.content.len(), |i| self.cursor() + i)
    }
    fn home(&mut self, _: &Home, w: &mut Window, cx: &mut Context<Self>) {
        self.move_to(self.home_offset(), false, w, cx);
    }
    fn end(&mut self, _: &End, w: &mut Window, cx: &mut Context<Self>) {
        self.move_to(self.end_offset(), false, w, cx);
    }
    fn select_home(&mut self, _: &SelectHome, w: &mut Window, cx: &mut Context<Self>) {
        self.move_to(self.home_offset(), true, w, cx);
    }
    fn select_end(&mut self, _: &SelectEnd, w: &mut Window, cx: &mut Context<Self>) {
        self.move_to(self.end_offset(), true, w, cx);
    }
    fn document_start(&mut self, _: &DocumentStart, w: &mut Window, cx: &mut Context<Self>) {
        self.move_to(0, false, w, cx);
    }
    fn document_end(&mut self, _: &DocumentEnd, w: &mut Window, cx: &mut Context<Self>) {
        self.move_to(self.content.len(), false, w, cx);
    }

    fn vertical(&mut self, direction: f32, select: bool, w: &mut Window, cx: &mut Context<Self>) {
        if self.painted_content != self.content {
            return;
        }
        let Some(layout) = &self.layout else {
            return;
        };
        let Some(position) = layout.position_for_index(self.display_index(self.cursor())) else {
            return;
        };
        let target = point(
            position.x,
            position.y
                + px(self
                    .theme
                    .role(if self.multiline {
                        TypeRole::Prose
                    } else {
                        TypeRole::Body
                    })
                    .line_height)
                    * direction
                + px(1.),
        );
        let index = layout.index_for_position(target).unwrap_or_else(|i| i);
        self.move_to(self.content_index(index), select, w, cx);
    }
    fn up(&mut self, _: &Up, w: &mut Window, cx: &mut Context<Self>) {
        self.vertical(-1., false, w, cx);
    }
    fn down(&mut self, _: &Down, w: &mut Window, cx: &mut Context<Self>) {
        self.vertical(1., false, w, cx);
    }
    fn select_up(&mut self, _: &SelectUp, w: &mut Window, cx: &mut Context<Self>) {
        self.vertical(-1., true, w, cx);
    }
    fn select_down(&mut self, _: &SelectDown, w: &mut Window, cx: &mut Context<Self>) {
        self.vertical(1., true, w, cx);
    }

    fn backspace(&mut self, _: &Backspace, w: &mut Window, cx: &mut Context<Self>) {
        if self.read_only {
            return;
        }
        if self.range.is_empty() {
            self.range.start = self.previous();
        }
        self.replace_text_in_range(None, "", w, cx);
    }
    fn delete(&mut self, _: &Delete, w: &mut Window, cx: &mut Context<Self>) {
        if self.read_only {
            return;
        }
        if self.range.is_empty() {
            self.range.end = self.next();
        }
        self.replace_text_in_range(None, "", w, cx);
    }
    fn newline(&mut self, _: &Newline, w: &mut Window, cx: &mut Context<Self>) {
        if self.multiline {
            self.replace_text_in_range(None, "\n", w, cx);
        }
    }
    fn paste(&mut self, _: &Paste, w: &mut Window, cx: &mut Context<Self>) {
        if self.read_only {
            return;
        }
        if let Some(value) = cx.read_from_clipboard().and_then(|item| item.text()) {
            self.replace_text_in_range(None, &value, w, cx);
        }
    }
    fn copy(&mut self, _: &Copy, _: &mut Window, cx: &mut Context<Self>) {
        if !self.secret && !self.range.is_empty() {
            cx.write_to_clipboard(ClipboardItem::new_string(
                self.content[self.range.clone()].to_string(),
            ));
        }
    }
    fn cut(&mut self, _: &Cut, w: &mut Window, cx: &mut Context<Self>) {
        if !self.read_only && !self.range.is_empty() {
            self.copy(&Copy, w, cx);
            self.replace_text_in_range(None, "", w, cx);
        }
    }

    fn index_at(&self, position: Point<Pixels>) -> usize {
        if self.painted_content != self.content {
            return self.cursor();
        }
        self.layout
            .as_ref()
            .map(|layout| {
                self.content_index(layout.index_for_position(position).unwrap_or_else(|i| i))
            })
            .unwrap_or(0)
    }
    fn mouse_down(&mut self, event: &MouseDownEvent, w: &mut Window, cx: &mut Context<Self>) {
        self.focus(w, cx);
        self.selecting = true;
        self.move_to(self.index_at(event.position), event.modifiers.shift, w, cx);
    }
    fn mouse_up(&mut self, _: &MouseUpEvent, _: &mut Window, _: &mut Context<Self>) {
        self.selecting = false;
    }
    fn mouse_move(&mut self, event: &MouseMoveEvent, w: &mut Window, cx: &mut Context<Self>) {
        if self.selecting {
            self.move_to(self.index_at(event.position), true, w, cx);
        }
    }

    fn byte_range_for_utf16(&self, range: Range<usize>) -> Range<usize> {
        let start = utf16_to_byte(&self.content, range.start);
        let end = utf16_to_byte(&self.content, range.end);
        start.min(end)..start.max(end)
    }
    fn to_utf16(&self, range: Range<usize>) -> Range<usize> {
        self.content[..floor_boundary(&self.content, range.start)]
            .encode_utf16()
            .count()
            ..self.content[..floor_boundary(&self.content, range.end)]
                .encode_utf16()
                .count()
    }
}

impl EntityInputHandler for TextInput {
    fn text_for_range(
        &mut self,
        range: Range<usize>,
        actual: &mut Option<Range<usize>>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<String> {
        platform_text_for_range(&self.content, self.secret, range, actual)
    }
    fn selected_text_range(
        &mut self,
        _: bool,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        Some(UTF16Selection {
            range: self.to_utf16(self.range.clone()),
            reversed: self.reversed,
        })
    }
    fn set_selected_text_range(
        &mut self,
        range: Range<usize>,
        w: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.range = self.byte_range_for_utf16(range);
        self.reversed = false;
        w.notify_text_selection_changed(&self.focus);
        cx.notify();
    }
    fn text_length_utf16(&mut self, _: &mut Window, _: &mut Context<Self>) -> Option<usize> {
        Some(self.content.encode_utf16().count())
    }
    fn marked_text_range(&self, _: &mut Window, _: &mut Context<Self>) -> Option<Range<usize>> {
        self.marked.clone().map(|r| self.to_utf16(r))
    }
    fn unmark_text(&mut self, w: &mut Window, cx: &mut Context<Self>) {
        self.marked = None;
        w.notify_text_input_changed(&self.focus);
        cx.notify();
    }

    fn replace_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        value: &str,
        w: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.read_only {
            return;
        }
        let range = committed_replacement_range(
            range.map(|r| self.byte_range_for_utf16(r)),
            &mut self.marked,
            self.range.clone(),
        );
        let value = if self.multiline {
            value.replace("\r\n", "\n").replace('\r', "\n")
        } else {
            value.replace(['\n', '\r'], " ")
        };
        if self.content[range.clone()] == value {
            // A committed preedit may have identical bytes. It still ends composition.
            self.move_to(range.end, false, w, cx);
            w.notify_text_input_changed(&self.focus);
            return;
        }
        self.checkpoint();
        self.content =
            (self.content[..range.start].to_owned() + &value + &self.content[range.end..]).into();
        let end = range.start + value.len();
        self.range = end..end;
        self.reversed = false;
        self.marked = None;
        self.changed(w, cx);
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        value: &str,
        selection: Option<Range<usize>>,
        w: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.read_only {
            return;
        }
        let range = range
            .map(|r| self.byte_range_for_utf16(r))
            .or_else(|| self.marked.clone())
            .unwrap_or(self.range.clone());
        // Keep composition exact: platform selection offsets refer to the supplied string.
        if self.marked.is_none() {
            self.checkpoint();
        }
        self.content =
            (self.content[..range.start].to_owned() + value + &self.content[range.end..]).into();
        self.marked = (!value.is_empty()).then_some(range.start..range.start + value.len());
        self.range = selection
            .map(|r| {
                range.start + utf16_to_byte(value, r.start)
                    ..range.start + utf16_to_byte(value, r.end)
            })
            .unwrap_or(range.start + value.len()..range.start + value.len());
        self.reversed = false;
        self.changed(w, cx);
    }

    fn bounds_for_range(
        &mut self,
        range: Range<usize>,
        _: Bounds<Pixels>,
        w: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        if self.painted_content != self.content {
            return None;
        }
        let range = self.byte_range_for_utf16(range);
        let layout = self.layout.as_ref()?;
        let start = layout.position_for_index(self.display_index(range.start))?;
        let end = layout.position_for_index(self.display_index(range.end))?;
        Some(Bounds::new(
            start,
            size((end.x - start.x).max(px(2.)), w.line_height()),
        ))
    }
    fn selection_bounds_for_range(
        &mut self,
        range: Range<usize>,
        _: Bounds<Pixels>,
        w: &mut Window,
        _: &mut Context<Self>,
    ) -> Vec<Bounds<Pixels>> {
        if self.painted_content != self.content {
            return vec![];
        }
        let range = self.byte_range_for_utf16(range);
        let Some(layout) = self.layout.as_ref() else {
            return vec![];
        };
        let mut result: Vec<Bounds<Pixels>> = Vec::new();
        for (relative, grapheme) in self.content[range.clone()].grapheme_indices(true) {
            let index = range.start + relative;
            let (Some(start), Some(end)) = (
                layout.position_for_index(self.display_index(index)),
                layout.position_for_index(self.display_index(index + grapheme.len())),
            ) else {
                continue;
            };
            let width = if end.y == start.y {
                (end.x - start.x).max(px(2.))
            } else {
                (layout.bounds().right() - start.x).max(px(2.))
            };
            if let Some(last) = result.last_mut()
                && last.origin.y == start.y
            {
                last.size.width = (start.x + width - last.left()).max(last.size.width);
            } else {
                result.push(Bounds::new(start, size(width, w.line_height())));
            }
        }
        result
    }
    fn character_index_for_point(
        &mut self,
        point: Point<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<usize> {
        if self.painted_content != self.content {
            return None;
        }
        Some(self.content[..self.index_at(point)].encode_utf16().count())
    }
}

struct InputElement {
    input: Entity<TextInput>,
    text: StyledText,
    content: SharedString,
}

impl IntoElement for InputElement {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}

impl Element for InputElement {
    type RequestLayoutState = ();
    type PrepaintState = ();
    fn id(&self) -> Option<ElementId> {
        None
    }
    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }
    fn request_layout(
        &mut self,
        id: Option<&GlobalElementId>,
        inspector: Option<&InspectorElementId>,
        w: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        self.text.request_layout(id, inspector, w, cx)
    }
    fn prepaint(
        &mut self,
        id: Option<&GlobalElementId>,
        inspector: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        layout: &mut (),
        w: &mut Window,
        cx: &mut App,
    ) {
        self.text.prepaint(id, inspector, bounds, layout, w, cx);
        let input = self.input.read(cx);
        if input.autoscroll && input.focus.is_focused(w) {
            if let Some(position) = self
                .text
                .layout()
                .position_for_index(input.display_index(input.cursor()))
            {
                let viewport = input.scroll.bounds();
                let offset = input.scroll.offset();
                let next_y = reveal_offset(
                    f32::from(offset.y),
                    f32::from(input.scroll.max_offset().y),
                    f32::from(viewport.top() + px(12.)),
                    f32::from(viewport.bottom() - px(12.)),
                    f32::from(position.y),
                    f32::from(position.y + w.line_height()),
                );
                if px(next_y) != offset.y {
                    input.scroll.set_offset(point(offset.x, px(next_y)));
                    // Div scroll offsets are applied before the child is prepainted.
                    // Repaint once with the new offset; no timer or animation is used.
                    w.on_next_frame(|window, _| window.refresh());
                }
                w.request_autoscroll(Bounds::new(position, size(px(4.), w.line_height())));
            }
            self.input.update(cx, |input, _| input.autoscroll = false);
        }
    }
    fn paint(
        &mut self,
        id: Option<&GlobalElementId>,
        inspector: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        request: &mut (),
        prepaint: &mut (),
        w: &mut Window,
        cx: &mut App,
    ) {
        let input = self.input.read(cx);
        let focus = input.focus.clone();
        let cursor = input.display_index(input.cursor());
        let caret = input.range.is_empty() && !input.read_only && focus.is_focused(w);
        let fresh = input.theme.fresh;
        w.handle_input(
            &focus,
            ElementInputHandler::new(bounds, self.input.clone()),
            cx,
        );
        self.text
            .paint(id, inspector, bounds, request, prepaint, w, cx);
        let layout = self.text.layout().clone();
        if caret && let Some(position) = layout.position_for_index(cursor) {
            w.paint_quad(fill(
                Bounds::new(position, size(px(2.), w.line_height())),
                fresh,
            ));
        }
        self.input.update(cx, |input, _| {
            input.layout = Some(layout);
            input.painted_content = self.content.clone();
        });
    }
}

impl Render for TextInput {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.focus_subscription.is_none() {
            self.focus_subscription = Some(cx.on_focus(&self.focus, window, |input, _, cx| {
                input.autoscroll = true;
                cx.notify();
            }));
        }
        let theme = self.theme;
        let empty = self.content.is_empty();
        let display: SharedString = if empty {
            self.placeholder.clone()
        } else if self.secret {
            "•".repeat(self.content.chars().count()).into()
        } else if self.content.ends_with('\n') {
            format!("{} ", self.content).into()
        } else {
            self.content.clone()
        };
        let highlights = input_highlights(
            &display,
            self.display_index(self.range.start)..self.display_index(self.range.end),
            self.marked
                .clone()
                .map(|r| self.display_index(r.start)..self.display_index(r.end)),
            theme,
        );
        gpui::div()
            .id(self.id)
            .accessibility_id(self.id)
            .role(if self.secret {
                Role::PasswordInput
            } else if self.multiline {
                Role::MultilineTextInput
            } else {
                Role::TextInput
            })
            .aria_label(self.label)
            .aria_value(if self.secret {
                SharedString::from("•".repeat(self.content.chars().count()))
            } else {
                self.content.clone()
            })
            .aria_placeholder(self.placeholder.clone())
            .aria_description(if self.secret {
                "Campo riservato. I caratteri sono nascosti."
            } else if self.read_only {
                "Testo selezionabile e copiabile. Sola lettura."
            } else if self.multiline {
                "Testo su più righe. Le modifiche restano una bozza fino alla conferma."
            } else {
                "Campo di testo."
            })
            .a11y_synthetic_children({
                let read_only = self.read_only;
                move |builder| {
                    if read_only {
                        builder.parent_node().set_read_only();
                    }
                }
            })
            .key_context("MediFlowTextInput")
            .track_focus(&self.focus)
            .tab_stop(true)
            .cursor(CursorStyle::IBeam)
            .w_full()
            .max_h(px(if self.multiline {
                (theme.role(TypeRole::Prose).line_height * 5. + 28.).max(256.)
            } else {
                256.
            }))
            .track_scroll(&self.scroll)
            .overflow_y_scroll()
            .min_h(px(40.))
            .when(self.multiline, |el| {
                el.min_h(px(
                    (theme.role(TypeRole::Prose).line_height * 3. + 28.).max(160.)
                ))
            })
            .p(px(if self.multiline { 12. } else { 8. }))
            .border_1()
            .border_color(theme.strong_rule)
            .rounded(px(theme.control_radius))
            .bg(theme.paper)
            .focus(|style| {
                style
                    .border_color(theme.fresh)
                    .shadow(vec![theme.focus_ring(false)])
            })
            .text_color(theme.ink)
            .when_some(self.writing_ink, |element, ink| {
                element.writing_ink(ink, WritingSurface::Plane, theme)
            })
            .when(empty, |element| element.text_color(theme.secondary))
            .type_role(
                theme,
                if self.multiline {
                    TypeRole::Prose
                } else {
                    TypeRole::Body
                },
            )
            .on_action(cx.listener(Self::backspace))
            .on_action(cx.listener(Self::delete))
            .on_action(cx.listener(Self::left))
            .on_action(cx.listener(Self::right))
            .on_action(cx.listener(Self::up))
            .on_action(cx.listener(Self::down))
            .on_action(cx.listener(Self::select_left))
            .on_action(cx.listener(Self::select_right))
            .on_action(cx.listener(Self::select_up))
            .on_action(cx.listener(Self::select_down))
            .on_action(cx.listener(Self::select_all))
            .on_action(cx.listener(Self::home))
            .on_action(cx.listener(Self::end))
            .on_action(cx.listener(Self::select_home))
            .on_action(cx.listener(Self::select_end))
            .on_action(cx.listener(Self::document_start))
            .on_action(cx.listener(Self::document_end))
            .on_action(cx.listener(Self::newline))
            .on_action(cx.listener(Self::paste))
            .on_action(cx.listener(Self::copy))
            .on_action(cx.listener(Self::cut))
            .on_action(cx.listener(Self::undo))
            .on_action(cx.listener(Self::redo))
            .on_mouse_down(MouseButton::Left, cx.listener(Self::mouse_down))
            .on_mouse_up(MouseButton::Left, cx.listener(Self::mouse_up))
            .on_mouse_up_out(MouseButton::Left, cx.listener(Self::mouse_up))
            .on_mouse_move(cx.listener(Self::mouse_move))
            .child(InputElement {
                input: cx.entity(),
                text: StyledText::new(display).with_highlights(highlights),
                content: self.content.clone(),
            })
    }
}

impl Focusable for TextInput {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

pub fn bind_keys(cx: &mut App) {
    let context = Some("MediFlowTextInput");
    cx.bind_keys([
        KeyBinding::new("backspace", Backspace, context),
        KeyBinding::new("delete", Delete, context),
        KeyBinding::new("left", Left, context),
        KeyBinding::new("right", Right, context),
        KeyBinding::new("up", Up, context),
        KeyBinding::new("down", Down, context),
        KeyBinding::new("shift-left", SelectLeft, context),
        KeyBinding::new("shift-right", SelectRight, context),
        KeyBinding::new("shift-up", SelectUp, context),
        KeyBinding::new("shift-down", SelectDown, context),
        KeyBinding::new("home", Home, context),
        KeyBinding::new("end", End, context),
        KeyBinding::new("shift-home", SelectHome, context),
        KeyBinding::new("shift-end", SelectEnd, context),
        KeyBinding::new("enter", Newline, context),
        KeyBinding::new("shift-enter", Newline, context),
        KeyBinding::new("secondary-a", SelectAll, context),
        KeyBinding::new("secondary-c", Copy, context),
        KeyBinding::new("secondary-v", Paste, context),
        KeyBinding::new("secondary-x", Cut, context),
        KeyBinding::new("secondary-z", Undo, context),
        KeyBinding::new("secondary-shift-z", Redo, context),
        KeyBinding::new("secondary-home", DocumentStart, context),
        KeyBinding::new("secondary-end", DocumentEnd, context),
    ]);
}

// Move only enough to reveal the caret line, including large text. The offset
// is bounded by the actual scrollable content, not by the input string length.
fn reveal_offset(
    offset: f32,
    maximum: f32,
    viewport_start: f32,
    viewport_end: f32,
    target_start: f32,
    target_end: f32,
) -> f32 {
    let delta = if target_start < viewport_start
        || target_end - target_start > viewport_end - viewport_start
    {
        viewport_start - target_start
    } else if target_end > viewport_end {
        viewport_end - target_end
    } else {
        0.
    };
    (offset + delta).clamp(-maximum.max(0.), 0.)
}

fn floor_boundary(text: &str, offset: usize) -> usize {
    let mut offset = offset.min(text.len());
    while !text.is_char_boundary(offset) {
        offset -= 1;
    }
    offset
}

fn masked_index(text: &str, byte: usize) -> usize {
    text[..floor_boundary(text, byte)].chars().count() * '•'.len_utf8()
}

fn unmasked_index(text: &str, displayed: usize) -> usize {
    text.char_indices()
        .nth(displayed / '•'.len_utf8())
        .map_or(text.len(), |(byte, _)| byte)
}

// Committing text always consumes the preedit, including an identical-byte commit.
// A later keystroke must use the current selection instead of replacing the old preedit.
fn committed_replacement_range(
    explicit: Option<Range<usize>>,
    marked: &mut Option<Range<usize>>,
    selection: Range<usize>,
) -> Range<usize> {
    let composition = marked.take();
    explicit.or(composition).unwrap_or(selection)
}

// StyledText requires ordered, disjoint byte ranges. IME selection may intersect
// the preedit, so split at their boundaries and combine styles in the intersection.
fn input_highlights(
    text: &str,
    selection: Range<usize>,
    marked: Option<Range<usize>>,
    theme: Theme,
) -> Vec<(Range<usize>, HighlightStyle)> {
    let clamp = |range: Range<usize>| {
        let start = floor_boundary(text, range.start);
        let end = floor_boundary(text, range.end);
        start.min(end)..start.max(end)
    };
    let selection = clamp(selection);
    let marked = marked.map(clamp);
    let mut boundaries = vec![selection.start, selection.end];
    if let Some(range) = &marked {
        boundaries.extend([range.start, range.end]);
    }
    boundaries.sort_unstable();
    boundaries.dedup();
    boundaries
        .windows(2)
        .filter_map(|pair| {
            let range = pair[0]..pair[1];
            let selected = selection.start < range.end && selection.end > range.start;
            let composing = marked
                .as_ref()
                .is_some_and(|marked| marked.start < range.end && marked.end > range.start);
            if !selected && !composing {
                return None;
            }
            Some((
                range,
                HighlightStyle {
                    background_color: selected.then_some(theme.selected),
                    underline: composing.then_some(UnderlineStyle {
                        thickness: px(1.),
                        color: Some(theme.fresh),
                        wavy: false,
                    }),
                    ..Default::default()
                },
            ))
        })
        .collect()
}

fn utf16_to_byte(text: &str, offset: usize) -> usize {
    let mut units = 0;
    for (index, ch) in text.char_indices() {
        if units + ch.len_utf16() > offset {
            return index;
        }
        units += ch.len_utf16();
    }
    text.len()
}

// Native input services may ask for surrounding text independently of the
// accessible value and the painted bullets. Passwords must never leave this
// editor through that channel, including a stale caller-provided actual range.
fn platform_text_for_range(
    text: &str,
    secret: bool,
    range: Range<usize>,
    actual: &mut Option<Range<usize>>,
) -> Option<String> {
    *actual = None;
    if secret {
        return None;
    }
    let start = utf16_to_byte(text, range.start);
    let end = utf16_to_byte(text, range.end);
    let bytes = start.min(end)..start.max(end);
    *actual =
        Some(text[..bytes.start].encode_utf16().count()..text[..bytes.end].encode_utf16().count());
    Some(text[bytes].to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct EditorView {
        editor: Entity<TextInput>,
        visible: bool,
    }

    impl Render for EditorView {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            gpui::div()
                .size_full()
                .when(self.visible, |view| view.child(self.editor.clone()))
        }
    }

    #[gpui::test]
    fn authoritative_reset_retires_painted_text_before_a_hidden_editor_repaints(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) = cx.add_window_view(|_, cx| EditorView {
            editor: cx.new(|cx| {
                TextInput::new(
                    "retirement-notes",
                    "Note sintetiche",
                    "",
                    true,
                    Theme::for_dark(false),
                    cx,
                )
            }),
            visible: true,
        });
        let editor = view.read_with(cx, |view, _| view.editor.clone());
        cx.update_window_entity(&editor, |input, window, cx| {
            input.set_content("Nota sintetica iniziale", cx);
            input.select_all(&SelectAll, window, cx);
            input.replace_text_in_range(None, "Bozza sintetica modificata", window, cx);
            input.undo(&Undo, window, cx);
            assert_eq!(input.value(), "Nota sintetica iniziale");
            input.redo(&Redo, window, cx);
            assert_eq!(input.value(), "Bozza sintetica modificata");
            assert!(!input.undo.is_empty());
        });
        cx.update(|window, cx| {
            window.refresh();
            window.draw(cx).clear(cx);
        });
        editor.read_with(cx, |input, _| {
            assert_eq!(input.painted_content.as_ref(), "Bozza sintetica modificata");
            assert!(input.layout.is_some());
        });

        view.update(cx, |view, cx| {
            view.visible = false;
            view.editor.update(cx, |input, cx| {
                input.set_content("", cx);
                assert!(input.value().is_empty());
                assert!(input.painted_content.is_empty(), "a hidden editor must release its retired paint snapshot without waiting for another paint");
                assert!(input.layout.is_none());
                assert!(input.undo.is_empty());
                assert!(input.redo.is_empty());
            });
            cx.notify();
        });
    }

    #[test]
    fn caret_reveal_keeps_visible_lines_still_and_scrolls_large_lines_within_content() {
        assert_eq!(reveal_offset(-100., 500., 12., 244., 40., 68.), -100.);
        assert_eq!(reveal_offset(-100., 500., 12., 244., 230., 258.), -114.);
        assert_eq!(reveal_offset(-100., 500., 12., 244., -10., 18.), -78.);
        // The multiline line height at 400% is 112 points.
        assert_eq!(reveal_offset(-100., 500., 12., 244., 160., 272.), -128.);
        assert_eq!(reveal_offset(-490., 500., 12., 244., 260., 372.), -500.);
        assert_eq!(reveal_offset(0., 0., 12., 244., 300., 412.), 0.);
        // A line taller than the available viewport exposes its beginning.
        assert_eq!(reveal_offset(-100., 500., 12., 60., 80., 192.), -168.);
    }

    #[test]
    fn platform_offsets_preserve_italian_and_surrogate_boundaries() {
        let text = "È già qui 🩺\n";
        for byte in text.char_indices().map(|(i, _)| i).chain([text.len()]) {
            let utf16 = text[..byte].encode_utf16().count();
            assert_eq!(utf16_to_byte(text, utf16), byte);
        }
        let emoji = text.find('🩺').unwrap();
        let start = text[..emoji].encode_utf16().count();
        assert_eq!(utf16_to_byte(text, start + 1), emoji);
        assert_eq!(utf16_to_byte(text, usize::MAX), text.len());
    }

    #[test]
    fn malformed_offsets_never_slice_inside_a_character() {
        let text = "è🩺";
        for offset in 0..=10 {
            assert!(text.is_char_boundary(floor_boundary(text, offset)));
        }
    }

    #[test]
    fn password_caret_maps_display_bullets_to_unicode_input_without_exposing_text() {
        let value = "è🩺x";
        for byte in value.char_indices().map(|(i, _)| i).chain([value.len()]) {
            assert_eq!(unmasked_index(value, masked_index(value, byte)), byte);
        }
        assert_eq!(masked_index(value, value.len()), "•••".len());
    }

    #[test]
    fn native_surrounding_text_never_exports_passwords_or_stale_ranges() {
        let value = "è🩺x";
        for range in [0..0, 0..4, 1..2, 2..4, 4..usize::MAX] {
            let mut actual = Some(0..99);
            assert_eq!(
                platform_text_for_range(value, true, range, &mut actual),
                None
            );
            assert_eq!(actual, None);
        }
        let mut actual = None;
        assert_eq!(
            platform_text_for_range(value, false, 2..4, &mut actual),
            Some("🩺x".to_owned()),
        );
        assert_eq!(actual, Some(1..4));
    }

    #[test]
    fn committing_identical_preedit_leaves_the_next_character_after_it() {
        let mut text = String::from("è");
        let mut marked = Some(0..text.len());
        let selected = text.len()..text.len();
        let committed = committed_replacement_range(None, &mut marked, selected.clone());
        assert_eq!(&text[committed], "è");
        assert_eq!(marked, None, "even a no-op commit must finish composition");
        let next = committed_replacement_range(None, &mut marked, selected);
        text.replace_range(next, "x");
        assert_eq!(text, "èx");

        marked = Some(0..2);
        assert_eq!(
            committed_replacement_range(Some(2..3), &mut marked, 0..0),
            2..3
        );
        assert_eq!(marked, None, "an explicit replacement also commits preedit");
    }

    #[test]
    fn ime_highlights_are_disjoint_and_keep_both_styles_in_the_intersection() {
        let text = "Aé🙂Z";
        let runs = input_highlights(text, 3..7, Some(1..7), Theme::for_dark(false));
        assert_eq!(
            runs.iter()
                .map(|(range, _)| range.clone())
                .collect::<Vec<_>>(),
            [1..3, 3..7]
        );
        assert!(runs[0].1.background_color.is_none());
        assert!(runs[0].1.underline.is_some());
        assert!(runs[1].1.background_color.is_some());
        assert!(runs[1].1.underline.is_some());
        for pair in runs.windows(2) {
            assert!(pair[0].0.end <= pair[1].0.start);
        }
        for (range, _) in runs {
            assert!(text.is_char_boundary(range.start) && text.is_char_boundary(range.end));
        }
        let runs = input_highlights(text, 0..8, Some(1..7), Theme::for_dark(true));
        assert_eq!(
            runs.iter()
                .map(|(range, _)| range.clone())
                .collect::<Vec<_>>(),
            [0..1, 1..7, 7..8]
        );
        assert_eq!(
            runs.iter().map(|(range, _)| range.len()).sum::<usize>(),
            text.len()
        );
    }
}

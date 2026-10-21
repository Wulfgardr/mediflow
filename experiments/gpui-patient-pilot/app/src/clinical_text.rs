//! Conservative presentation of the existing clinical rich-text subset.
//! The archived string is never rewritten. Parsing is iterative and bounded;
//! unsupported or malformed markup stays visible as its original source.

use crate::components::{WritingInk, WritingStyle, WritingSurface};
use crate::theme::Theme;
use crate::theme::{TypeRole, TypeStyle};
use gpui::{
    AnyElement, FontStyle, FontWeight, HighlightStyle, Role, SharedString, StrikethroughStyle,
    StyledText, UnderlineStyle, div, prelude::*, px, text,
};
use std::ops::Range;

const MAX_DEPTH: usize = 128;
const MAX_BLOCKS: usize = 4096;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct InlineStyle {
    bold: bool,
    italic: bool,
    underline: bool,
    strike: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Run {
    text: String,
    style: InlineStyle,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct Block {
    runs: Vec<Run>,
    heading: Option<u8>,
    quote_depth: usize,
    list_depth: usize,
    marker: Option<String>,
}

impl Block {
    fn push(&mut self, character: char, style: InlineStyle) {
        if let Some(last) = self.runs.last_mut()
            && last.style == style
        {
            last.text.push(character);
        } else {
            self.runs.push(Run {
                text: character.to_string(),
                style,
            });
        }
    }

    fn last_character(&self) -> Option<char> {
        self.runs.last().and_then(|run| run.text.chars().last())
    }

    fn trim_end(&mut self) {
        while let Some(last) = self.runs.last_mut() {
            last.text.truncate(last.text.trim_end_matches(' ').len());
            if last.text.is_empty() {
                self.runs.pop();
            } else {
                break;
            }
        }
    }

    fn prefix(&self) -> String {
        let mut prefix = "> ".repeat(self.quote_depth);
        if self.list_depth > 0 {
            prefix.push_str(&"  ".repeat(self.list_depth - 1));
            if let Some(marker) = &self.marker {
                prefix.push_str(marker);
                prefix.push(' ');
            } else {
                prefix.push_str("  ");
            }
        }
        if let Some(level) = self.heading {
            prefix.push_str(&"#".repeat(level as usize));
            prefix.push(' ');
        }
        prefix
    }

    fn plain(&self, preserve_style: bool) -> String {
        let mut text = self.prefix();
        for run in &self.runs {
            let mut value = run.text.clone();
            if preserve_style {
                if run.style.bold {
                    value = format!("**{value}**");
                }
                if run.style.italic {
                    value = format!("_{value}_");
                }
                if run.style.underline {
                    value = format!("[sottolineato: {value}]");
                }
                if run.style.strike {
                    value = format!("[barrato: {value}]");
                }
            }
            text.push_str(&value);
        }
        text
    }

    fn styled(&self, theme: Theme) -> (String, Vec<(Range<usize>, HighlightStyle)>) {
        let mut text = String::new();
        let mut highlights = Vec::new();
        for run in &self.runs {
            let start = text.len();
            text.push_str(&run.text);
            if run.style != InlineStyle::default() {
                highlights.push((
                    start..text.len(),
                    HighlightStyle {
                        font_weight: run.style.bold.then_some(FontWeight::BOLD),
                        font_style: run.style.italic.then_some(FontStyle::Italic),
                        underline: run.style.underline.then_some(UnderlineStyle {
                            thickness: px(1.),
                            color: Some(theme.ink),
                            wavy: false,
                        }),
                        strikethrough: run.style.strike.then_some(StrikethroughStyle {
                            thickness: px(1.),
                            color: Some(theme.ink),
                        }),
                        ..Default::default()
                    },
                ));
            }
        }
        (text, highlights)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Tag {
    Paragraph,
    Division,
    Break,
    Bold,
    Italic,
    Underline,
    Strike,
    Heading(u8),
    Quote,
    Unordered,
    Ordered,
    Item,
}

impl Tag {
    fn from_name(name: &str) -> Option<Self> {
        Some(match name {
            "p" => Self::Paragraph,
            "div" => Self::Division,
            "br" => Self::Break,
            "b" | "strong" => Self::Bold,
            "i" | "em" => Self::Italic,
            "u" => Self::Underline,
            "s" | "strike" | "del" => Self::Strike,
            "h1" => Self::Heading(1),
            "h2" => Self::Heading(2),
            "h3" => Self::Heading(3),
            "blockquote" => Self::Quote,
            "ul" => Self::Unordered,
            "ol" => Self::Ordered,
            "li" => Self::Item,
            _ => return None,
        })
    }

    fn is_block(self) -> bool {
        matches!(
            self,
            Self::Paragraph
                | Self::Division
                | Self::Heading(_)
                | Self::Quote
                | Self::Unordered
                | Self::Ordered
                | Self::Item
        )
    }
}

struct Token<'a> {
    raw: &'a str,
    tag: Option<Tag>,
    closing: bool,
    self_closing: bool,
    malformed: bool,
}

/// Consume one possible tag. A stray '<' consumes only itself; an unfinished
/// tag consumes up to the next unquoted '<' or EOF, preventing quadratic scans.
fn token_at(source: &str) -> Token<'_> {
    let bytes = source.as_bytes();
    let mut index = 1;
    let closing = bytes.get(index) == Some(&b'/');
    if closing {
        index += 1;
    }
    let start = index;
    if !bytes.get(index).is_some_and(u8::is_ascii_alphabetic) {
        return Token {
            raw: &source[..1],
            tag: None,
            closing: false,
            self_closing: false,
            malformed: false,
        };
    }
    while bytes.get(index).is_some_and(u8::is_ascii_alphanumeric) {
        index += 1;
    }
    let tag = Tag::from_name(&source[start..index].to_ascii_lowercase());
    if bytes
        .get(index)
        .is_some_and(|byte| !byte.is_ascii_whitespace() && !matches!(byte, b'/' | b'>'))
    {
        return Token {
            raw: &source[..1],
            tag: None,
            closing: false,
            self_closing: false,
            malformed: false,
        };
    }
    let mut quote = None;
    while index < bytes.len() {
        let byte = bytes[index];
        if let Some(delimiter) = quote {
            if byte == delimiter {
                quote = None;
            }
        } else if matches!(byte, b'\'' | b'"') {
            quote = Some(byte);
        } else if byte == b'>' {
            let raw = &source[..=index];
            return Token {
                raw,
                tag,
                closing,
                self_closing: source[..index].trim_end().ends_with('/'),
                malformed: false,
            };
        } else if byte == b'<' {
            return Token {
                raw: &source[..index],
                tag,
                closing,
                self_closing: false,
                malformed: true,
            };
        }
        index += 1;
    }
    Token {
        raw: source,
        tag,
        closing,
        self_closing: false,
        malformed: true,
    }
}

/// Decode exactly once. Unsupported entities stay literal and make the rich
/// interpretation fail closed, rather than silently changing a clinical value.
fn entities(source: &str) -> Result<String, ()> {
    let mut output = String::with_capacity(source.len());
    let mut rest = source;
    while let Some(start) = rest.find('&') {
        output.push_str(&rest[..start]);
        rest = &rest[start + 1..];
        let end = rest.bytes().take(32).position(|byte| byte == b';');
        let Some(end) = end else {
            output.push('&');
            continue;
        };
        let entity = &rest[..end];
        if entity
            .chars()
            .any(|character| character.is_whitespace() || character == '&')
        {
            output.push('&');
            continue;
        }
        let decoded = match entity {
            "nbsp" => ' ',
            "amp" => '&',
            "lt" => '<',
            "gt" => '>',
            "quot" => '"',
            "apos" | "#39" => '\'',
            _ => {
                let number = entity
                    .strip_prefix("#x")
                    .or_else(|| entity.strip_prefix("#X"))
                    .and_then(|value| u32::from_str_radix(value, 16).ok())
                    .or_else(|| {
                        entity
                            .strip_prefix('#')
                            .and_then(|value| value.parse().ok())
                    });
                number.and_then(char::from_u32).ok_or(())?
            }
        };
        output.push(decoded);
        rest = &rest[end + 1..];
    }
    output.push_str(rest);
    Ok(output)
}

struct List {
    ordered: bool,
    next: u32,
    number: u32,
    in_item: bool,
    pending_marker: bool,
}

#[derive(Debug)]
struct Document {
    blocks: Vec<Block>,
    unsupported: bool,
}

impl Document {
    fn literal(source: &str, unsupported: bool) -> Self {
        Self {
            blocks: vec![Block {
                runs: vec![Run {
                    text: source.trim().to_owned(),
                    style: InlineStyle::default(),
                }],
                ..Default::default()
            }],
            unsupported,
        }
    }

    fn plain(&self, preserve_style: bool) -> String {
        let content = self
            .blocks
            .iter()
            .map(|block| block.plain(preserve_style))
            .collect::<Vec<_>>()
            .join("\n");
        if self.unsupported && preserve_style {
            format!("[Formattazione non supportata: testo originale]\n{content}")
        } else {
            content
        }
    }
}

struct Parser {
    blocks: Vec<Block>,
    current: Option<Block>,
    stack: Vec<Tag>,
    lists: Vec<List>,
    markup: bool,
    unsupported: bool,
}

impl Parser {
    fn new() -> Self {
        Self {
            blocks: Vec::new(),
            current: None,
            stack: Vec::new(),
            lists: Vec::new(),
            markup: false,
            unsupported: false,
        }
    }

    fn style(&self) -> InlineStyle {
        InlineStyle {
            bold: self.stack.contains(&Tag::Bold),
            italic: self.stack.contains(&Tag::Italic),
            underline: self.stack.contains(&Tag::Underline),
            strike: self.stack.contains(&Tag::Strike),
        }
    }

    fn block(&mut self) -> &mut Block {
        if self.current.is_none() {
            let mut block = Block {
                heading: self.stack.iter().rev().find_map(|tag| {
                    if let Tag::Heading(level) = tag {
                        Some(*level)
                    } else {
                        None
                    }
                }),
                quote_depth: self.stack.iter().filter(|tag| **tag == Tag::Quote).count(),
                ..Default::default()
            };
            let depth = self.lists.len();
            if let Some(list) = self.lists.last_mut()
                && list.in_item
            {
                block.list_depth = depth;
                if list.pending_marker {
                    block.marker = Some(if list.ordered {
                        format!("{}.", list.number)
                    } else {
                        "•".into()
                    });
                    list.pending_marker = false;
                }
            }
            self.current = Some(block);
        }
        self.current.as_mut().expect("initialized block")
    }

    fn text(&mut self, source: &str) {
        let Ok(value) = entities(source) else {
            self.unsupported = true;
            return;
        };
        let style = self.style();
        for character in value.chars() {
            if matches!(character, ' ' | '\t' | '\n' | '\r' | '\u{000c}') {
                if self
                    .current
                    .as_ref()
                    .and_then(Block::last_character)
                    .is_some_and(|last| last != ' ' && last != '\n')
                {
                    self.block().push(' ', style);
                }
            } else {
                self.block().push(character, style);
            }
        }
    }

    fn flush(&mut self) {
        if let Some(mut block) = self.current.take() {
            block.trim_end();
            if !block.runs.is_empty() {
                self.blocks.push(block);
            }
        }
        if self.blocks.len() > MAX_BLOCKS {
            self.unsupported = true;
        }
    }

    fn tag(&mut self, token: &Token<'_>) {
        let Some(tag) = token.tag else {
            self.unsupported = true;
            return;
        };
        self.markup = true;
        if token.malformed || token.self_closing && tag != Tag::Break {
            self.unsupported = true;
            return;
        }
        if tag == Tag::Break {
            if token.closing {
                self.unsupported = true;
                return;
            }
            let style = self.style();
            self.block().trim_end();
            self.block().push('\n', style);
            return;
        }
        if token.closing {
            if self.stack.last() != Some(&tag) {
                self.unsupported = true;
                return;
            }
            if tag.is_block() {
                self.flush();
            }
            self.stack.pop();
            match tag {
                Tag::Ordered | Tag::Unordered => {
                    self.lists.pop();
                }
                Tag::Item => {
                    if let Some(list) = self.lists.last_mut() {
                        list.in_item = false;
                    }
                }
                _ => {}
            }
        } else {
            if self.stack.len() >= MAX_DEPTH {
                self.unsupported = true;
                return;
            }
            if tag.is_block() {
                self.flush();
            }
            match tag {
                Tag::Ordered | Tag::Unordered => self.lists.push(List {
                    ordered: tag == Tag::Ordered,
                    next: 1,
                    number: 0,
                    in_item: false,
                    pending_marker: false,
                }),
                Tag::Item => {
                    let Some(list) = self.lists.last_mut() else {
                        self.unsupported = true;
                        return;
                    };
                    if list.in_item {
                        self.unsupported = true;
                        return;
                    }
                    list.in_item = true;
                    list.pending_marker = true;
                    list.number = list.next;
                    let Some(next) = list.next.checked_add(1) else {
                        self.unsupported = true;
                        return;
                    };
                    list.next = next;
                }
                _ => {}
            }
            self.stack.push(tag);
        }
    }
}

fn parse(source: &str) -> Document {
    let mut parser = Parser::new();
    let mut rest = source;
    while let Some(start) = rest.find('<') {
        parser.text(&rest[..start]);
        rest = &rest[start..];
        let token = token_at(rest);
        if token.raw.len() == 1 {
            parser.text(token.raw);
        } else {
            parser.tag(&token);
        }
        rest = &rest[token.raw.len()..];
        // Once markup is known to be unsupported, retaining the original is
        // both more faithful and cheaper than attempting error recovery.
        if parser.markup && parser.unsupported {
            return Document::literal(source, true);
        }
    }
    parser.text(rest);
    parser.flush();
    if !parser.markup {
        return Document::literal(source, false);
    }
    if parser.unsupported || !parser.stack.is_empty() {
        return Document::literal(source, true);
    }
    Document {
        blocks: parser.blocks,
        unsupported: false,
    }
}

/// Copy preserves list hierarchy and marks emphasis, underlining and crossed-out
/// text explicitly. It must not turn a crossed-out prescription into plain prose.
pub fn plain_text(source: &str) -> String {
    parse(source).plain(true)
}

/// Search can match words across style boundaries without interpreting the
/// formatting markers used by the accessible/copy representation as clinical text.
pub fn searchable_text(source: &str) -> String {
    parse(source).plain(false)
}

pub fn render(source: &str, ink: WritingInk, theme: Theme) -> AnyElement {
    let document = parse(source);
    let mut content_theme = theme;
    content_theme.ink = ink.color(WritingSurface::Plane, theme);
    div().min_w_0().flex().flex_col().gap(px(10. * theme.scale))
        .when(document.unsupported, |element| element.child(
            div().text_color(theme.secondary).type_role(theme, TypeRole::Meta)
                .child(text!("Formattazione non supportata: è mostrato il testo originale. Apri l'editor corrente per verificarla.")),
        ))
        .children(document.blocks.into_iter().enumerate().map(|(index, block)| {
            let accessible = block.plain(true);
            let (content, highlights) = block.styled(content_theme);
            let heading = block.heading;
            let marker = block.marker.clone();
            div().id(("clinical-rich-block", index)).role(Role::Paragraph).aria_label(SharedString::from(accessible))
                .min_w_0().flex().items_start().gap(px(8. * theme.scale))
                .pl(px((block.list_depth.saturating_sub(1) as f32 * 18.).min(36.)))
                .when(block.quote_depth > 0, |element| element
                    .border_l_2().border_color(theme.rule).pl(px(14.)))
                .when(block.list_depth > 0, |element| element.child(
                    div().min_w(px(22. * theme.scale)).flex_shrink_0()
                        .text_color(theme.secondary).child(text!(marker.unwrap_or_default())),
                ))
                .child(block_text(content, highlights, heading.is_some(), ink, theme))
        }))
        .into_any_element()
}

fn block_text(
    content: String,
    highlights: Vec<(Range<usize>, HighlightStyle)>,
    heading: bool,
    ink: WritingInk,
    theme: Theme,
) -> gpui::Div {
    div()
        .flex_1()
        .min_w_0()
        .type_role(
            theme,
            if heading {
                TypeRole::Strong
            } else {
                TypeRole::Prose
            },
        )
        .writing_ink(ink, WritingSurface::Plane, theme)
        .child(StyledText::new(SharedString::from(content)).with_highlights(highlights))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_inks_keep_prose_and_only_pencil_has_a_dashed_underline() {
        use gpui::{BorderStyle, Length, rgb};
        for (dark, pencil, fresh, dry) in [
            (false, 0x5f6878, 0x2346b0, 0x14161a),
            (true, 0x9aa3b0, 0x9db4ff, 0xe9ecef),
        ] {
            for scale in [1., 2.] {
                let theme = Theme::for_dark(dark).sized(scale, false);
                for (ink, expected) in [
                    (WritingInk::Pencil, pencil),
                    (WritingInk::Fresh, fresh),
                    (WritingInk::Dry, dry),
                ] {
                    let mut content =
                        block_text("Prosa sintetica".into(), vec![], false, ink, theme);
                    let text = content.text_style();
                    assert_eq!(
                        text.color,
                        Some(rgb(expected).into()),
                        "{ink:?}, dark={dark}"
                    );
                    assert_eq!(text.font_family.as_deref(), Some("Newsreader"));
                    assert_eq!(text.font_size, Some(px(17. * scale).into()));
                    assert_eq!(text.font_weight, Some(FontWeight::NORMAL));
                    let style = content.style();
                    if ink == WritingInk::Pencil {
                        assert_eq!(style.size.width, Some(Length::Auto));
                        assert_eq!(style.flex_grow, Some(0.));
                        assert_eq!(style.flex_shrink, Some(0.));
                        assert_eq!(style.flex_basis, Some(Length::Auto));
                        assert_eq!(style.max_size.width, Some(gpui::relative(1.).into()));
                        assert_eq!(style.border_style, Some(BorderStyle::Dashed));
                        assert_eq!(style.border_widths.bottom, Some(px(1.).into()));
                        assert_eq!(style.border_color, Some(rgb(expected).into()));
                        assert_eq!(style.padding.bottom, Some(px(4.).into()));
                    } else {
                        assert_eq!(style.border_style, None);
                        assert_eq!(style.border_widths.bottom, None);
                        assert_eq!(style.padding.bottom, None);
                    }
                }
            }
        }
    }

    #[test]
    fn nested_lists_and_blocks_keep_boundaries_numbering_and_continuations() {
        let source = "<p>Contesto di prova</p><ol><li>Prima<ul><li>Riga annidata</li><li>Seconda annidata</li></ul>Continuazione</li><li><p>Seconda</p><p>Altro paragrafo</p></li></ol><p>Fine</p>";
        assert_eq!(
            plain_text(source),
            "Contesto di prova\n1. Prima\n  • Riga annidata\n  • Seconda annidata\n  Continuazione\n2. Seconda\n  Altro paragrafo\nFine"
        );
        let document = parse(source);
        assert!(!document.unsupported);
        assert_eq!(document.blocks[2].list_depth, 2);
        assert_eq!(document.blocks[4].marker, None);
    }

    #[test]
    fn overlapping_emphasis_stays_disjoint_and_crossed_out_text_is_explicit_in_copy() {
        let source = "<p><s>Farmaco <strong>A 🩺</strong></s> poi <u><em>B</em></u>.</p>";
        let document = parse(source);
        assert!(!document.unsupported);
        let block = &document.blocks[0];
        assert!(block.runs[0].style.strike);
        assert!(block.runs[1].style.bold && block.runs[1].style.strike);
        assert!(plain_text(source).contains("[barrato: **A 🩺**]"));
        assert!(plain_text(source).contains("[sottolineato: _B_]"));
        assert_eq!(searchable_text(source), "Farmaco A 🩺 poi B.");
        let (text, ranges) = block.styled(Theme::for_dark(false));
        let mut previous_end = 0;
        for (range, _) in ranges {
            assert!(range.start >= previous_end && range.end <= text.len());
            assert!(text.is_char_boundary(range.start) && text.is_char_boundary(range.end));
            previous_end = range.end;
        }
    }

    #[test]
    fn html_entities_decode_once_and_clinical_comparisons_remain_literal() {
        assert_eq!(
            plain_text("<p>Citt&#224; &#x1FA7A; e &amp;lt;5<br>PCR &lt;5; 4 < x > 2</p>"),
            "Città 🩺 e &lt;5\nPCR <5; 4 < x > 2"
        );
        assert_eq!(
            plain_text("PCR <5; 4 < x > 2; &amp; è testo semplice"),
            "PCR <5; 4 < x > 2; &amp; è testo semplice"
        );
        assert_eq!(plain_text("<p>Prima</p><p>Seconda</p>"), "Prima\nSeconda");
    }

    #[test]
    fn malformed_or_unsupported_rich_content_is_retained_with_an_explicit_label() {
        for source in [
            "<p>Nota <table><tr><td>A</td></tr></table></p>",
            "<p><s>Farmaco A</p>",
            "<p>&#xD800;</p>",
            "<p>&unknown;</p>",
            "<p>A<script>invisibile</script>B</p>",
            "<p>Nota<strong title='unterminated",
        ] {
            let document = parse(source);
            assert!(document.unsupported, "{source}");
            assert_eq!(document.blocks[0].runs[0].text, source);
            assert!(plain_text(source).ends_with(source));
        }
    }

    #[test]
    fn headings_quotes_aliases_and_depth_exhaustion_do_not_drop_original_content() {
        assert_eq!(
            plain_text(
                "<blockquote><h2>Titolo</h2><div>Una <b>nota</b> con <strike>testo</strike>.</div></blockquote>"
            ),
            "> ## Titolo\n> Una **nota** con [barrato: testo]."
        );
        let deep = format!(
            "{}valore{}",
            "<p>".repeat(MAX_DEPTH + 1),
            "</p>".repeat(MAX_DEPTH + 1)
        );
        assert!(parse(&deep).unsupported);
        assert!(plain_text(&deep).ends_with(&deep));
    }
}

use hayro::hayro_interpret::{InterpreterSettings, font::FontQuery};
use hayro::hayro_syntax::{
    Pdf,
    content::{TypedIter, UntypedIter},
    object::{Dict, MaybeRef, Name, Object, Stream},
};
use mediflow_runtime_client::RequestContext;
use serde_json::json;
use std::{
    io::{Read, Write},
    process::{Child, Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use zeroize::Zeroizing;

const MAX_PAGES: usize = 500;
const MAX_POINTS: f32 = 14_400.;
const MAX_CANVAS_DIMENSION: u32 = 2048;
const MAX_CANVAS_PIXELS: u32 = 4_000_000;
const MAX_STREAM_BYTES: usize = 48 * 1024 * 1024;
const MAX_NODES: usize = 500_000;
const MAX_OPERATORS: usize = 50_000;
const MAX_OUTPUT: usize = MAX_CANVAS_PIXELS as usize * 4 + 512;
const TIMEOUT: Duration = Duration::from_secs(15);
const RASTER_TIMEOUT: Duration = Duration::from_secs(10);
pub const VIEW_LIFETIME: Duration = Duration::from_secs(600);
const MAX_PAGE_IMAGE_PIXELS: u64 = 24_000_000;
const MAX_SCRATCH_PIXELS: u64 = 12_000_000;
const MAX_SCRATCH_CANVASES: usize = 64;
const MAX_DEPTH: usize = 32;

pub struct Preview {
    pub source: Arc<Zeroizing<Vec<u8>>>,
    pub image: Arc<gpui::RenderImage>,
    pub pages: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    Invalid,
    Limit,
    Unsupported,
    Cancelled,
    Timeout,
    Engine,
}
impl Error {
    pub fn message(self) -> String {
        match self {
            Self::Limit => "Il PDF supera i limiti dell’anteprima. Nessuna pagina incompleta viene mostrata.",
            Self::Unsupported => "Il PDF contiene elementi non supportati da questa anteprima. Salva una copia e aprila con il tuo lettore PDF.",
            Self::Cancelled => "Anteprima chiusa. Il documento non è stato modificato.",
            Self::Timeout => "L’anteprima PDF non è pronta entro il tempo disponibile. Nessuna pagina incompleta viene mostrata.",
            Self::Engine => "Il lettore PDF locale non è disponibile. Nessuna pagina incompleta viene mostrata.",
            Self::Invalid => "Il PDF non è leggibile o è danneggiato. Nessuna pagina incompleta viene mostrata.",
        }.into()
    }
    fn code(self) -> &'static str {
        match self {
            Self::Invalid => "invalid",
            Self::Limit => "limit",
            Self::Unsupported => "unsupported",
            Self::Cancelled => "cancelled",
            Self::Timeout => "timeout",
            Self::Engine => "engine",
        }
    }
    fn from_code(code: &str) -> Self {
        match code {
            "invalid" => Self::Invalid,
            "limit" => Self::Limit,
            "unsupported" => Self::Unsupported,
            "cancelled" => Self::Cancelled,
            "timeout" => Self::Timeout,
            _ => Self::Engine,
        }
    }
}

struct OwnedChild(Child);
impl Drop for OwnedChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

pub fn render(
    source: Arc<Zeroizing<Vec<u8>>>,
    page: usize,
    context: &RequestContext,
) -> Result<Preview, Error> {
    if source.len() > super::MAX_DOCUMENT_BYTES
        || !source.starts_with(b"%PDF-")
        || page == 0
        || page > MAX_PAGES
    {
        return Err(Error::Invalid);
    }
    context.check().map_err(|_| Error::Cancelled)?;
    let executable = std::env::current_exe().map_err(|_| Error::Engine)?;
    let child = OwnedChild(
        Command::new(executable)
            .arg("--document-preview-worker")
            .arg(page.to_string())
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| Error::Engine)?,
    );
    collect_child(child, source, page, context, TIMEOUT)
}

fn collect_child(
    mut child: OwnedChild,
    source: Arc<Zeroizing<Vec<u8>>>,
    page: usize,
    context: &RequestContext,
    timeout: Duration,
) -> Result<Preview, Error> {
    let mut input = child.0.stdin.take().ok_or(Error::Engine)?;
    let output = child.0.stdout.take().ok_or(Error::Engine)?;
    let bytes = source.clone();
    let writer = std::thread::spawn(move || input.write_all(bytes.as_slice()));
    let reader = std::thread::spawn(move || {
        let mut bytes = Zeroizing::new(Vec::new());
        output
            .take(MAX_OUTPUT as u64 + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        if context.check().is_err() {
            return Err(Error::Cancelled);
        }
        if Instant::now() >= deadline {
            return Err(Error::Timeout);
        }
        if let Some(status) = child.0.try_wait().map_err(|_| Error::Engine)? {
            break status;
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    if status.code() == Some(3) {
        return Err(Error::Timeout);
    }
    if !status.success() || writer.join().map_err(|_| Error::Engine)?.is_err() {
        return Err(Error::Engine);
    }
    let output = reader
        .join()
        .map_err(|_| Error::Engine)?
        .map_err(|_| Error::Engine)?;
    context.check().map_err(|_| Error::Cancelled)?;
    parse_output(source, page, &output)
}

fn parse_output(
    source: Arc<Zeroizing<Vec<u8>>>,
    page: usize,
    output: &[u8],
) -> Result<Preview, Error> {
    if output.len() > MAX_OUTPUT {
        return Err(Error::Limit);
    }
    let at = output
        .iter()
        .take(512)
        .position(|byte| *byte == b'\n')
        .ok_or(Error::Engine)?;
    let header: serde_json::Value =
        serde_json::from_slice(&output[..at]).map_err(|_| Error::Engine)?;
    if let Some(error) = header["error"].as_str() {
        return Err(Error::from_code(error));
    }
    let number = |key| {
        header[key]
            .as_u64()
            .and_then(|n| usize::try_from(n).ok())
            .ok_or(Error::Engine)
    };
    let width = number("width")?;
    let height = number("height")?;
    let pages = number("pages")?;
    if number("page")? != page
        || pages == 0
        || pages > MAX_PAGES
        || page > pages
        || width == 0
        || height == 0
        || width > MAX_CANVAS_DIMENSION as usize
        || height > MAX_CANVAS_DIMENSION as usize
        || width * height > MAX_CANVAS_PIXELS as usize
        || output.len() - at - 1 != width * height * 4
    {
        return Err(Error::Engine);
    }
    let pixels = image::RgbaImage::from_raw(width as u32, height as u32, output[at + 1..].to_vec())
        .ok_or(Error::Engine)?;
    Ok(Preview {
        source,
        image: Arc::new(gpui::RenderImage::new([image::Frame::new(pixels)])),
        pages,
    })
}

pub fn worker(page: usize) -> Result<(), std::io::Error> {
    let mut source = Zeroizing::new(Vec::new());
    std::io::stdin()
        .take(super::MAX_DOCUMENT_BYTES as u64 + 1)
        .read_to_end(&mut source)?;
    let result = raster(&source, page);
    let mut output = std::io::stdout().lock();
    match result {
        Ok((pixels, pages)) => {
            writeln!(
                output,
                "{}",
                json!({"width":pixels.width(),"height":pixels.height(),"pages":pages,"page":page})
            )?;
            output.write_all(pixels.as_raw())
        }
        Err(error) => writeln!(output, "{}", json!({"error":error.code()})),
    }
}

fn canvas(width: f32, height: f32) -> Result<(u32, u32), Error> {
    if !width.is_finite()
        || !height.is_finite()
        || width <= 0.
        || height <= 0.
        || width > MAX_POINTS
        || height > MAX_POINTS
    {
        return Err(Error::Limit);
    }
    let scale = 1.5f64
        .min(f64::from(MAX_CANVAS_DIMENSION) / f64::from(width))
        .min(f64::from(MAX_CANVAS_DIMENSION) / f64::from(height))
        .min((f64::from(MAX_CANVAS_PIXELS) / f64::from(width) / f64::from(height)).sqrt());
    Ok((
        ((f64::from(width) * scale).floor() as u32).max(1),
        ((f64::from(height) * scale).floor() as u32).max(1),
    ))
}

fn name(dict: &Dict<'_>, key: &[u8]) -> Option<Vec<u8>> {
    dict.get::<Name<'_>>(key).map(|n| n.as_ref().to_vec())
}

struct Budget {
    nodes: usize,
    bytes: usize,
}
impl Budget {
    fn object(&mut self, value: &Object<'_>, depth: usize) -> Result<(), Error> {
        self.nodes += 1;
        if self.nodes > MAX_NODES || depth > MAX_DEPTH {
            return Err(Error::Limit);
        }
        match value {
            Object::Dict(dict) => {
                if name(dict, b"Subtype").as_deref() == Some(b"Type3")
                    || dict.contains_key(b"Annots")
                    || dict.contains_key(b"PatternType")
                    || dict.contains_key(b"Mask")
                    || (dict.contains_key(b"UserUnit") && dict.get::<f32>(b"UserUnit") != Some(1.))
                    || dict
                        .get::<Object<'_>>(b"SMask")
                        .is_some_and(|o| !matches!(o, Object::Name(n) if n.as_ref() == b"None"))
                    || dict.contains_key(b"Encrypt")
                    || dict.contains_key(b"XFA")
                    || dict.get::<bool>(b"K") == Some(true)
                {
                    return Err(Error::Unsupported);
                }
                for (_, value) in dict.entries() {
                    if let MaybeRef::NotRef(value) = value {
                        self.object(&value, depth + 1)?;
                    }
                }
            }
            Object::Array(array) => {
                for value in array.raw_iter() {
                    if let MaybeRef::NotRef(value) = value {
                        self.object(&value, depth + 1)?;
                    }
                }
            }
            Object::Stream(stream) => {
                self.object(&Object::Dict(stream.dict().clone()), depth + 1)?
            }
            Object::Number(number) if !(number.as_f64() as f32).is_finite() => {
                return Err(Error::Invalid);
            }
            Object::String(text) => self.bytes += text.as_ref().len() * 2,
            Object::Name(text) => self.bytes += text.as_ref().len() * 2,
            _ => {}
        }
        if self.bytes > MAX_STREAM_BYTES {
            return Err(Error::Limit);
        }
        Ok(())
    }
}

fn filter_name(stream: &Stream<'_>) -> Result<Option<Vec<u8>>, Error> {
    let dict = stream.dict();
    let value = name(dict, b"Filter").or_else(|| name(dict, b"F"));
    if value.is_none() && (dict.contains_key(b"Filter") || dict.contains_key(b"F")) {
        return Err(Error::Unsupported);
    }
    Ok(value)
}

fn stream_data(stream: &Stream<'_>, maximum: usize) -> Result<Vec<u8>, Error> {
    let filter = filter_name(stream)?;
    let bytes = stream.raw_data();
    if filter.is_none() {
        if bytes.len() > maximum {
            return Err(Error::Limit);
        }
        Ok(bytes.into_owned())
    } else if matches!(filter.as_deref(), Some(b"FlateDecode" | b"Fl")) {
        miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(&bytes, maximum)
            .map_err(|_| Error::Limit)
    } else {
        Err(Error::Unsupported)
    }
}

fn image_stream(stream: &Stream<'_>) -> Result<(), Error> {
    let dict = stream.dict();
    let width = dict
        .get::<u32>(b"Width")
        .or_else(|| dict.get(b"W"))
        .ok_or(Error::Invalid)?;
    let height = dict
        .get::<u32>(b"Height")
        .or_else(|| dict.get(b"H"))
        .ok_or(Error::Invalid)?;
    super::admit_preview_dimensions(width, height).map_err(|_| Error::Limit)?;
    let filter = filter_name(stream)?;
    if matches!(filter.as_deref(), Some(b"DCTDecode" | b"DCT")) {
        let bytes = stream.raw_data();
        let reader = image::ImageReader::with_format(
            std::io::Cursor::new(bytes.as_ref()),
            image::ImageFormat::Jpeg,
        );
        let actual = reader.into_dimensions().map_err(|_| Error::Invalid)?;
        super::admit_preview_dimensions(actual.0, actual.1).map_err(|_| Error::Limit)?;
        if actual != (width, height) {
            return Err(Error::Invalid);
        }
        let mut reader = image::ImageReader::with_format(
            std::io::Cursor::new(bytes.as_ref()),
            image::ImageFormat::Jpeg,
        );
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(super::MAX_PREVIEW_DIMENSION);
        limits.max_image_height = Some(super::MAX_PREVIEW_DIMENSION);
        limits.max_alloc = Some(super::MAX_PREVIEW_PIXELS * 8);
        reader.limits(limits);
        reader.decode().map_err(|_| Error::Invalid)?;
        return Ok(());
    }
    let mask = dict
        .get::<bool>(b"ImageMask")
        .or_else(|| dict.get(b"IM"))
        .unwrap_or(false);
    let color = name(dict, b"ColorSpace").or_else(|| name(dict, b"CS"));
    let channels = match color.as_deref() {
        Some(b"DeviceGray" | b"G") => 1,
        Some(b"DeviceRGB" | b"RGB") => 3,
        Some(b"DeviceCMYK" | b"CMYK") => 4,
        None if mask => 1,
        _ => return Err(Error::Unsupported),
    };
    let bits = dict
        .get::<u32>(b"BitsPerComponent")
        .or_else(|| dict.get(b"BPC"))
        .unwrap_or(if mask { 1 } else { 8 });
    if ![1, 2, 4, 8, 16].contains(&bits) {
        return Err(Error::Unsupported);
    }
    let row = (width as usize * channels * bits as usize).div_ceil(8);
    for key in [b"DecodeParms".as_slice(), b"DP"] {
        if dict
            .get::<Object<'_>>(key)
            .is_some_and(|v| !matches!(v, Object::Dict(_) | Object::Null(_)))
        {
            return Err(Error::Unsupported);
        }
    }
    let params = dict
        .get::<Dict<'_>>(b"DecodeParms")
        .or_else(|| dict.get(b"DP"));
    let predictor = params
        .as_ref()
        .and_then(|p| p.get::<u32>(b"Predictor"))
        .unwrap_or(1);
    if let Some(params) = &params {
        for (key, expected) in [
            (b"Columns".as_slice(), width),
            (b"Colors", channels as u32),
            (b"BitsPerComponent", bits),
        ] {
            let default = if key == b"BitsPerComponent" { 8 } else { 1 };
            if params.get::<u32>(key).is_some_and(|n| n != expected)
                || (predictor != 1 && params.get::<u32>(key).unwrap_or(default) != expected)
            {
                return Err(Error::Invalid);
            }
        }
    }
    if predictor != 1 && !(10..=15).contains(&predictor) {
        return Err(Error::Unsupported);
    }
    let expected = (row + usize::from(predictor != 1)) * height as usize;
    if expected > MAX_STREAM_BYTES {
        return Err(Error::Limit);
    }
    let data = stream_data(stream, expected)?;
    if data.len() != expected {
        return Err(Error::Invalid);
    }
    if predictor != 1 && data.chunks_exact(row + 1).any(|row| row[0] > 4) {
        return Err(Error::Invalid);
    }
    Ok(())
}

fn content(
    data: &[u8],
    budget: &mut Budget,
    resolve: impl Fn(&[u8], &Name<'_>) -> bool,
) -> Result<(), Error> {
    if data.len() > MAX_STREAM_BYTES {
        return Err(Error::Limit);
    }
    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(|_| Error::Engine)?;
    let sentinel = format!(
        "MediFlowEnd{}",
        random
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    );
    let mut checked = data.to_vec();
    checked.extend_from_slice(format!("\n/{sentinel} MP\n").as_bytes());
    let mut iter = UntypedIter::new(&checked);
    let mut count = 0;
    let mut ended = false;
    while let Some(instruction) = iter.next() {
        count += 1;
        if count > MAX_OPERATORS + 1 {
            return Err(Error::Limit);
        }
        let mut end_name = false;
        let category = match instruction.operator.as_ref() {
            b"Do" => Some(b"XObject".as_slice()),
            b"Tf" => Some(b"Font".as_slice()),
            b"gs" => Some(b"ExtGState".as_slice()),
            b"sh" => Some(b"Shading".as_slice()),
            b"CS" | b"cs" => Some(b"ColorSpace".as_slice()),
            _ => None,
        };
        let mut resolved = category.is_none();
        for operand in instruction.operands() {
            budget.object(operand, 0)?;
            if let Object::Stream(stream) = operand {
                image_stream(stream)?;
            }
            if let Object::Name(name) = operand {
                end_name = name.as_ref() == sentinel.as_bytes();
                if let Some(category) = category {
                    resolved = (category == b"ColorSpace"
                        && matches!(name.as_ref(), b"DeviceGray" | b"DeviceRGB" | b"DeviceCMYK"))
                        || resolve(category, name);
                }
            }
        }
        if !resolved {
            return Err(Error::Invalid);
        }
        ended = instruction.operator.as_ref() == b"MP" && end_name;
    }
    if !ended {
        return Err(Error::Invalid);
    }
    let mut typed = TypedIter::new(&checked);
    let mut typed_count = 0;
    while typed.next().is_some() {
        typed_count += 1;
    }
    if typed_count != count {
        return Err(Error::Invalid);
    }
    Ok(())
}

fn reject_encryption(source: &[u8]) -> Result<(), Error> {
    let mut at = 0;
    while at < source.len() {
        if source[at] != b'/' {
            at += 1;
            continue;
        }
        at += 1;
        let mut name = Vec::new();
        while at < source.len()
            && !source[at].is_ascii_whitespace()
            && !b"/[]<>()%".contains(&source[at])
        {
            if source[at] == b'#' && at + 2 < source.len() {
                let hex = |byte: u8| (byte as char).to_digit(16);
                if let (Some(a), Some(b)) = (hex(source[at + 1]), hex(source[at + 2])) {
                    name.push((a * 16 + b) as u8);
                    at += 3;
                    continue;
                }
            }
            name.push(source[at]);
            at += 1;
        }
        if name == b"Encrypt" {
            return Err(Error::Unsupported);
        }
    }
    Ok(())
}

struct Probe {
    pixels: u64,
    calls: usize,
    groups: usize,
    clips: usize,
    canvas: u64,
    failed: bool,
}
impl Probe {
    fn count(&mut self) {
        self.calls += 1;
        self.failed |= self.calls > MAX_OPERATORS;
    }
    fn scratch(&mut self) {
        let count = self.groups + self.clips;
        self.failed |=
            count > MAX_SCRATCH_CANVASES || count as u64 * self.canvas > MAX_SCRATCH_PIXELS;
    }
}
impl<'a> hayro::hayro_interpret::Device<'a> for Probe {
    fn draw_path(
        &mut self,
        _: &hayro::kurbo::BezPath,
        _: hayro::hayro_interpret::DrawProps<'a>,
        _: &hayro::hayro_interpret::DrawMode,
    ) {
        self.count();
    }
    fn push_clip_path(&mut self, _: &hayro::hayro_interpret::ClipPath) {
        self.count();
        self.clips += 1;
        self.scratch();
    }
    fn push_transparency_group(
        &mut self,
        _: f32,
        mask: Option<hayro::hayro_interpret::SoftMask<'a>>,
        _: hayro::hayro_interpret::BlendMode,
    ) {
        self.count();
        self.groups += 1;
        self.failed |= mask.is_some();
        self.scratch();
    }
    fn draw_glyph_run(
        &mut self,
        _: &hayro::hayro_interpret::font::GlyphRun<'_, 'a>,
        _: hayro::hayro_interpret::DrawProps<'a>,
        _: &hayro::hayro_interpret::DrawMode,
    ) {
        self.count();
    }
    fn draw_image(
        &mut self,
        image: hayro::hayro_interpret::Image<'a, '_>,
        props: hayro::hayro_interpret::ImageDrawProps<'a>,
    ) {
        self.count();
        self.pixels += u64::from(image.width()) * u64::from(image.height());
        self.failed |= self.pixels > MAX_PAGE_IMAGE_PIXELS || props.soft_mask.is_some();
    }
    fn pop_clip(&mut self) {
        self.clips = self.clips.saturating_sub(1);
        self.count();
    }
    fn pop_transparency_group(&mut self) {
        self.groups = self.groups.saturating_sub(1);
        self.count();
    }
}

thread_local! {
    static CAPTURE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static WARNED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}
struct WarningLogger;
impl log::Log for WarningLogger {
    fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
        metadata.level() <= log::Level::Warn
    }
    fn log(&self, record: &log::Record<'_>) {
        if self.enabled(record.metadata()) && CAPTURE.get() {
            WARNED.set(true);
        }
    }
    fn flush(&self) {}
}
struct WarningScope(bool);
impl WarningScope {
    fn new() -> Result<Self, Error> {
        static LOGGER: WarningLogger = WarningLogger;
        static READY: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
        if !READY.get_or_init(|| log::set_logger(&LOGGER).is_ok()) {
            return Err(Error::Engine);
        }
        log::set_max_level(log::LevelFilter::Warn);
        WARNED.set(false);
        Ok(Self(CAPTURE.replace(true)))
    }
    fn warned(&self) -> bool {
        WARNED.get()
    }
}
impl Drop for WarningScope {
    fn drop(&mut self) {
        CAPTURE.set(self.0);
    }
}

fn raster(source: &[u8], number: usize) -> Result<(image::RgbaImage, usize), Error> {
    if source.len() > super::MAX_DOCUMENT_BYTES || !source.starts_with(b"%PDF-") {
        return Err(Error::Invalid);
    }
    let warnings = WarningScope::new()?;
    reject_encryption(source)?;
    let pdf = Pdf::new(source.to_vec()).map_err(|_| Error::Invalid)?;
    if pdf.len() > MAX_NODES || pdf.pages().is_empty() || pdf.pages().len() > MAX_PAGES {
        return Err(Error::Limit);
    }
    let page = pdf
        .pages()
        .get(number.checked_sub(1).ok_or(Error::Invalid)?)
        .ok_or(Error::Invalid)?;
    let (width, height) = canvas(page.render_dimensions().0, page.render_dimensions().1)?;
    let mut budget = Budget { nodes: 0, bytes: 0 };
    for object in pdf.objects() {
        budget.object(&object, 0)?;
        if let Object::Stream(stream) = object {
            let dict = stream.dict();
            if name(dict, b"Subtype").as_deref() == Some(b"Image") {
                image_stream(&stream)?;
            } else {
                let decoded = stream_data(&stream, MAX_STREAM_BYTES)?;
                if name(dict, b"Subtype").as_deref() == Some(b"Form") {
                    let resources = dict.get::<Dict<'_>>(b"Resources").unwrap_or_default();
                    content(&decoded, &mut budget, |category, name| {
                        resources
                            .get::<Dict<'_>>(category)
                            .and_then(|items| items.get::<Object<'_>>(name.as_ref()))
                            .is_some()
                    })?;
                }
            }
        }
    }
    for page in pdf.pages().iter() {
        canvas(page.render_dimensions().0, page.render_dimensions().1)?;
        let contents = page.raw().get::<Object<'_>>(b"Contents");
        let mut bytes = Vec::new();
        let streams: Vec<_> = match contents {
            Some(Object::Stream(s)) => vec![s],
            Some(Object::Array(a)) => {
                let streams: Vec<_> = a.iter::<Stream<'_>>().collect();
                if streams.len() != a.raw_iter().count() {
                    return Err(Error::Invalid);
                }
                streams
            }
            None | Some(Object::Null(_)) => vec![],
            _ => return Err(Error::Invalid),
        };
        for stream in streams {
            let data = stream_data(&stream, MAX_STREAM_BYTES.saturating_sub(bytes.len()))?;
            bytes.extend_from_slice(&data);
            bytes.push(b'\n');
        }
        content(&bytes, &mut budget, |category, name| match category {
            b"XObject" => page.resources().get_x_object(name).is_some(),
            b"Font" => page.resources().get_font(name).is_some(),
            b"ExtGState" => page.resources().get_ext_g_state(name).is_some(),
            b"Shading" => page.resources().get_shading(name).is_some(),
            b"ColorSpace" => page.resources().get_color_space(name).is_some(),
            _ => false,
        })?;
    }
    let failed = Arc::new(AtomicBool::new(false));
    let mut settings = InterpreterSettings {
        render_annotations: false,
        ..Default::default()
    };
    let flag = failed.clone();
    settings.warning_sink = Arc::new(move |_| flag.store(true, Ordering::Release));
    let fonts = settings.font_resolver.clone();
    let flag = failed.clone();
    settings.font_resolver = Arc::new(move |query| match query {
        FontQuery::Standard(_) => fonts(query),
        _ => {
            flag.store(true, Ordering::Release);
            None
        }
    });
    use hayro::hayro_interpret::util::TransformExt;
    for page in pdf.pages().iter() {
        let cache = hayro::hayro_interpret::InterpreterCache::new();
        let size = canvas(page.render_dimensions().0, page.render_dimensions().1)?;
        let mut probe = Probe {
            pixels: 0,
            calls: 0,
            groups: 0,
            clips: 1,
            canvas: u64::from(size.0) * u64::from(size.1),
            failed: false,
        };
        let mut context = hayro::hayro_interpret::Context::new(
            page.initial_transform(true).to_kurbo(),
            hayro::kurbo::Rect::new(0., 0., f64::from(size.0), f64::from(size.1)),
            &cache,
            page.xref(),
            settings.clone(),
        );
        hayro::hayro_interpret::interpret_page(page, &mut context, &mut probe);
        if probe.failed {
            return Err(Error::Limit);
        }
    }
    if failed.load(Ordering::Acquire) || warnings.warned() {
        return Err(Error::Unsupported);
    }
    struct PaintWatch(Arc<AtomicBool>);
    impl Drop for PaintWatch {
        fn drop(&mut self) {
            self.0.store(true, Ordering::Release);
        }
    }
    let complete = Arc::new(AtomicBool::new(false));
    let watch = PaintWatch(complete.clone());
    std::thread::spawn(move || {
        std::thread::sleep(RASTER_TIMEOUT);
        if !complete.load(Ordering::Acquire) {
            std::process::exit(3);
        }
    });
    let mut context = hayro::vello_cpu::RenderContext::new(width as u16, height as u16);
    let transform = hayro::kurbo::Affine::scale_non_uniform(
        f64::from(width) / f64::from(page.render_dimensions().0),
        f64::from(height) / f64::from(page.render_dimensions().1),
    ) * page.initial_transform(true).to_kurbo();
    hayro::render_into(
        page,
        &hayro::RenderCache::new(),
        &settings,
        &hayro::RenderSettings::default(),
        &mut context,
        transform,
    );
    context.flush();
    let mut output = hayro::vello_cpu::Pixmap::new(width as u16, height as u16);
    context.render_with(
        &mut output,
        &mut hayro::vello_cpu::Resources::default(),
        hayro::vello_cpu::RasterizerSettings {
            target_init: hayro::vello_cpu::TargetInit::Clear(
                hayro::vello_cpu::color::palette::css::WHITE,
            ),
            ..Default::default()
        },
    );
    drop(watch);
    if failed.load(Ordering::Acquire) || warnings.warned() {
        return Err(Error::Unsupported);
    }
    let mut bytes = output.data_as_u8_slice().to_vec();
    if bytes.len() != width as usize * height as usize * 4 {
        return Err(Error::Invalid);
    }
    for pixel in bytes.as_chunks_mut::<4>().0 {
        pixel.swap(0, 2);
    }
    Ok((
        image::RgbaImage::from_raw(width, height, bytes).ok_or(Error::Invalid)?,
        pdf.pages().len(),
    ))
}

#[cfg(test)]
#[path = "../../test_support/pdf_fixture.rs"]
mod fixture;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_and_vector_pdf_render_with_local_fonts_and_bounded_canvas() {
        let source = fixture::document(
            b"0 0 1 rg 10 10 80 40 re f BT /F1 12 Tf 10 25 Td (TEST SINTETICO) Tj ET",
            &[],
        );
        let (pixels, pages) = raster(&source, 1).unwrap();
        assert_eq!((pixels.width(), pixels.height(), pages), (150, 90, 1));
        assert!(
            pixels
                .as_raw()
                .as_chunks::<4>()
                .0
                .iter()
                .any(|p| p[0] > 200 && p[1] < 50 && p[2] < 50)
        );
    }

    #[test]
    fn oversized_xobject_or_inline_image_refuses_every_pixel_before_decode() {
        let object = fixture::stream(b"/Type /XObject /Subtype /Image /Width 4000 /Height 3001 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode", b"not a JPEG");
        let source = fixture::document(b"0 1 0 rg 0 0 20 20 re f /Image Do", &[object]);
        assert_eq!(raster(&source, 1).err(), Some(Error::Limit));
        let source = fixture::document(
            b"0 1 0 rg 0 0 20 20 re f BI /W 4000 /H 3001 /CS /RGB /BPC 8 /F /DCT ID bad EI",
            &[],
        );
        assert_eq!(raster(&source, 1).err(), Some(Error::Limit));
    }

    #[test]
    fn complete_jpeg_image_is_visible_and_real_encoded_dimensions_are_checked() {
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 100)
            .encode_image(&image::RgbImage::from_pixel(
                3,
                2,
                image::Rgb([20, 60, 180]),
            ))
            .unwrap();
        let dict = b"/Type /XObject /Subtype /Image /Width 3 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode";
        let source = fixture::document(
            b"q 100 0 0 60 0 0 cm /Image Do Q",
            &[fixture::stream(dict, &jpeg)],
        );
        let (pixels, _) = raster(&source, 1).unwrap();
        assert!(
            pixels
                .as_raw()
                .as_chunks::<4>()
                .0
                .iter()
                .filter(|p| p[0] > 150 && p[2] < 60)
                .count()
                > 5000
        );
        let frame = jpeg.windows(2).position(|p| p == [0xff, 0xc0]).unwrap();
        jpeg[frame + 5..frame + 7].copy_from_slice(&3001u16.to_be_bytes());
        jpeg[frame + 7..frame + 9].copy_from_slice(&4000u16.to_be_bytes());
        let source = fixture::document(b"/Image Do", &[fixture::stream(dict, &jpeg)]);
        assert_eq!(raster(&source, 1).err(), Some(Error::Limit));
    }

    #[test]
    fn an_oversized_image_on_the_second_page_refuses_the_first_page_too() {
        let huge = fixture::stream(b"/Type /XObject /Subtype /Image /Width 4000 /Height 3001 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode", b"not a JPEG");
        let source = fixture::two_pages(b"0 0 1 rg 10 10 80 40 re f", b"/Image Do", Some(huge));
        assert_eq!(raster(&source, 1).err(), Some(Error::Limit));
        let valid = fixture::two_pages(
            b"0 0 1 rg 10 10 80 40 re f",
            b"1 0 0 rg 10 10 80 40 re f",
            None,
        );
        let (pixels, pages) = raster(&valid, 2).unwrap();
        assert_eq!(pages, 2);
        assert!(
            pixels
                .as_raw()
                .as_chunks::<4>()
                .0
                .iter()
                .any(|p| p[2] > 200 && p[0] < 50)
        );
    }

    #[test]
    fn page_count_is_checked_at_the_same_500_page_boundary_as_web() {
        assert_eq!(
            raster(&fixture::many_pages(501), 1).err(),
            Some(Error::Limit)
        );
        assert_eq!(raster(&fixture::many_pages(500), 500).unwrap().1, 500);
    }

    #[test]
    fn scratch_pixels_and_operator_counts_cannot_exceed_the_web_budgets() {
        use hayro::hayro_interpret::Device;
        use hayro::kurbo::Shape;
        let path = hayro::hayro_interpret::ClipPath {
            path: hayro::kurbo::Rect::new(0., 0., 10., 10.).to_path(0.1),
            fill: hayro::hayro_interpret::FillRule::NonZero,
        };
        let mut probe = Probe {
            pixels: 0,
            calls: 0,
            groups: 0,
            clips: 1,
            canvas: 4_000_000,
            failed: false,
        };
        probe.push_clip_path(&path);
        probe.push_clip_path(&path);
        assert!(!probe.failed);
        probe.push_clip_path(&path);
        assert!(probe.failed);
        let mut budget = Budget { nodes: 0, bytes: 0 };
        assert_eq!(
            content(&b"0 0 m\n".repeat(50_001), &mut budget, |_, _| false),
            Err(Error::Limit)
        );
        let mut budget = Budget { nodes: 0, bytes: 0 };
        assert_eq!(
            content(&b"0 0 m\n".repeat(50_000), &mut budget, |_, _| false),
            Ok(())
        );
    }

    #[test]
    fn malformed_operands_and_missing_or_corrupt_images_never_become_blank_successes() {
        for content in [b"(incomplete".as_slice(), b"12 Tj", b"/Image Do"] {
            let source = fixture::document(content, &[]);
            assert!(raster(&source, 1).is_err());
        }
        let object = fixture::stream(b"/Type /XObject /Subtype /Image /Width 3 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode", b"not a JPEG");
        assert_eq!(
            raster(&fixture::document(b"/Image Do", &[object]), 1).err(),
            Some(Error::Invalid)
        );
    }

    #[test]
    fn missing_custom_font_and_damaged_embedded_font_cannot_be_silently_substituted() {
        let text = b"BT /F1 12 Tf 10 25 Td (TEST SINTETICO) Tj ET";
        let missing = fixture::document_with_font(
            text,
            &[],
            b"<< /Type /Font /Subtype /Type1 /BaseFont /MissingSyntheticFont >>",
        );
        assert_eq!(raster(&missing, 1).err(), Some(Error::Unsupported));
        let damaged = fixture::document_with_font(text, &[fixture::stream(b"", b"not a font")], b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /FontDescriptor << /Type /FontDescriptor /FontName /Helvetica /Flags 32 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile 5 0 R >> >>");
        assert_eq!(raster(&damaged, 1).err(), Some(Error::Unsupported));
    }

    #[test]
    fn annotations_and_non_stream_contents_cannot_be_silently_omitted() {
        let source = fixture::page_with_extra_entries(b"/Annots [<< /Type /Annot /Subtype /Text /Rect [0 0 10 10] /Contents (TEST SINTETICO) >>]");
        assert_eq!(raster(&source, 1).err(), Some(Error::Unsupported));
        let source = fixture::page_with_extra_entries(b"/Contents [4 0 R 12]");
        assert_eq!(raster(&source, 1).err(), Some(Error::Invalid));
    }

    #[test]
    fn raster_metadata_and_truncated_payload_cannot_reach_the_view() {
        let source = Arc::new(Zeroizing::new(b"%PDF-synthetic".to_vec()));
        for header in [
            json!({"page":2,"pages":2,"width":1,"height":1}),
            json!({"page":1,"pages":1,"width":2049,"height":1}),
            json!({"page":1,"pages":501,"width":1,"height":1}),
            json!({"page":1,"pages":1,"width":1,"height":1}),
        ] {
            let mut data = format!("{header}\n").into_bytes();
            data.extend_from_slice(&[1, 2, 3]);
            assert!(parse_output(source.clone(), 1, &data).is_err());
        }
        assert_eq!(canvas(14_401., 60.), Err(Error::Limit));
        assert_eq!(canvas(f32::NAN, 60.), Err(Error::Limit));
        assert_eq!(canvas(14_400., 14_400.).unwrap(), (2000, 2000));
        assert_eq!(
            reject_encryption(b"/En#63rypt 4 0 R"),
            Err(Error::Unsupported)
        );
    }

    #[cfg(unix)]
    fn idle_child() -> (OwnedChild, u32) {
        let node = std::env::split_paths(&std::env::var_os("PATH").unwrap())
            .map(|path| path.join("node"))
            .find(|path| path.is_file())
            .expect("Node is required by native test selection");
        let child = Command::new(node)
            .args([
                "--eval",
                "process.stdin.resume(); setTimeout(() => {}, 30000)",
            ])
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let id = child.id();
        (OwnedChild(child), id)
    }

    #[cfg(unix)]
    fn assert_reaped(id: u32) {
        assert!(
            !Command::new("/bin/kill")
                .arg("-0")
                .arg(id.to_string())
                .stderr(Stdio::null())
                .status()
                .unwrap()
                .success()
        );
    }

    #[cfg(unix)]
    #[test]
    fn timeout_and_context_retirement_kill_and_reap_the_owned_worker() {
        let source = Arc::new(Zeroizing::new(b"%PDF-synthetic-owner-test".to_vec()));
        let (child, id) = idle_child();
        let result = collect_child(
            child,
            source.clone(),
            1,
            &RequestContext::default(),
            Duration::from_millis(100),
        );
        assert_eq!(result.err(), Some(Error::Timeout));
        assert_reaped(id);
        let (child, id) = idle_child();
        let context = RequestContext::default();
        let cancel = context.clone();
        let canceller = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            cancel.cancel();
        });
        let result = collect_child(child, source, 1, &context, Duration::from_secs(2));
        canceller.join().unwrap();
        assert_eq!(result.err(), Some(Error::Cancelled));
        assert_reaped(id);
    }

    #[test]
    fn policy_upper_bounds_match_web_and_pixel_admission_is_shared() {
        let web =
            include_str!("../../../../../components/document-viewer-policy.ts").replace('_', "");
        assert_eq!(VIEW_LIFETIME.as_secs(), 600);
        assert!(web.contains("viewLifetimeMs: 10 * 60000,"));
        assert!(web.contains("operandBytes: 48 * 1024 * 1024,"));
        for (key, value) in [
            ("pages", MAX_PAGES as u64),
            ("pdfPoints", MAX_POINTS as u64),
            ("canvasDimension", u64::from(MAX_CANVAS_DIMENSION)),
            ("canvasPixels", u64::from(MAX_CANVAS_PIXELS)),
            (
                "imageDimension",
                u64::from(super::super::MAX_PREVIEW_DIMENSION),
            ),
            ("imagePixels", super::super::MAX_PREVIEW_PIXELS),
            ("operators", MAX_OPERATORS as u64),
            ("pageImagePixels", MAX_PAGE_IMAGE_PIXELS),
            ("scratchPixels", MAX_SCRATCH_PIXELS),
            ("scratchCanvases", MAX_SCRATCH_CANVASES as u64),
            ("operandDepth", MAX_DEPTH as u64),
            ("rasterTimeoutMs", RASTER_TIMEOUT.as_millis() as u64),
            ("operandNodes", MAX_NODES as u64),
            ("pageTimeoutMs", TIMEOUT.as_millis() as u64),
        ] {
            assert!(web.contains(&format!("{key}: {value},")), "{key}");
        }
    }
}

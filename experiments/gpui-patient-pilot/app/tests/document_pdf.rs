#![cfg(target_os = "macos")]
#[path = "../test_support/pdf_fixture.rs"]
mod fixture;
use std::{
    io::Write,
    process::{Command, Stdio},
};

fn worker(source: &[u8], page: &str) -> std::process::Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_mediflow-gpui-patient-pilot"))
        .args(["--document-preview-worker", page])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(source).unwrap();
    child.wait_with_output().unwrap()
}

#[test]
fn binary_entry_point_emits_only_complete_bounded_pixels_or_an_error() {
    let valid = fixture::document(b"0 0 1 rg 10 10 80 40 re f", &[]);
    let output = worker(&valid, "1");
    assert!(output.status.success());
    let at = output.stdout.iter().position(|b| *b == b'\n').unwrap();
    let header: serde_json::Value = serde_json::from_slice(&output.stdout[..at]).unwrap();
    assert_eq!(
        header,
        serde_json::json!({"page":1,"pages":1,"width":150,"height":90})
    );
    assert_eq!(output.stdout.len() - at - 1, 150 * 90 * 4);
    let huge = fixture::stream(b"/Type /XObject /Subtype /Image /Width 4000 /Height 3001 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode", b"not a JPEG");
    let output = worker(
        &fixture::document(b"0 0 1 rg 10 10 80 40 re f /Image Do", &[huge]),
        "1",
    );
    assert!(output.status.success());
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&output.stdout).unwrap(),
        serde_json::json!({"error":"image_limit"})
    );
    let over_page_limit = worker(&fixture::many_pages(501), "1");
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&over_page_limit.stdout).unwrap(),
        serde_json::json!({"error":"limit"})
    );
    let annotated = worker(&fixture::page_with_extra_entries(b"/Annots []"), "1");
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&annotated.stdout).unwrap(),
        serde_json::json!({"error":"annotations"})
    );
    assert!(output.stderr.is_empty());
}

#[test]
fn second_page_uses_the_same_binary_and_does_not_run_the_app_ui() {
    let source = fixture::two_pages(
        b"0 0 1 rg 0 0 100 60 re f",
        b"1 0 0 rg 0 0 100 60 re f",
        None,
    );
    let output = worker(&source, "2");
    assert!(output.status.success());
    let at = output.stdout.iter().position(|b| *b == b'\n').unwrap();
    let header: serde_json::Value = serde_json::from_slice(&output.stdout[..at]).unwrap();
    assert_eq!(header["page"], 2);
    assert_eq!(header["pages"], 2);
    assert!(
        output.stdout[at + 1..]
            .as_chunks::<4>()
            .0
            .iter()
            .all(|p| p[0] < 5 && p[2] > 250)
    );
}

#[test]
fn missing_glyph_and_missing_digit_encodings_refuse_the_entire_preview() {
    for text in [b"A".as_slice(), b"Hb 13.4"] {
        let mut content = b"BT /F1 12 Tf 10 25 Td (".to_vec();
        content.extend_from_slice(text);
        content.extend_from_slice(b") Tj ET");
        let source = fixture::document_with_font(&content, &[], b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [51 /nonexistentSyntheticGlyph 65 /nonexistentSyntheticGlyph] >> >>");
        let output = worker(&source, "1");
        assert_eq!(output.stdout, b"{\"error\":\"font_encoding\"}\n");
    }
}

#[test]
fn valid_differences_and_unused_missing_names_do_not_refuse_a_preview() {
    for font in ["Helvetica", "Times-Roman", "Courier"] {
        for mapping in ["51 /three", "46 /period"] {
            let font = format!(
                "<< /Type /Font /Subtype /Type1 /BaseFont /{font} /Encoding << /BaseEncoding /WinAnsiEncoding /Differences [{mapping} 65 /nonexistentSyntheticGlyph] >> >>"
            );
            let source = fixture::document_with_font(
                b"BT /F1 12 Tf 10 25 Td (Hb 13.4) Tj ET",
                &[],
                font.as_bytes(),
            );
            assert!(worker(&source, "1").stdout.starts_with(b"{\"width\":150,"));
        }
    }
    let source = fixture::document_with_font(b"BT /F1 12 Tf 10 25 Td (Hb 1.4) Tj ET", &[], b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Differences [51 /nonexistentSyntheticGlyph] >> >>");
    assert!(worker(&source, "1").stdout.starts_with(b"{\"width\":150,"));
}

#[test]
fn all_text_operators_and_graphics_state_use_the_effective_font() {
    let resources = b"<< /Font << /Bad << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Differences [51 /nonexistentSyntheticGlyph] >> >> /Good << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> /ExtGState << /State << /Font [ << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Differences [51 /nonexistentSyntheticGlyph] >> >> 12 ] >> >> >>";
    for content in [
        "BT /Bad 12 Tf (Hb 13.4) Tj ET",
        "BT /Bad 12 Tf [(Hb 1) -20 (3.4)] TJ ET",
        "BT /Bad 12 Tf (Hb 13.4) ' ET",
        "BT /Bad 12 Tf 0 0 (Hb 13.4) \" ET",
        "BT /Bad 12 Tf q /Good 12 Tf (Hb 13.4) Tj Q (Hb 13.4) Tj ET",
        "BT /Good 12 Tf /State gs (Hb 13.4) Tj ET",
    ] {
        let source = fixture::with_resources(content.as_bytes(), resources, &[]);
        assert_eq!(
            worker(&source, "1").stdout,
            b"{\"error\":\"font_encoding\"}\n",
            "{content}"
        );
    }
    let source =
        fixture::with_resources(b"BT /Bad 12 Tf /Good 12 Tf (Hb 13.4) Tj ET", resources, &[]);
    assert!(worker(&source, "1").stdout.starts_with(b"{\"width\":150,"));
}

#[test]
fn embedded_font_names_are_resolved_in_the_embedded_font_only() {
    let font = fixture::stream(
        b"",
        include_bytes!("../test_support/synthetic-glyph-font.ttf"),
    );
    for (name, accepted) in [
        ("syntheticThree", true),
        ("nonexistentSyntheticGlyph", false),
    ] {
        let resources = format!(
            "<< /Font << /F1 << /Type /Font /Subtype /TrueType /BaseFont /MediFlowSynthetic /FirstChar 51 /LastChar 51 /Widths [600] /Encoding << /Differences [51 /{name}] >> /FontDescriptor << /Type /FontDescriptor /FontName /MediFlowSynthetic /Flags 32 /FontBBox [0 0 600 800] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 5 0 R >> >> >> >>"
        );
        let source = fixture::with_resources(
            b"BT /F1 12 Tf 10 25 Td (3) Tj ET",
            resources.as_bytes(),
            std::slice::from_ref(&font),
        );
        let output = worker(&source, "1");
        if accepted {
            assert!(
                output.stdout.starts_with(b"{\"width\":150,"),
                "{:?}",
                output.stdout
            );
        } else {
            assert_eq!(output.stdout, b"{\"error\":\"font_encoding\"}\n");
        }
    }
}

#[test]
fn inline_images_and_images_on_other_pages_obey_the_same_pixel_bound() {
    let source = fixture::document(b"BI /W 4000 /H 3001 /CS /RGB /BPC 8 /F /DCT ID bad EI", &[]);
    assert_eq!(
        worker(&source, "1").stdout,
        b"{\"error\":\"image_limit\"}\n"
    );
    let huge = fixture::stream(b"/Type /XObject /Subtype /Image /Width 4000 /Height 3001 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode", b"not a JPEG");
    let source = fixture::two_pages(b"0 0 1 rg 0 0 100 60 re f", b"/Image Do", Some(huge));
    assert_eq!(
        worker(&source, "1").stdout,
        b"{\"error\":\"image_limit\"}\n"
    );
}

#[test]
fn real_jpeg_dimensions_cannot_hide_behind_a_small_pdf_dictionary() {
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new(&mut jpeg)
        .encode_image(&image::RgbImage::from_pixel(
            3,
            2,
            image::Rgb([20, 60, 180]),
        ))
        .unwrap();
    let dict = b"/Type /XObject /Subtype /Image /Width 3 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode";
    let good = fixture::document(
        b"q 100 0 0 60 0 0 cm /Image Do Q",
        &[fixture::stream(dict, &jpeg)],
    );
    let output = worker(&good, "1");
    assert!(output.stdout.starts_with(b"{\"width\":150,"));
    let mismatch = fixture::stream(b"/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode", &jpeg);
    assert_eq!(
        worker(&fixture::document(b"/Image Do", &[mismatch]), "1").stdout,
        b"{\"error\":\"invalid\"}\n"
    );
    let frame = jpeg.windows(2).position(|p| p == [0xff, 0xc0]).unwrap();
    jpeg[frame + 5..frame + 7].copy_from_slice(&3001u16.to_be_bytes());
    jpeg[frame + 7..frame + 9].copy_from_slice(&4000u16.to_be_bytes());
    let bad = fixture::document(b"/Image Do", &[fixture::stream(dict, &jpeg)]);
    assert_eq!(worker(&bad, "1").stdout, b"{\"error\":\"image_limit\"}\n");
}

#[test]
fn inherited_resources_cannot_bypass_font_or_image_admission() {
    let font = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Differences [51 /nonexistentSyntheticGlyph] >> >>";
    assert_eq!(
        worker(&fixture::font_on_second_page(font), "1").stdout,
        b"{\"error\":\"font_encoding\"}\n"
    );
    assert_eq!(
        worker(&fixture::inherited_resources(font, None), "1").stdout,
        b"{\"error\":\"font_encoding\"}\n"
    );
    let huge = fixture::stream(b"/Type /XObject /Subtype /Image /Width 4000 /Height 3001 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode",b"bad");
    assert_eq!(
        worker(
            &fixture::inherited_resources(
                b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
                Some(huge)
            ),
            "1"
        )
        .stdout,
        b"{\"error\":\"image_limit\"}\n"
    );
}

#[test]
fn unqualified_form_content_is_refused_before_the_platform_raster() {
    let form = fixture::stream(
        b"/Type /XObject /Subtype /Form /BBox [0 0 100 60]",
        b"BI /W 4000 /H 3001 /CS /RGB /BPC 8 /F /DCT ID bad EI",
    );
    let unused = fixture::stream(b"", b"");
    let output = worker(&fixture::document(b"/Form Do", &[unused, form]), "1");
    assert_eq!(output.stdout, b"{\"error\":\"nested_graphics\"}\n");
}

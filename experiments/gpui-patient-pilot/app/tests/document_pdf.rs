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
        serde_json::json!({"error":"limit"})
    );
    let over_page_limit = worker(&fixture::many_pages(501), "1");
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&over_page_limit.stdout).unwrap(),
        serde_json::json!({"error":"limit"})
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

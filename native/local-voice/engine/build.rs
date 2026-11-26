use std::{env, path::PathBuf, process::Command};

fn main() {
    println!("cargo:rustc-check-cfg=cfg(local_voice_capture)");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    println!("cargo:rerun-if-env-changed=MACOSX_DEPLOYMENT_TARGET");
    for key in ["DEVELOPER_DIR", "SDKROOT", "TOOLCHAINS"] {
        println!("cargo:rerun-if-env-changed={key}");
    }
    let minimum = env::var("MACOSX_DEPLOYMENT_TARGET").unwrap_or_else(|_| "11.0".into());
    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    build_voice(&out, &minimum);
}

/// Ponte Swift della dettatura: solo la cattura del microfono per whisper.
/// Senza compilatore Swift la dettatura non è disponibile.
fn build_voice(out: &std::path::Path, minimum: &str) {
    let source = "src/bridge.swift";
    println!("cargo:rerun-if-changed={source}");
    let swift = Command::new("xcrun").args(["swiftc", "--version"]).output();
    if !swift.is_ok_and(|output| output.status.success()) {
        println!("cargo:warning=Local voice capture unavailable: Swift compiler required");
        return;
    }
    let arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap();
    let arch = if arch == "aarch64" { "arm64" } else { &arch };
    assert!(
        Command::new("xcrun")
            .args([
                "swiftc",
                "-parse-as-library",
                "-emit-library",
                "-static",
                "-module-name",
                "MediFlowLocalVoice",
                "-target"
            ])
            .arg(format!("{arch}-apple-macos{minimum}"))
            .arg(source)
            .arg("-o")
            .arg(out.join("libmediflow_voice.a"))
            .status()
            .unwrap()
            .success(),
        "Local voice capture compilation failed"
    );
    let sdk = Command::new("xcrun")
        .args(["--sdk", "macosx", "--show-sdk-path"])
        .output()
        .unwrap();
    let sdk = String::from_utf8(sdk.stdout).unwrap();
    println!(
        "cargo:rustc-link-search=native={}/usr/lib/swift",
        sdk.trim()
    );
    let compiler = Command::new("xcrun")
        .args(["--find", "swiftc"])
        .output()
        .unwrap();
    let compiler = PathBuf::from(String::from_utf8(compiler.stdout).unwrap().trim());
    let libraries = compiler
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("lib/swift/macosx");
    println!("cargo:rustc-link-search=native={}", libraries.display());
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=mediflow_voice");
    println!("cargo:rustc-cfg=local_voice_capture");
}

use std::{env, path::PathBuf, process::Command};

fn main() {
    println!("cargo:rustc-check-cfg=cfg(local_voice_apple)");
    println!("cargo:rerun-if-changed=src/chat_access/native.m");
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
    let object = out.join("chat-access.o");
    assert!(
        Command::new("clang")
            .args([
                "-fobjc-arc",
                "-fblocks",
                "-Wall",
                "-Werror",
                "-Wunguarded-availability",
                "-Wunguarded-availability-new",
                "-c",
                "src/chat_access/native.m",
                "-o"
            ])
            .arg(&object)
            .arg(format!("-mmacosx-version-min={minimum}"))
            .status()
            .unwrap()
            .success()
    );
    assert!(
        Command::new("ar")
            .arg("rcs")
            .arg(out.join("libchat_access_native.a"))
            .arg(object)
            .status()
            .unwrap()
            .success()
    );
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=chat_access_native");
    println!("cargo:rustc-link-lib=bsm");
    for framework in [
        "Foundation",
        "AppKit",
        "Security",
        "LocalAuthentication",
        "CoreGraphics",
    ] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
}

fn build_voice(out: &std::path::Path, minimum: &str) {
    let sources = [
        "../../../native/MediFlowMac/Sources/MediFlowCore/VisitRecordingStateContract.swift",
        "../../../native/MediFlowMac/Sources/MediFlowAppleShared/VisitRecordingPreflight.swift",
        "../../../native/MediFlowMac/Sources/MediFlowAppleShared/VisitRecordingCapture.swift",
        "../../../native/MediFlowMac/Sources/MediFlowAppleShared/AppleVisitRecordingRuntime.swift",
        "src/local_voice/bridge.swift",
    ];
    for source in sources {
        println!("cargo:rerun-if-changed={source}");
    }
    let version = Command::new("xcrun")
        .args(["swiftc", "--version"])
        .output()
        .expect("Swift compiler required for local Apple voice");
    let version = String::from_utf8_lossy(&version.stdout);
    let modern = version.split("Swift version ").nth(1).is_some_and(|v| {
        let mut parts = v.split('.');
        let major = parts
            .next()
            .and_then(|p| p.split_whitespace().next()?.parse::<u32>().ok())
            .unwrap_or(0);
        let minor = parts
            .next()
            .and_then(|p| p.split_whitespace().next()?.parse::<u32>().ok())
            .unwrap_or(0);
        major > 6 || major == 6 && minor >= 2
    });
    if !modern {
        println!(
            "cargo:warning=Local Apple voice unavailable: Swift 6.2 and macOS 26 SDK required"
        );
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
            .args(sources)
            .arg("-o")
            .arg(out.join("libmediflow_voice.a"))
            .status()
            .unwrap()
            .success(),
        "Local Apple voice compilation failed"
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
    println!("cargo:rustc-link-lib=static=mediflow_voice");
    println!("cargo:rustc-cfg=local_voice_apple");
}

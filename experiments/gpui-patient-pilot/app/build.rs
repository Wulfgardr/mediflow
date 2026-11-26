use std::{env, path::PathBuf, process::Command};

fn main() {
    println!("cargo:rerun-if-changed=src/chat_access/native.m");
    println!("cargo:rerun-if-changed=src/documents/pdf_native.m");
    println!("cargo:rerun-if-changed=src/documents/adobe_glyph_names.h");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    println!("cargo:rerun-if-env-changed=MACOSX_DEPLOYMENT_TARGET");
    for key in ["DEVELOPER_DIR", "SDKROOT", "TOOLCHAINS"] {
        println!("cargo:rerun-if-env-changed={key}");
    }
    let minimum = env::var("MACOSX_DEPLOYMENT_TARGET").unwrap_or_else(|_| "11.0".into());
    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    println!("cargo:rerun-if-changed=src/shell/local_host/macos_preferences.m");
    for (source, name) in [
        ("src/chat_access/native.m", "chat-access.o"),
        ("src/documents/pdf_native.m", "pdf-preview.o"),
        (
            "src/shell/local_host/macos_preferences.m",
            "macos-preferences.o",
        ),
    ] {
        let object = out.join(name);
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
                    source,
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
                .arg(&object)
                .status()
                .unwrap()
                .success()
        );
    }
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=chat_access_native");
    println!("cargo:rustc-link-lib=bsm");
    for framework in [
        "Foundation",
        "AppKit",
        "Security",
        "LocalAuthentication",
        "CoreGraphics",
        "PDFKit",
        "ImageIO",
        "CoreText",
    ] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
}

#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

mod auth;
mod http;
#[cfg(target_os = "macos")]
mod server;
#[cfg(target_os = "macos")]
mod sessions;
#[cfg(target_os = "macos")]
mod stream;

#[cfg(target_os = "macos")]
fn main() {
    std::process::exit(server::run_from_env());
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("mediflow-voice: la voce locale richiede macOS");
    std::process::exit(3);
}

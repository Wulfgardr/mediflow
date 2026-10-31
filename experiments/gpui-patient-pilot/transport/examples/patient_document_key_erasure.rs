use mediflow_runtime_client::{PairingCredentials, RuntimeClient, RuntimeConfig};
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};
struct ObservedAllocator;
static LEAKS: AtomicUsize = AtomicUsize::new(0);
static FIRST_SIZE: AtomicUsize = AtomicUsize::new(0);
unsafe impl GlobalAlloc for ObservedAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        unsafe { System.alloc_zeroed(layout) }
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        unsafe { System.alloc_zeroed(layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        let next = unsafe {
            System.alloc_zeroed(Layout::from_size_align(new_size, layout.align()).unwrap())
        };
        if !next.is_null() {
            unsafe {
                std::ptr::copy_nonoverlapping(ptr, next, layout.size().min(new_size));
                self.dealloc(ptr, layout);
            }
        }
        next
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        // All allocated capacity was initialized to zero by this allocator.
        // Inspect only our synthetic process memory, before it is freed.
        if (1024 * 1024..32 * 1024 * 1024).contains(&layout.size()) {
            let bytes = unsafe { std::slice::from_raw_parts(ptr, layout.size()) };
            let marker = b"\"fileKey\":[";
            if bytes
                .windows(marker.len())
                .enumerate()
                .any(|(at, s)| s == marker && full_key(&bytes[at + marker.len()..]))
            {
                LEAKS.fetch_add(1, Ordering::Relaxed);
                FIRST_SIZE
                    .compare_exchange(0, layout.size(), Ordering::Relaxed, Ordering::Relaxed)
                    .ok();
            }
        }
        unsafe {
            System.dealloc(ptr, layout);
        }
    }
}
#[global_allocator]
static ALLOCATOR: ObservedAllocator = ObservedAllocator;
fn full_key(mut bytes: &[u8]) -> bool {
    let mut nonzero = false;
    for n in 0..32 {
        let mut value = 0u16;
        let mut digits = 0;
        while bytes.first().is_some_and(u8::is_ascii_digit) {
            value = value * 10 + (bytes[0] - b'0') as u16;
            digits += 1;
            if digits > 3 || value > 255 {
                return false;
            }
            bytes = &bytes[1..];
        }
        if digits == 0 || bytes.first() != Some(&if n == 31 { b']' } else { b',' }) {
            return false;
        }
        nonzero |= value != 0;
        bytes = &bytes[1..];
    }
    nonzero
}
fn main() {
    let marker = b"{\"fileKey\":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32]}";
    let mut calibration = vec![0; 1024 * 1024];
    calibration[..marker.len()].copy_from_slice(marker);
    calibration.reserve(1024 * 1024);
    assert_eq!(
        LEAKS.swap(0, Ordering::Relaxed),
        1,
        "realloc observer calibration"
    );
    calibration.fill(0);
    drop(calibration);
    FIRST_SIZE.store(0, Ordering::Relaxed);
    let args: Vec<_> = std::env::args().collect();
    let session = RuntimeClient::new(RuntimeConfig {
        base_url: args[1].clone(),
        tls_pin_sha256: None,
    })
    .unwrap()
    .login(
        PairingCredentials::new("synthetic-key-probe", "b".repeat(32)).unwrap(),
        "synthetic",
        &args[2],
    )
    .unwrap();
    session.list_ambulatories().unwrap();
    let mut pdf = vec![b'x'; args[3].parse::<usize>().unwrap() * 1024 * 1024];
    pdf[..5].copy_from_slice(b"%PDF-");
    let cancel = args[4] == "cancel";
    let request_session = session.clone();
    let worker = std::thread::spawn(move || {
        request_session.patient_document_stage("scope-a", "synthetic.pdf", &pdf)
    });
    if cancel {
        let received = std::path::Path::new(&args[5]);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        while !received.exists() {
            assert!(
                std::time::Instant::now() < deadline,
                "host did not receive stage"
            );
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        session.request_context().cancel();
    }
    let error = worker.join().unwrap().err().unwrap();
    assert_eq!(
        error,
        if cancel {
            mediflow_runtime_client::RuntimeError::Indeterminate
        } else {
            mediflow_runtime_client::RuntimeError::Forbidden
        }
    );
    drop(session);
    let count = LEAKS.load(Ordering::Relaxed);
    let size = FIRST_SIZE.load(Ordering::Relaxed);
    println!(
        "stage_error={error:?}; released_allocations_with_unerased_file_key_json={count}; first_allocation_bytes={size}"
    );
    assert_eq!(count, 0, "HTTP body released an unerased file key");
}

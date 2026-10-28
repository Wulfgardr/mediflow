use gpui::{Bounds, Pixels, Window, point, px, size};

pub(crate) fn initial_bounds(work: Bounds<Pixels>) -> Bounds<Pixels> {
    let dimensions = size(
        px(1200.).min(work.size.width),
        px(840.).min(work.size.height),
    );
    Bounds::new(
        point(
            work.origin.x + (work.size.width - dimensions.width) / 2.,
            work.origin.y + (work.size.height - dimensions.height) / 2.,
        ),
        dimensions,
    )
}

pub(crate) fn sync_titlebar(_window: &Window, _dark: bool) {
    #[cfg(windows)]
    if let Some(hwnd) = windows::hwnd(_window) {
        let dark = i32::from(_dark);
        unsafe {
            windows_sys::Win32::Graphics::Dwm::DwmSetWindowAttribute(
                hwnd,
                20,
                (&dark as *const i32).cast(),
                4,
            );
        }
    }
}

pub(crate) fn fit_window(_window: &Window) {
    #[cfg(windows)]
    windows::fit(_window);
}

#[cfg(windows)]
mod windows {
    use super::*;
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use windows_sys::Win32::{Foundation::HWND, Graphics::Gdi::*, UI::WindowsAndMessaging::*};

    pub(super) fn hwnd(window: &Window) -> Option<HWND> {
        match HasWindowHandle::window_handle(window).ok()?.as_raw() {
            RawWindowHandle::Win32(handle) => Some(handle.hwnd.get() as HWND),
            _ => None,
        }
    }

    pub(super) fn fit(window: &Window) {
        let Some(hwnd) = hwnd(window) else { return };
        unsafe {
            let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            let mut info: MONITORINFO = std::mem::zeroed();
            info.cbSize = std::mem::size_of_val(&info) as u32;
            let mut rect = std::mem::zeroed();
            if GetMonitorInfoW(monitor, &mut info) == 0 || GetWindowRect(hwnd, &mut rect) == 0 {
                return;
            }
            let work = info.rcWork;
            let width = (rect.right - rect.left).min(work.right - work.left);
            let height = (rect.bottom - rect.top).min(work.bottom - work.top);
            SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                work.left + (work.right - work.left - width) / 2,
                work.top + (work.bottom - work.top - height) / 2,
                width,
                height,
                SWP_NOZORDER | SWP_NOACTIVATE,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn opening_bounds_fit_small_work_areas_and_center_on_offset_monitors() {
        for (x, y, w, h) in [
            (0., 0., 1441., 720.),
            (-1920., 40., 1920., 1000.),
            (0., 0., 320., 480.),
        ] {
            let work = Bounds::new(point(px(x), px(y)), size(px(w), px(h)));
            let bounds = initial_bounds(work);
            assert!(bounds.left() >= work.left() && bounds.top() >= work.top());
            assert!(bounds.right() <= work.right() && bounds.bottom() <= work.bottom());
            assert_eq!(bounds.center(), work.center());
            assert_eq!(bounds.size, size(px(w.min(1200.)), px(h.min(840.))));
        }
    }
}

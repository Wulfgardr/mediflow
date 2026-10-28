use std::{ffi::c_void, fs, io, os::windows::ffi::OsStrExt, path::Path, ptr};
use windows_sys::Win32::{
    Foundation::{CloseHandle, LocalFree},
    Security::{Authorization::*, *},
    Storage::FileSystem::CreateDirectoryW,
    System::Threading::{GetCurrentProcess, OpenProcessToken},
};

struct Allocation(*mut c_void);
impl Drop for Allocation {
    fn drop(&mut self) {
        unsafe {
            LocalFree(self.0);
        }
    }
}

fn user() -> io::Result<Vec<usize>> {
    unsafe {
        let mut token = ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return Err(io::Error::last_os_error());
        }
        let mut bytes = 0;
        GetTokenInformation(token, TokenUser, ptr::null_mut(), 0, &mut bytes);
        let mut buffer = vec![0usize; (bytes as usize).div_ceil(size_of::<usize>())];
        let ok = GetTokenInformation(
            token,
            TokenUser,
            buffer.as_mut_ptr().cast(),
            bytes,
            &mut bytes,
        );
        CloseHandle(token);
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(buffer)
    }
}

fn wide(path: &Path) -> Vec<u16> {
    path.as_os_str().encode_wide().chain(Some(0)).collect()
}

pub(super) fn verify(path: &Path) -> io::Result<()> {
    use std::os::windows::fs::MetadataExt;
    for ancestor in path.ancestors() {
        if fs::symlink_metadata(ancestor)?.file_attributes() & 0x400 != 0 {
            return Err(io::ErrorKind::PermissionDenied.into());
        }
    }
    let user = user()?;
    let sid = unsafe { (*(user.as_ptr().cast::<TOKEN_USER>())).User.Sid };
    unsafe {
        let mut owner = ptr::null_mut();
        let mut acl = ptr::null_mut();
        let mut descriptor = ptr::null_mut();
        let result = GetNamedSecurityInfoW(
            wide(path).as_ptr(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &mut owner,
            ptr::null_mut(),
            &mut acl,
            ptr::null_mut(),
            &mut descriptor,
        );
        let _allocation = Allocation(descriptor);
        if result != 0 {
            return Err(io::Error::from_raw_os_error(result as i32));
        }
        if owner.is_null() || EqualSid(owner, sid) == 0 || acl.is_null() {
            return Err(io::ErrorKind::PermissionDenied.into());
        }
        for index in 0..u32::from((*acl).AceCount) {
            let mut ace = ptr::null_mut();
            if GetAce(acl, index, &mut ace) == 0 {
                return Err(io::Error::last_os_error());
            }
            let header = &*ace.cast::<ACE_HEADER>();
            match header.AceType {
                0 => {
                    let allowed = &*ace.cast::<ACCESS_ALLOWED_ACE>();
                    let trustee = (&allowed.SidStart as *const u32).cast_mut().cast();
                    if EqualSid(trustee, sid) == 0 {
                        return Err(io::ErrorKind::PermissionDenied.into());
                    }
                }
                1 => {}
                _ => {
                    return Err(io::Error::new(
                        io::ErrorKind::Unsupported,
                        "ACL Windows non verificabile: sono ammesse solo ACE standard per l'utente corrente.",
                    ));
                }
            }
        }
    }
    Ok(())
}

pub(super) fn create(path: &Path) -> io::Result<()> {
    let user = user()?;
    unsafe {
        let sid = (*(user.as_ptr().cast::<TOKEN_USER>())).User.Sid;
        let mut string = ptr::null_mut();
        if ConvertSidToStringSidW(sid, &mut string) == 0 {
            return Err(io::Error::last_os_error());
        }
        let _string = Allocation(string.cast());
        let mut length = 0;
        while *string.add(length) != 0 {
            length += 1;
        }
        let sid = String::from_utf16_lossy(std::slice::from_raw_parts(string, length));
        let sddl: Vec<u16> = format!("O:{sid}D:P(A;OICI;FA;;;{sid})")
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let mut descriptor = ptr::null_mut();
        if ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            1,
            &mut descriptor,
            ptr::null_mut(),
        ) == 0
        {
            return Err(io::Error::last_os_error());
        }
        let _descriptor = Allocation(descriptor);
        let attributes = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor,
            bInheritHandle: 0,
        };
        if CreateDirectoryW(wide(path).as_ptr(), &attributes) == 0 {
            let error = io::Error::last_os_error();
            if error.kind() != io::ErrorKind::AlreadyExists {
                return Err(error);
            }
        }
    }
    verify(path)
}

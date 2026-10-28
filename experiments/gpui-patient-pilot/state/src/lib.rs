#![cfg(windows)]

use std::{
    ffi::c_void,
    fs::{self, File},
    io,
    os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle},
    },
    path::{Path, PathBuf},
    ptr,
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, GENERIC_READ, GENERIC_WRITE, INVALID_HANDLE_VALUE, LocalFree},
    Security::{Authorization::*, *},
    Storage::FileSystem::*,
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
        let error = (ok == 0).then(io::Error::last_os_error);
        CloseHandle(token);
        if let Some(error) = error {
            return Err(error);
        }
        Ok(buffer)
    }
}

fn wide(path: &Path) -> Vec<u16> {
    path.as_os_str().encode_wide().chain(Some(0)).collect()
}

fn denied(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::PermissionDenied, message)
}

pub fn trusted_path(path: &Path) -> io::Result<PathBuf> {
    let canonical = path.canonicalize()?;
    let within_profile = ["LOCALAPPDATA", "USERPROFILE"]
        .into_iter()
        .filter_map(std::env::var_os)
        .map(PathBuf::from)
        .filter(|root| root.is_absolute())
        .filter_map(|root| root.canonicalize().ok())
        .any(|root| {
            let mut components = canonical.components();
            root.components().all(|part| {
                components.next().is_some_and(|actual| {
                    actual
                        .as_os_str()
                        .to_string_lossy()
                        .eq_ignore_ascii_case(&part.as_os_str().to_string_lossy())
                })
            })
        });
    if !within_profile {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Su Windows la cartella di stato deve stare nel profilo dell'utente (%LOCALAPPDATA% o %USERPROFILE%).",
        ));
    }
    use std::os::windows::fs::MetadataExt;
    for ancestor in path.ancestors() {
        if fs::symlink_metadata(ancestor)?.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(denied(
                "Il percorso di stato Windows attraversa un reparse point.",
            ));
        }
    }
    Ok(canonical)
}

fn descriptor(directory: bool) -> io::Result<Allocation> {
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
        let inheritance = if directory { "OICI" } else { "" };
        let sddl: Vec<u16> = format!("O:{sid}D:P(A;{inheritance};FA;;;{sid})")
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
        Ok(Allocation(descriptor))
    }
}

fn attributes(descriptor: &Allocation) -> SECURITY_ATTRIBUTES {
    SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor.0,
        bInheritHandle: 0,
    }
}

fn verify_handle(file: &File, directory: bool) -> io::Result<()> {
    use std::os::windows::fs::MetadataExt;
    let metadata = file.metadata()?;
    if metadata.is_dir() != directory
        || (!directory && !metadata.is_file())
        || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    {
        return Err(denied(
            "L'oggetto di stato Windows non è un file o una cartella regolare attestabile.",
        ));
    }
    let user = user()?;
    let sid = unsafe { (*(user.as_ptr().cast::<TOKEN_USER>())).User.Sid };
    unsafe {
        let mut owner = ptr::null_mut();
        let mut acl = ptr::null_mut();
        let mut descriptor = ptr::null_mut();
        let result = GetSecurityInfo(
            file.as_raw_handle(),
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
            return Err(denied(
                "Proprietario o DACL dell'oggetto di stato Windows non privati per l'utente corrente.",
            ));
        }
        let mut control = 0;
        let mut revision = 0;
        if GetSecurityDescriptorControl(descriptor, &mut control, &mut revision) == 0 {
            return Err(io::Error::last_os_error());
        }
        if control & SE_DACL_PROTECTED == 0 {
            return Err(denied(
                "L'oggetto di stato Windows richiede una DACL protetta dall'ereditarietà.",
            ));
        }
        let mut inheritable_user = false;
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
                        return Err(denied(
                            "La DACL dell'oggetto di stato Windows concede accesso a un altro SID.",
                        ));
                    }
                    let flags = OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE;
                    inheritable_user |= u32::from(header.AceFlags) & flags == flags
                        && u32::from(header.AceFlags) & INHERIT_ONLY_ACE == 0
                        && allowed.Mask & FILE_ALL_ACCESS == FILE_ALL_ACCESS;
                }
                1 => {}
                _ => {
                    return Err(io::Error::new(
                        io::ErrorKind::Unsupported,
                        "ACL Windows non verificabile: tipo di ACE non supportato.",
                    ));
                }
            }
        }
        if directory && !inheritable_user {
            return Err(denied(
                "La cartella di stato Windows richiede un'ACE dell'utente con accesso completo ed ereditarietà a file e sottocartelle (OI|CI).",
            ));
        }
    }
    Ok(())
}

fn open(
    path: &Path,
    access: u32,
    sharing: u32,
    disposition: u32,
    directory: bool,
) -> io::Result<File> {
    let descriptor = descriptor(directory)?;
    let attributes = attributes(&descriptor);
    let handle = unsafe {
        CreateFileW(
            wide(path).as_ptr(),
            access,
            sharing,
            &attributes,
            disposition,
            FILE_FLAG_OPEN_REPARSE_POINT
                | if directory {
                    FILE_FLAG_BACKUP_SEMANTICS
                } else {
                    0
                },
            ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    let file = unsafe { File::from_raw_handle(handle) };
    verify_handle(&file, directory)?;
    Ok(file)
}

pub fn verify_directory(path: &Path) -> io::Result<()> {
    trusted_path(path)?;
    open(
        path,
        READ_CONTROL | FILE_READ_ATTRIBUTES,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
        OPEN_EXISTING,
        true,
    )
    .map(|_| ())
}

pub fn create_directory(path: &Path) -> io::Result<()> {
    if !path.exists() {
        let parent = path.parent().ok_or(io::ErrorKind::InvalidInput)?;
        trusted_path(parent)?;
        let descriptor = descriptor(true)?;
        let attributes = attributes(&descriptor);
        if unsafe { CreateDirectoryW(wide(path).as_ptr(), &attributes) } == 0 {
            let error = io::Error::last_os_error();
            if error.kind() != io::ErrorKind::AlreadyExists {
                return Err(error);
            }
        }
    }
    verify_directory(path)
}

pub fn open_read(path: &Path) -> io::Result<File> {
    verify_directory(path.parent().ok_or(io::ErrorKind::InvalidInput)?)
        .map_err(io::Error::other)?;
    open(path, GENERIC_READ, FILE_SHARE_READ, OPEN_EXISTING, false)
}

pub fn create_file(path: &Path) -> io::Result<File> {
    verify_directory(path.parent().ok_or(io::ErrorKind::InvalidInput)?)
        .map_err(io::Error::other)?;
    open(path, GENERIC_READ | GENERIC_WRITE, 0, CREATE_NEW, false)
}

pub fn open_lock(path: &Path) -> io::Result<File> {
    verify_directory(path.parent().ok_or(io::ErrorKind::InvalidInput)?)
        .map_err(io::Error::other)?;
    open(
        path,
        GENERIC_READ | GENERIC_WRITE,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
        OPEN_ALWAYS,
        false,
    )
}

pub fn open_write(path: &Path) -> io::Result<File> {
    verify_directory(path.parent().ok_or(io::ErrorKind::InvalidInput)?)
        .map_err(io::Error::other)?;
    open(
        path,
        GENERIC_READ | GENERIC_WRITE,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
        OPEN_EXISTING,
        false,
    )
}

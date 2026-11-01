pub fn document(content: &[u8], extras: &[Vec<u8>]) -> Vec<u8> {
    document_with_font(
        content,
        extras,
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    )
}
pub fn document_with_font(content: &[u8], extras: &[Vec<u8>], font: &[u8]) -> Vec<u8> {
    let mut page =
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 60] /Resources << /Font << /F1 ".to_vec();
    page.extend_from_slice(font);
    page.extend_from_slice(b" >> /XObject << ");
    if !extras.is_empty() {
        page.extend_from_slice(b"/Image 5 0 R ");
    }
    if extras.len() > 1 {
        page.extend_from_slice(b"/Form 6 0 R ");
    }
    page.extend_from_slice(b" >> >> /Contents 4 0 R >>");
    let objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>".to_vec(),
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_vec(),
        page,
        stream(b"", content),
    ]
    .into_iter()
    .chain(extras.iter().cloned())
    .collect::<Vec<_>>();
    serialize(&objects)
}

fn serialize(objects: &[Vec<u8>]) -> Vec<u8> {
    let mut data = b"%PDF-1.7\n".to_vec();
    let mut offsets = vec![0];
    for (index, object) in objects.iter().enumerate() {
        offsets.push(data.len());
        data.extend_from_slice(format!("{} 0 obj\n", index + 1).as_bytes());
        data.extend_from_slice(object);
        data.extend_from_slice(b"\nendobj\n");
    }
    let xref = data.len();
    data.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", offsets.len()).as_bytes());
    for offset in offsets.iter().skip(1) {
        data.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    data.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            offsets.len()
        )
        .as_bytes(),
    );
    data
}

pub fn stream(dict: &[u8], data: &[u8]) -> Vec<u8> {
    let mut result = b"<< ".to_vec();
    result.extend_from_slice(dict);
    result.extend_from_slice(format!(" /Length {} >>\nstream\n", data.len()).as_bytes());
    result.extend_from_slice(data);
    result.extend_from_slice(b"\nendstream");
    result
}

pub fn two_pages(first: &[u8], second: &[u8], image: Option<Vec<u8>>) -> Vec<u8> {
    let resources = if image.is_some() {
        "/XObject << /Image 7 0 R >>"
    } else {
        ""
    };
    let mut objects = vec![
        b"<< /Type /Catalog /Pages 2 0 R >>".to_vec(),
        b"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>".to_vec(),
    ];
    for content in [5, 6] {
        objects.push(format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 60] /Resources << {resources} >> /Contents {content} 0 R >>").into_bytes());
    }
    objects.push(stream(b"", first));
    objects.push(stream(b"", second));
    if let Some(image) = image {
        objects.push(image);
    }
    serialize(&objects)
}

pub fn many_pages(count: usize) -> Vec<u8> {
    let kids = (3..3 + count)
        .map(|id| format!("{id} 0 R"))
        .collect::<Vec<_>>()
        .join(" ");
    let mut objects = vec![
        b"<< /Type /Catalog /Pages 2 0 R >>".to_vec(),
        format!("<< /Type /Pages /Kids [{kids}] /Count {count} >>").into_bytes(),
    ];
    for _ in 0..count {
        objects.push(format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 60] /Resources << >> /Contents {} 0 R >>", 3 + count).into_bytes());
    }
    objects.push(stream(b"", b""));
    serialize(&objects)
}

pub fn page_with_extra_entries(entries: &[u8]) -> Vec<u8> {
    let mut page = b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 60] /Contents 4 0 R ".to_vec();
    page.extend_from_slice(entries);
    page.extend_from_slice(b" >>");
    serialize(&[
        b"<< /Type /Catalog /Pages 2 0 R >>".to_vec(),
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_vec(),
        page,
        stream(b"", b"0 0 1 rg 10 10 80 40 re f"),
    ])
}

pub fn inherited_resources(font: &[u8], image: Option<Vec<u8>>) -> Vec<u8> {
    let mut parent = b"<< /Type /Pages /Kids [3 0 R] /Count 1 /Resources << /Font << /F1 ".to_vec();
    parent.extend_from_slice(font);
    parent.extend_from_slice(b" >> /XObject << ");
    if image.is_some() {
        parent.extend_from_slice(b"/Image 5 0 R");
    }
    parent.extend_from_slice(b" >> >> >>");
    let mut objects = vec![
        b"<< /Type /Catalog /Pages 2 0 R >>".to_vec(),
        parent,
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 60] /Contents 4 0 R >>".to_vec(),
        stream(
            b"",
            if image.is_some() {
                b"/Image Do"
            } else {
                b"BT /F1 12 Tf 10 25 Td (Hb 13.4) Tj ET"
            },
        ),
    ];
    objects.extend(image);
    serialize(&objects)
}

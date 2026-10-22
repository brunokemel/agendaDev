"""Export adapters for AgendaOneNote documents."""

import io
import zipfile
from html import escape

from documents import normalize_document
from parser import note_to_txt


EXPORT_MIMETYPES = {
    "txt": "text/plain",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pdf": "application/pdf",
}


def safe_filename(name):
    keep = "".join(c if c.isalnum() or c in " -_" else "_" for c in str(name or ""))
    return (keep.strip() or "nota")[:60]


def export_note(note, export_type):
    document = normalize_document(note)
    filename = safe_filename(document.get("title"))
    if export_type == "txt":
        content = note_to_txt(document).encode("utf-8")
    elif export_type == "docx":
        content = note_to_docx(document)
    elif export_type == "pdf":
        content = note_to_pdf(document)
    else:
        raise ValueError("Formato de exportacao invalido")
    return content, f"{filename}.{export_type}", EXPORT_MIMETYPES[export_type]


def note_to_docx(note):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as doc:
        doc.writestr("[Content_Types].xml", _docx_content_types())
        doc.writestr("_rels/.rels", _docx_root_rels())
        doc.writestr("word/document.xml", _docx_document(note))
    return buf.getvalue()


def _docx_content_types():
    return '''<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>'''


def _docx_root_rels():
    return '''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>'''


def _docx_paragraph(text, bold=False):
    value = escape(str(text or ""), quote=False)
    props = "<w:rPr><w:b/></w:rPr>" if bold else ""
    return f'<w:p><w:r>{props}<w:t xml:space="preserve">{value}</w:t></w:r></w:p>'


def _docx_document(note):
    lines = [
        (note.get("title") or "Sem titulo", True),
        (f"Importancia: {note.get('importance') or 'media'}", False),
    ]
    if note.get("due"):
        lines.append((f"Prazo: {note['due']}", False))
    if note.get("tags"):
        lines.append((f"Tags: {', '.join(note['tags'])}", False))
    lines.append(("", False))
    lines.extend((line, False) for line in (note.get("content") or "").splitlines())
    body = "".join(_docx_paragraph(text, bold) for text, bold in lines)
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>{body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body>
</w:document>'''


def _pdf_text(value):
    return (
        str(value or "")
        .encode("cp1252", errors="replace")
        .decode("cp1252")
        .replace("\\", "\\\\")
        .replace("(", "\\(")
        .replace(")", "\\)")
    )


def note_to_pdf(note):
    lines = [note.get("title") or "Sem titulo", "", f"Importancia: {note.get('importance') or 'media'}"]
    if note.get("due"):
        lines.append(f"Prazo: {note['due']}")
    if note.get("tags"):
        lines.append(f"Tags: {', '.join(note['tags'])}")
    lines += [""] + (note.get("content") or "").splitlines()
    pages, current = [], []
    for line in lines:
        chunks = [line[i:i + 92] for i in range(0, max(len(line), 1), 92)] or [""]
        for chunk in chunks:
            if len(current) == 48:
                pages.append(current)
                current = []
            current.append(chunk)
    pages.append(current)
    objects = ["<< /Type /Catalog /Pages 2 0 R >>", ""]
    page_ids = []
    for page in pages:
        content = ["BT", "/F1 11 Tf", "50 790 Td", "14 TL"]
        for index, line in enumerate(page):
            if index:
                content.append("T*")
            content.append(f"({_pdf_text(line)}) Tj")
        content.append("ET")
        stream = "\n".join(content).encode("cp1252", errors="replace")
        content_id = len(objects) + 1
        page_id = len(objects) + 2
        objects.append(f"<< /Length {len(stream)} >>\nstream\n{stream.decode('cp1252')}\nendstream")
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 FONT_ID 0 R >> >> /Contents {content_id} 0 R >>")
        page_ids.append(page_id)
    font_id = len(objects) + 1
    objects[1] = f"<< /Type /Pages /Kids [{' '.join(f'{page_id} 0 R' for page_id in page_ids)}] /Count {len(page_ids)} >>"
    for page_id in page_ids:
        objects[page_id - 1] = objects[page_id - 1].replace("FONT_ID", str(font_id))
    objects.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    result = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(result))
        result.extend(f"{index} 0 obj\n{obj}\nendobj\n".encode("cp1252", errors="replace"))
    startxref = len(result)
    result.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    result.extend("".join(f"{offset:010d} 00000 n \n" for offset in offsets[1:]).encode())
    result.extend(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{startxref}\n%%EOF".encode())
    return bytes(result)

import json
import os
import shutil
import sys
import uuid
from hashlib import sha256
from datetime import datetime
from pathlib import Path

from asset_store import AssetStore
from documents import apply_document_payload, normalize_document
from parser import extract_links, parse_txt_file


def _data_dir():
    if getattr(sys, "frozen", False):
        # Keep application data out of the Desktop (or any folder containing
        # the executable) while retaining a stable, user-specific location.
        base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / ".agenda_onenote"))
        dest = base / "AgendaOneNote" / "data"
        dest.mkdir(parents=True, exist_ok=True)
        return dest
    dest = Path(__file__).resolve().parent / "data"
    dest.mkdir(parents=True, exist_ok=True)
    return dest


DATA_DIR = _data_dir()
NOTES_FILE = DATA_DIR / "notes.json"
NOTEBOOKS_FILE = DATA_DIR / "notebooks.json"
TEXT_IMPORT_DIR = DATA_DIR / "entrada_txt"
IMPORTS_FILE = DATA_DIR / "imports.json"
ASSETS_DIR = DATA_DIR / "assets"
BACKUP_FORMAT_VERSION = 2


class BackupError(ValueError):
    pass


def get_asset_store():
    ensure_storage()
    return AssetStore(ASSETS_DIR)


def _now():
    return datetime.now().isoformat(timespec="seconds")


def ensure_storage():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    TEXT_IMPORT_DIR.mkdir(parents=True, exist_ok=True)
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    if not NOTES_FILE.exists():
        NOTES_FILE.write_text(
            json.dumps({"notes": []}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    if not NOTEBOOKS_FILE.exists():
        seed = {
            "notebooks": [
                {
                    "id": "nb-geral",
                    "name": "Geral",
                    "color": "#7c4dff",
                    "created_at": _now(),
                    "sections": [
                        {"id": "sec-notas", "name": "Notas", "created_at": _now()}
                    ],
                }
            ]
        }
        NOTEBOOKS_FILE.write_text(
            json.dumps(seed, ensure_ascii=False, indent=2), encoding="utf-8"
        )


def _write_json_atomic(path, payload):
    """Write JSON without leaving a partially-written data file behind."""
    path = Path(path)
    temp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temp, path)
    finally:
        if temp.exists():
            temp.unlink()


def _unique_backup_dir(parent, prefix="AgendaOneNote-backup"):
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    candidate = Path(parent) / f"{prefix}-{stamp}"
    counter = 2
    while candidate.exists():
        candidate = Path(parent) / f"{prefix}-{stamp}-{counter}"
        counter += 1
    return candidate


def _file_sha256(path):
    digest = sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _backup_file_hashes(root):
    root = Path(root)
    return {
        path.relative_to(root).as_posix(): _file_sha256(path)
        for path in sorted(root.rglob("*"))
        if path.is_file() and path.name != "manifest.json"
    }


def export_backup_folder(parent_dir):
    """Create a portable, versioned folder containing all agenda data."""
    ensure_storage()
    parent = Path(parent_dir)
    if not parent.is_dir():
        raise BackupError("Escolha uma pasta de destino valida")

    destination = _unique_backup_dir(parent)
    destination.mkdir()
    try:
        shutil.copy2(NOTES_FILE, destination / "notes.json")
        shutil.copy2(NOTEBOOKS_FILE, destination / "notebooks.json")
        if IMPORTS_FILE.exists():
            shutil.copy2(IMPORTS_FILE, destination / "imports.json")
        else:
            _write_json_atomic(destination / "imports.json", {})
        if TEXT_IMPORT_DIR.exists():
            shutil.copytree(TEXT_IMPORT_DIR, destination / "entrada_txt")
        else:
            (destination / "entrada_txt").mkdir()
        if ASSETS_DIR.exists():
            shutil.copytree(ASSETS_DIR, destination / "assets")
        else:
            (destination / "assets").mkdir()
        _write_json_atomic(
            destination / "manifest.json",
            {
                "application": "AgendaOneNote",
                "format_version": BACKUP_FORMAT_VERSION,
                "exported_at": _now(),
                "files": _backup_file_hashes(destination),
            },
        )
    except Exception:
        shutil.rmtree(destination, ignore_errors=True)
        raise
    return destination


def _read_backup(backup_dir):
    source = Path(backup_dir)
    if not source.is_dir():
        raise BackupError("Pasta de backup nao encontrada")
    required = ("manifest.json", "notes.json", "notebooks.json")
    if any(not (source / name).is_file() for name in required):
        raise BackupError("A pasta escolhida nao e um backup completo da Agenda OneNote")
    try:
        manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
        notes = json.loads((source / "notes.json").read_text(encoding="utf-8"))
        notebooks = json.loads((source / "notebooks.json").read_text(encoding="utf-8"))
        imports = json.loads((source / "imports.json").read_text(encoding="utf-8")) if (source / "imports.json").exists() else {}
    except (OSError, UnicodeError, json.JSONDecodeError) as err:
        raise BackupError("O backup contem um arquivo invalido ou corrompido") from err
    if manifest.get("application") != "AgendaOneNote":
        raise BackupError("A pasta escolhida nao pertence a Agenda OneNote")
    version = manifest.get("format_version")
    if not isinstance(version, int) or version < 1 or version > BACKUP_FORMAT_VERSION:
        raise BackupError("Esta versao do aplicativo nao reconhece o formato do backup")
    if not isinstance(notes, dict) or not isinstance(notes.get("notes"), list):
        raise BackupError("O arquivo de notas do backup e invalido")
    if not isinstance(notebooks, dict) or not isinstance(notebooks.get("notebooks"), list):
        raise BackupError("O arquivo de cadernos do backup e invalido")
    if not isinstance(imports, dict):
        raise BackupError("O registro de importacoes do backup e invalido")
    if version >= 2:
        expected_hashes = manifest.get("files")
        if not isinstance(expected_hashes, dict):
            raise BackupError("O manifesto do backup nao contem a lista de arquivos")
        actual_hashes = _backup_file_hashes(source)
        if expected_hashes != actual_hashes:
            raise BackupError("O backup foi alterado ou contem arquivos corrompidos")
    return source, notes, notebooks, imports, version


def _stage_directory(source, target, token):
    staged = DATA_DIR / f".{target.name}_restore_{token}"
    if source.is_dir():
        shutil.copytree(source, staged)
    else:
        staged.mkdir()
    return staged


def restore_backup_folder(backup_dir):
    """Validate and restore a backup, preserving a safety copy first."""
    source, notes, notebooks, imports, version = _read_backup(backup_dir)
    ensure_storage()
    safety_parent = DATA_DIR.parent / "backups_antes_de_restaurar"
    safety_parent.mkdir(parents=True, exist_ok=True)
    safety = export_backup_folder(safety_parent)

    incoming_text = source / "entrada_txt"
    incoming_assets = source / "assets"
    token = uuid.uuid4().hex
    staged_text = None
    staged_assets = None
    try:
        staged_text = _stage_directory(incoming_text, TEXT_IMPORT_DIR, token)
        staged_assets = _stage_directory(incoming_assets, ASSETS_DIR, token)
    except Exception:
        for staged in (staged_text, staged_assets):
            if staged and staged.exists():
                shutil.rmtree(staged)
        raise
    old_text = DATA_DIR / f".entrada_txt_old_{token}"
    old_assets = DATA_DIR / f".assets_old_{token}"
    original_files = {
        NOTES_FILE: NOTES_FILE.read_bytes(),
        NOTEBOOKS_FILE: NOTEBOOKS_FILE.read_bytes(),
        IMPORTS_FILE: IMPORTS_FILE.read_bytes() if IMPORTS_FILE.exists() else None,
    }
    try:
        if TEXT_IMPORT_DIR.exists():
            TEXT_IMPORT_DIR.rename(old_text)
        if ASSETS_DIR.exists():
            ASSETS_DIR.rename(old_assets)
        staged_text.rename(TEXT_IMPORT_DIR)
        staged_assets.rename(ASSETS_DIR)
        _write_json_atomic(NOTES_FILE, notes)
        _write_json_atomic(NOTEBOOKS_FILE, notebooks)
        _write_json_atomic(IMPORTS_FILE, imports)
    except Exception:
        if TEXT_IMPORT_DIR.exists():
            shutil.rmtree(TEXT_IMPORT_DIR)
        if ASSETS_DIR.exists():
            shutil.rmtree(ASSETS_DIR)
        if old_text.exists():
            old_text.rename(TEXT_IMPORT_DIR)
        if old_assets.exists():
            old_assets.rename(ASSETS_DIR)
        if staged_text.exists():
            shutil.rmtree(staged_text)
        if staged_assets.exists():
            shutil.rmtree(staged_assets)
        for path, content in original_files.items():
            if content is None:
                if path.exists():
                    path.unlink()
            else:
                path.write_bytes(content)
        raise
    if old_text.exists():
        shutil.rmtree(old_text, ignore_errors=True)
    if old_assets.exists():
        shutil.rmtree(old_assets, ignore_errors=True)
    return {
        "notes": len(notes["notes"]),
        "notebooks": len(notebooks["notebooks"]),
        "assets": sum(1 for path in ASSETS_DIR.rglob("*") if path.is_file()),
        "format_version": version,
        "safety_backup": str(safety),
    }


def import_txt_folder(default_notebook="Importados"):
    """Import new or changed .txt files placed in data/entrada_txt.

    A checksum registry prevents the same file version from creating duplicate
    notes every time the application starts.
    """
    ensure_storage()
    try:
        imported = json.loads(IMPORTS_FILE.read_text(encoding="utf-8")) if IMPORTS_FILE.exists() else {}
    except (json.JSONDecodeError, OSError):
        imported = {}

    created = []
    changed = False
    for path in sorted(TEXT_IMPORT_DIR.rglob("*.txt")):
        if not path.is_file():
            continue
        relative_name = path.relative_to(TEXT_IMPORT_DIR).as_posix()
        content_hash = sha256(path.read_bytes()).hexdigest()
        if imported.get(relative_name) == content_hash:
            continue
        parsed = parse_txt_file(path)
        for note in parsed:
            note["source_file"] = relative_name
        created.extend(import_parsed_notes(parsed, default_notebook=default_notebook))
        imported[relative_name] = content_hash
        changed = True

    if changed:
        IMPORTS_FILE.write_text(json.dumps(imported, ensure_ascii=False, indent=2), encoding="utf-8")
    return created


def load_notes():
    ensure_storage()
    with NOTES_FILE.open(encoding="utf-8") as f:
        data = json.load(f)
    return data.get("notes", [])


def save_notes(notes):
    ensure_storage()
    _write_json_atomic(NOTES_FILE, {"notes": notes})


def load_notebooks():
    ensure_storage()
    with NOTEBOOKS_FILE.open(encoding="utf-8") as f:
        data = json.load(f)
    return data.get("notebooks", [])


def save_notebooks(notebooks):
    ensure_storage()
    _write_json_atomic(NOTEBOOKS_FILE, {"notebooks": notebooks})


def find_or_create_notebook(name, color="#7c4dff"):
    notebooks = load_notebooks()
    name_norm = (name or "Geral").strip() or "Geral"
    for nb in notebooks:
        if nb["name"].lower() == name_norm.lower():
            return nb
    nb = {
        "id": "nb-" + uuid.uuid4().hex[:10],
        "name": name_norm,
        "color": color,
        "created_at": _now(),
        "sections": [{"id": "sec-" + uuid.uuid4().hex[:10], "name": "Notas", "created_at": _now()}],
    }
    notebooks.append(nb)
    save_notebooks(notebooks)
    return nb


def find_or_create_section(notebook, section_name):
    name_norm = (section_name or "Notas").strip() or "Notas"
    for sec in notebook.get("sections", []):
        if sec["name"].lower() == name_norm.lower():
            return notebook, sec
    sec = {
        "id": "sec-" + uuid.uuid4().hex[:10],
        "name": name_norm,
        "created_at": _now(),
    }
    notebook.setdefault("sections", []).append(sec)
    notebooks = load_notebooks()
    for i, nb in enumerate(notebooks):
        if nb["id"] == notebook["id"]:
            notebooks[i] = notebook
            break
    save_notebooks(notebooks)
    return notebook, sec


def enrich_note(note):
    note = normalize_document(note)
    note.setdefault("id", "nt-" + uuid.uuid4().hex[:12])
    note.setdefault("title", "Nota sem titulo")
    note.setdefault("content", "")
    note.setdefault("importance", "media")
    note.setdefault("tags", [])
    note.setdefault("pinned", False)
    note.setdefault("favorite", False)
    note.setdefault("parent_id", None)
    note.setdefault("layout", "flow")
    note.setdefault("archived", False)
    note.setdefault("color", "")
    note.setdefault("source_file", "")
    note.setdefault("created_at", _now())
    note["updated_at"] = note.get("updated_at") or _now()
    note["links"] = extract_links(note.get("content") or "")
    notebooks = load_notebooks()
    nb = next((n for n in notebooks if n["id"] == note.get("notebook_id")), None)
    sec = None
    if nb:
        sec = next((s for s in nb.get("sections", []) if s["id"] == note.get("section_id")), None)
        note["notebook_name"] = nb["name"]
        note["notebook_color"] = nb.get("color", "#7c4dff")
    else:
        note["notebook_name"] = "Geral"
        note["notebook_color"] = "#7c4dff"
    note["section_name"] = sec["name"] if sec else "Notas"
    return note


def get_note(note_id):
    for note in load_notes():
        if note["id"] == note_id:
            return enrich_note(note)
    return None


def upsert_note(payload):
    notes = load_notes()
    note_id = payload.get("id")
    existing = None
    idx = None
    if note_id:
        for i, n in enumerate(notes):
            if n["id"] == note_id:
                existing = n
                idx = i
                break
    notebook = find_or_create_notebook(payload.get("notebook") or payload.get("notebook_name") or "Geral")
    if payload.get("notebook_id"):
        notebooks = load_notebooks()
        found = next((n for n in notebooks if n["id"] == payload["notebook_id"]), None)
        if found:
            notebook = found
    notebook, section = find_or_create_section(notebook, payload.get("section") or payload.get("section_name") or "Notas")
    if payload.get("section_id"):
        found_sec = next((s for s in notebook.get("sections", []) if s["id"] == payload["section_id"]), None)
        if found_sec:
            section = found_sec

    now = _now()
    note = existing.copy() if existing else {}
    note.update(
        {
            "id": note_id or "nt-" + uuid.uuid4().hex[:12],
            "title": (payload.get("title") or "Nota sem titulo").strip(),
            "content": payload.get("content") or "",
            "importance": payload.get("importance") or "media",
            "tags": payload.get("tags") or [],
            "notebook_id": notebook["id"],
            "section_id": section["id"],
            "pinned": bool(payload.get("pinned", note.get("pinned", False))),
            "favorite": bool(payload.get("favorite", note.get("favorite", False))),
            "parent_id": payload.get("parent_id") or None,
            "layout": payload.get("layout") if payload.get("layout") in {"flow", "free"} else note.get("layout", "flow"),
            "archived": bool(payload.get("archived", note.get("archived", False))),
            "color": payload.get("color", note.get("color", "")),
            "date": payload.get("date") or note.get("date"),
            "due": payload.get("due") or note.get("due"),
            "source_file": payload.get("source_file", note.get("source_file", "")),
            "created_at": note.get("created_at") or now,
            "updated_at": now,
        }
    )
    note = apply_document_payload(note, payload)
    note = enrich_note(note)
    if idx is not None:
        notes[idx] = note
    else:
        notes.insert(0, note)
    save_notes(notes)
    return note


def delete_note(note_id):
    notes = load_notes()
    new_notes = [n for n in notes if n["id"] != note_id]
    if len(new_notes) == len(notes):
        return False
    save_notes(new_notes)
    return True


def import_parsed_notes(parsed_list, default_notebook="Geral"):
    created = []
    for item in parsed_list:
        payload = {
            "title": item.get("title"),
            "content": item.get("content"),
            "importance": item.get("importance") or "media",
            "tags": item.get("tags") or [],
            "notebook": item.get("notebook") or default_notebook,
            "section": item.get("section") or "Notas",
            "date": item.get("date"),
            "due": item.get("due"),
            "source_file": item.get("source_file", ""),
        }
        created.append(upsert_note(payload))
    return created


def create_notebook(name, color="#7c4dff"):
    return find_or_create_notebook(name, color)


def create_section(notebook_id, name):
    notebooks = load_notebooks()
    nb = next((n for n in notebooks if n["id"] == notebook_id), None)
    if not nb:
        return None, None
    nb, sec = find_or_create_section(nb, name)
    return nb, sec


def rename_notebook(notebook_id, name=None, color=None):
    notebooks = load_notebooks()
    for nb in notebooks:
        if nb["id"] == notebook_id:
            if name:
                nb["name"] = name.strip()
            if color:
                nb["color"] = color
            save_notebooks(notebooks)
            return nb
    return None


def search_notes(query="", importance="", notebook_id="", tag=""):
    query = (query or "").strip().lower()
    results = []
    for note in load_notes():
        note = enrich_note(note)
        if note.get("archived"):
            continue
        if importance and note.get("importance") != importance:
            continue
        if notebook_id and note.get("notebook_id") != notebook_id:
            continue
        if tag and tag.lower() not in [t.lower() for t in note.get("tags") or []]:
            continue
        if query:
            hay = " ".join(
                [
                    note.get("title") or "",
                    note.get("content") or "",
                    " ".join(note.get("tags") or []),
                    note.get("notebook_name") or "",
                    note.get("section_name") or "",
                    note.get("source_file") or "",
                ]
            ).lower()
            if query not in hay:
                continue
        results.append(note)
    importance_rank = {"urgente": 0, "alta": 1, "media": 2, "baixa": 3}

    def sort_key(n):
        return (
            0 if n.get("pinned") else 1,
            importance_rank.get(n.get("importance"), 9),
            -(datetime_ts(n.get("updated_at"))),
        )

    results.sort(key=sort_key)
    return results


def datetime_ts(value):
    if not value:
        return 0
    try:
        return datetime.fromisoformat(value).timestamp()
    except Exception:
        return 0


def stats():
    notes = [enrich_note(n) for n in load_notes() if not n.get("archived")]
    by_imp = {"urgente": 0, "alta": 0, "media": 0, "baixa": 0}
    by_nb = {}
    tags = {}
    links = 0
    for n in notes:
        by_imp[n.get("importance", "media")] = by_imp.get(n.get("importance", "media"), 0) + 1
        name = n.get("notebook_name") or "Geral"
        by_nb[name] = by_nb.get(name, 0) + 1
        for t in n.get("tags") or []:
            tags[t] = tags.get(t, 0) + 1
        links += len(n.get("links") or [])
    return {
        "total": len(notes),
        "by_importance": by_imp,
        "by_notebook": by_nb,
        "tags": tags,
        "links": links,
        "pinned": sum(1 for n in notes if n.get("pinned")),
    }

import io
import json
import os
import socket
import sys
from datetime import datetime
from pathlib import Path
from threading import Thread

from flask import Flask, jsonify, render_template, request, send_file
from werkzeug.serving import make_server
import webview

from exporters import export_note
from parser import parse_txt, parse_txt_file
from reports import generate_html_report, generate_txt_report
from storage import (
    BackupError,
    create_notebook,
    create_section,
    delete_note,
    export_backup_folder,
    get_note,
    import_parsed_notes,
    import_txt_folder,
    load_notebooks,
    rename_notebook,
    restore_backup_folder,
    search_notes,
    stats,
    upsert_note,
)


def resource_path(relative):
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / relative
    return Path(__file__).resolve().parent / relative


def writable_path(relative):
    if getattr(sys, "frozen", False):
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".agenda_onenote")
        dest = base / "AgendaOneNote" / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        return dest
    return Path(__file__).resolve().parent / relative


ROOT = resource_path(".")
app = Flask(
    __name__,
    template_folder=str(resource_path("templates")),
    static_folder=str(resource_path("static")),
)
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024
desktop_window = None


@app.after_request
def no_cache(resp):
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/logo.png")
def logo():
    return send_file(resource_path("logoNova.png"), mimetype="image/png")


@app.route("/api/notes")
def api_notes():
    q = request.args.get("q", "")
    importance = request.args.get("importance", "")
    notebook_id = request.args.get("notebook_id", "")
    tag = request.args.get("tag", "")
    return jsonify({"notes": search_notes(q, importance, notebook_id, tag)})


@app.route("/api/notes/<note_id>")
def api_note(note_id):
    note = get_note(note_id)
    if not note:
        return jsonify({"error": "Nota nao encontrada"}), 404
    return jsonify({"note": note})


@app.route("/api/notes", methods=["POST"])
def api_create_note():
    payload = request.get_json(force=True, silent=True) or {}
    note = upsert_note(payload)
    return jsonify({"note": note}), 201


@app.route("/api/notes/<note_id>", methods=["PUT"])
def api_update_note(note_id):
    payload = request.get_json(force=True, silent=True) or {}
    payload["id"] = note_id
    if not get_note(note_id):
        return jsonify({"error": "Nota nao encontrada"}), 404
    note = upsert_note(payload)
    return jsonify({"note": note})


@app.route("/api/notes/<note_id>", methods=["DELETE"])
def api_delete_note(note_id):
    if not delete_note(note_id):
        return jsonify({"error": "Nota nao encontrada"}), 404
    return jsonify({"ok": True})


@app.route("/api/notebooks")
def api_notebooks():
    return jsonify({"notebooks": load_notebooks()})


@app.route("/api/notebooks", methods=["POST"])
def api_create_notebook():
    payload = request.get_json(force=True, silent=True) or {}
    nb = create_notebook(payload.get("name") or "Novo caderno", payload.get("color") or "#7c4dff")
    return jsonify({"notebook": nb}), 201


@app.route("/api/notebooks/<notebook_id>", methods=["PUT"])
def api_rename_notebook(notebook_id):
    payload = request.get_json(force=True, silent=True) or {}
    nb = rename_notebook(notebook_id, payload.get("name"), payload.get("color"))
    if not nb:
        return jsonify({"error": "Caderno nao encontrado"}), 404
    return jsonify({"notebook": nb})


@app.route("/api/notebooks/<notebook_id>/sections", methods=["POST"])
def api_create_section(notebook_id):
    payload = request.get_json(force=True, silent=True) or {}
    nb, sec = create_section(notebook_id, payload.get("name") or "Nova secao")
    if not nb:
        return jsonify({"error": "Caderno nao encontrado"}), 404
    return jsonify({"notebook": nb, "section": sec}), 201


@app.route("/api/import-txt", methods=["POST"])
def api_import_txt():
    default_nb = request.form.get("notebook") or "Importados"
    notes = []
    if "file" in request.files:
        f = request.files["file"]
        text = f.read().decode("utf-8", errors="replace")
        notes = parse_txt(text, source_file=f.filename or "upload.txt")
    else:
        payload = request.get_json(force=True, silent=True) or {}
        text = payload.get("text") or ""
        name = payload.get("filename") or "colar.txt"
        default_nb = payload.get("notebook") or default_nb
        notes = parse_txt(text, source_file=name)
    created = import_parsed_notes(notes, default_notebook=default_nb)
    return jsonify({"imported": len(created), "notes": created})


@app.route("/api/import-path", methods=["POST"])
def api_import_path():
    payload = request.get_json(force=True, silent=True) or {}
    path = payload.get("path")
    if not path or not Path(path).exists():
        return jsonify({"error": "Arquivo nao encontrado"}), 400
    notes = parse_txt_file(path)
    created = import_parsed_notes(notes, default_notebook=payload.get("notebook") or "Importados")
    return jsonify({"imported": len(created), "notes": created})


@app.route("/api/import-folder", methods=["POST"])
def api_import_folder():
    created = import_txt_folder()
    return jsonify({"imported": len(created), "notes": created})


@app.route("/api/export/<note_id>.txt")
def api_export_txt(note_id):
    note = get_note(note_id)
    if not note:
        return jsonify({"error": "Nota nao encontrada"}), 404
    content, filename, mimetype = export_note(note, "txt")
    return send_file(io.BytesIO(content), as_attachment=True, download_name=filename, mimetype=mimetype)


@app.route("/api/export/<note_id>.docx")
def api_export_docx(note_id):
    note = get_note(note_id)
    if not note:
        return jsonify({"error": "Nota nao encontrada"}), 404
    content, filename, mimetype = export_note(note, "docx")
    return send_file(
        io.BytesIO(content),
        as_attachment=True,
        download_name=filename,
        mimetype=mimetype,
    )


@app.route("/api/export/<note_id>.pdf")
def api_export_pdf(note_id):
    note = get_note(note_id)
    if not note:
        return jsonify({"error": "Nota nao encontrada"}), 404
    content, filename, mimetype = export_note(note, "pdf")
    return send_file(
        io.BytesIO(content),
        as_attachment=True,
        download_name=filename,
        mimetype=mimetype,
    )


@app.route("/api/export.json")
def api_export_json():
    from storage import load_notes

    payload = {
        "exported_at": datetime.now().isoformat(timespec="seconds"),
        "notebooks": load_notebooks(),
        "notes": load_notes(),
    }
    buf = io.BytesIO(json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8"))
    return send_file(
        buf,
        as_attachment=True,
        download_name="agenda-backup.json",
        mimetype="application/json",
    )


@app.route("/api/stats")
def api_stats():
    return jsonify(stats())


@app.route("/api/report.html")
def api_report_html():
    html = generate_html_report()
    buf = io.BytesIO(html.encode("utf-8"))
    return send_file(
        buf,
        as_attachment=True,
        download_name=f"relatorio-agenda-{datetime.now().strftime('%Y%m%d')}.html",
        mimetype="text/html",
    )


@app.route("/api/report.txt")
def api_report_txt():
    text = generate_txt_report()
    buf = io.BytesIO(text.encode("utf-8"))
    return send_file(
        buf,
        as_attachment=True,
        download_name=f"relatorio-agenda-{datetime.now().strftime('%Y%m%d')}.txt",
        mimetype="text/plain",
    )


class DesktopApi:
    def export_agenda_backup(self):
        selected = desktop_window.create_file_dialog(webview.FileDialog.FOLDER)
        if not selected:
            return {"ok": False, "cancelled": True}
        try:
            path = export_backup_folder(selected[0])
            return {"ok": True, "path": str(path)}
        except (BackupError, OSError) as err:
            return {"ok": False, "error": str(err)}

    def restore_agenda_backup(self):
        selected = desktop_window.create_file_dialog(webview.FileDialog.FOLDER)
        if not selected:
            return {"ok": False, "cancelled": True}
        try:
            result = restore_backup_folder(selected[0])
            return {"ok": True, **result}
        except (BackupError, OSError) as err:
            return {"ok": False, "error": str(err)}

    def save_note_export(self, note_id, export_type):
        note = get_note(note_id)
        if not note:
            return {"ok": False, "error": "Nota nao encontrada"}
        try:
            content, filename, _ = export_note(note, export_type)
        except ValueError as err:
            return {"ok": False, "error": str(err)}
        filters = {
            "txt": ("Texto (*.txt)",),
            "docx": ("Documento do Word (*.docx)",),
            "pdf": ("Documento PDF (*.pdf)",),
        }
        path = desktop_window.create_file_dialog(
            webview.FileDialog.SAVE,
            save_filename=filename,
            file_types=filters[export_type],
        )
        if not path:
            return {"ok": False, "cancelled": True}
        Path(path[0]).write_bytes(content)
        return {"ok": True, "path": str(path[0])}

def _available_port(host):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        return sock.getsockname()[1]


def main():
    import_txt_folder()
    host = os.environ.get("HOST", "127.0.0.1")
    port = _available_port(host)
    server = make_server(host, port, app)
    Thread(target=server.serve_forever, daemon=True).start()

    global desktop_window
    desktop_window = webview.create_window(
        "agendaDev",
        f"http://{host}:{port}",
        width=1400,
        height=900,
        min_size=(900, 600),
        js_api=DesktopApi(),
    )
    try:
        webview.start(gui="edgechromium", icon=str(resource_path("logoNova.ico")))
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()

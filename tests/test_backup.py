import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import storage


class BackupTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.data = self.root / "data"
        self.paths = patch.multiple(
            storage,
            DATA_DIR=self.data,
            NOTES_FILE=self.data / "notes.json",
            NOTEBOOKS_FILE=self.data / "notebooks.json",
            TEXT_IMPORT_DIR=self.data / "entrada_txt",
            IMPORTS_FILE=self.data / "imports.json",
            ASSETS_DIR=self.data / "assets",
        )
        self.paths.start()
        storage.ensure_storage()

    def tearDown(self):
        self.paths.stop()
        self.temp.cleanup()

    def test_export_and_restore_complete_folder(self):
        notebooks = {
            "notebooks": [{"id": "nb-1", "name": "Historico", "sections": []}]
        }
        notes = {"notes": [{"id": "nt-1", "title": "Registro antigo"}]}
        storage._write_json_atomic(storage.NOTEBOOKS_FILE, notebooks)
        storage._write_json_atomic(storage.NOTES_FILE, notes)
        storage._write_json_atomic(storage.IMPORTS_FILE, {"arquivo.txt": "hash"})
        (storage.TEXT_IMPORT_DIR / "arquivo.txt").write_text("conteudo", encoding="utf-8")
        image = b"\x89PNG\r\n\x1a\nimagem"
        asset = storage.get_asset_store().store_bytes(image, "foto.png", "image/png")

        exports = self.root / "exports"
        exports.mkdir()
        backup = storage.export_backup_folder(exports)

        storage._write_json_atomic(storage.NOTES_FILE, {"notes": []})
        (storage.TEXT_IMPORT_DIR / "arquivo.txt").write_text("alterado", encoding="utf-8")
        (storage.ASSETS_DIR / asset["path"]).write_bytes(b"alterada")
        result = storage.restore_backup_folder(backup)

        restored = json.loads(storage.NOTES_FILE.read_text(encoding="utf-8"))
        self.assertEqual(restored, notes)
        self.assertEqual((storage.TEXT_IMPORT_DIR / "arquivo.txt").read_text(encoding="utf-8"), "conteudo")
        self.assertEqual((storage.ASSETS_DIR / asset["path"]).read_bytes(), image)
        self.assertEqual(result["notes"], 1)
        self.assertEqual(result["format_version"], 2)
        self.assertEqual(result["assets"], 1)
        self.assertTrue(Path(result["safety_backup"]).is_dir())

    def test_restore_accepts_v1_and_clears_unrepresented_assets(self):
        legacy = self.root / "legacy-v1"
        legacy.mkdir()
        (legacy / "entrada_txt").mkdir()
        storage._write_json_atomic(
            legacy / "manifest.json",
            {"application": "AgendaOneNote", "format_version": 1},
        )
        storage._write_json_atomic(legacy / "notes.json", {"notes": [{"id": "old", "title": "V1"}]})
        storage._write_json_atomic(legacy / "notebooks.json", {"notebooks": []})
        storage.get_asset_store().store_bytes(b"\x89PNG\r\n\x1a\nimagem", "foto.png", "image/png")

        result = storage.restore_backup_folder(legacy)

        self.assertEqual(result["format_version"], 1)
        self.assertEqual(result["assets"], 0)
        self.assertEqual(storage.load_notes()[0]["title"], "V1")

    def test_restore_rejects_corrupted_v2_backup(self):
        exports = self.root / "exports"
        exports.mkdir()
        backup = storage.export_backup_folder(exports)
        (backup / "notes.json").write_text('{"notes":[{"title":"alterada"}]}', encoding="utf-8")

        with self.assertRaises(storage.BackupError):
            storage.restore_backup_folder(backup)

    def test_restore_rejects_unrecognized_folder_without_changing_data(self):
        original = storage.NOTES_FILE.read_text(encoding="utf-8")
        invalid = self.root / "nao-e-backup"
        invalid.mkdir()

        with self.assertRaises(storage.BackupError):
            storage.restore_backup_folder(invalid)

        self.assertEqual(storage.NOTES_FILE.read_text(encoding="utf-8"), original)


if __name__ == "__main__":
    unittest.main()

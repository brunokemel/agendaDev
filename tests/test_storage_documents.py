import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import storage
from documents import DOCUMENT_SCHEMA_VERSION


class StorageDocumentTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.data = Path(self.temp.name) / "data"
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

    def test_upsert_persists_versioned_document_and_keeps_legacy_content(self):
        note = storage.upsert_note({"title": "Compatível", "content": "linha 1\nlinha 2"})
        persisted = storage.load_notes()[0]

        self.assertEqual(note["schema_version"], DOCUMENT_SCHEMA_VERSION)
        self.assertEqual(note["blocks"][0]["text"], "linha 1\nlinha 2")
        self.assertEqual(persisted["content"], "linha 1\nlinha 2")
        self.assertEqual(persisted["schema_version"], DOCUMENT_SCHEMA_VERSION)

    def test_block_payload_is_searchable_by_legacy_search(self):
        note = storage.upsert_note(
            {
                "title": "Blocos",
                "blocks": [{"id": "b1", "type": "paragraph", "text": "conteudo pesquisavel"}],
            }
        )

        found = storage.search_notes("pesquisavel")
        self.assertEqual([item["id"] for item in found], [note["id"]])

    def test_favorite_and_parent_are_persisted(self):
        parent = storage.upsert_note({"title": "Pagina principal"})
        child = storage.upsert_note(
            {"title": "Subpagina", "favorite": True, "parent_id": parent["id"]}
        )

        loaded = storage.get_note(child["id"])
        self.assertTrue(loaded["favorite"])
        self.assertEqual(loaded["parent_id"], parent["id"])

        updated = storage.upsert_note(
            {"id": child["id"], "title": child["title"], "favorite": False, "parent_id": None}
        )
        self.assertFalse(updated["favorite"])
        self.assertIsNone(updated["parent_id"])

    def test_supported_blocks_round_trip_and_keep_searchable_content(self):
        blocks = [
            {"id": "h1", "type": "heading_1", "text": "Plano semanal"},
            {"id": "p1", "type": "paragraph", "text": "Conteudo pesquisavel"},
            {"id": "c1", "type": "checklist", "text": "Revisar agenda", "checked": True},
            {"id": "q1", "type": "quote", "text": "Fazer simples"},
            {"id": "d1", "type": "divider", "text": ""},
        ]
        note = storage.upsert_note({"title": "Blocos MVP", "blocks": blocks})

        loaded = storage.get_note(note["id"])
        self.assertEqual(loaded["blocks"], blocks)
        self.assertIn("Plano semanal", loaded["content"])
        self.assertIn("[x] Revisar agenda", loaded["content"])
        self.assertIn("---", loaded["content"])
        self.assertEqual(storage.search_notes("pesquisavel")[0]["id"], note["id"])


if __name__ == "__main__":
    unittest.main()

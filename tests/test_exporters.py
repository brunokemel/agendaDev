import json
import unittest
import zipfile
from io import BytesIO
from pathlib import Path

from exporters import export_note


FIXTURES = Path(__file__).parent / "fixtures"


class ExporterTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.note = json.loads((FIXTURES / "sample_note.json").read_text(encoding="utf-8"))

    def test_txt_matches_golden_file(self):
        content, filename, mimetype = export_note(self.note, "txt")
        expected = (FIXTURES / "sample_note.txt").read_bytes().rstrip(b"\r\n")

        self.assertEqual(content, expected)
        self.assertEqual(filename, "Reunião Produto.txt")
        self.assertEqual(mimetype, "text/plain")

    def test_docx_contains_expected_document_xml(self):
        content, filename, _ = export_note(self.note, "docx")
        with zipfile.ZipFile(BytesIO(content)) as archive:
            xml = archive.read("word/document.xml").decode("utf-8")

        self.assertIn("Reunião Produto", xml)
        self.assertIn("Segunda linha com acentuação.", xml)
        self.assertEqual(filename, "Reunião Produto.docx")

    def test_pdf_has_valid_markers_and_content(self):
        content, filename, mimetype = export_note(self.note, "pdf")

        self.assertTrue(content.startswith(b"%PDF-1.4"))
        self.assertTrue(content.endswith(b"%%EOF"))
        self.assertIn("Reunião Produto".encode("cp1252"), content)
        self.assertEqual(filename, "Reunião Produto.pdf")
        self.assertEqual(mimetype, "application/pdf")


if __name__ == "__main__":
    unittest.main()

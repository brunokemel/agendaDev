import unittest

from documents import (
    DOCUMENT_SCHEMA_VERSION,
    apply_document_payload,
    blocks_to_plain_text,
    normalize_document,
)


class DocumentModelTest(unittest.TestCase):
    def test_legacy_content_is_preserved_losslessly(self):
        content = "linha 1\n\nlinha 3"
        document = normalize_document({"title": "Legada", "content": content})

        self.assertEqual(document["schema_version"], DOCUMENT_SCHEMA_VERSION)
        self.assertEqual(document["blocks"][0]["text"], content)
        self.assertEqual(blocks_to_plain_text(document["blocks"]), content)

    def test_block_payload_updates_legacy_content(self):
        document = apply_document_payload(
            {"content": "antigo"},
            {
                "blocks": [
                    {"id": "a", "type": "paragraph", "text": "Titulo"},
                    {"id": "b", "type": "checklist", "text": "Tarefa", "checked": True},
                ]
            },
        )

        self.assertEqual(document["content"], "Titulo\n[x] Tarefa")
        self.assertEqual(document["schema_version"], DOCUMENT_SCHEMA_VERSION)


if __name__ == "__main__":
    unittest.main()

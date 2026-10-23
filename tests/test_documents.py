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

    def test_image_block_keeps_asset_metadata_and_searchable_caption(self):
        document = apply_document_payload(
            {},
            {
                "blocks": [
                    {
                        "id": "img",
                        "type": "image",
                        "text": "Diagrama da arquitetura",
                        "asset": {"id": "a" * 64, "filename": "diagrama.png", "mime": "image/png"},
                        "width": 60,
                        "align": "right",
                        "crop": {"ratio": "landscape", "zoom": 140, "x": 35, "y": 65},
                    }
                ]
            },
        )

        self.assertEqual(document["blocks"][0]["asset"]["filename"], "diagrama.png")
        self.assertEqual(document["blocks"][0]["width"], 60)
        self.assertEqual(document["blocks"][0]["align"], "right")
        self.assertEqual(document["blocks"][0]["crop"]["zoom"], 140)
        self.assertEqual(document["content"], "[Imagem: diagrama.png] Diagrama da arquitetura")

    def test_shape_block_keeps_geometry_position_and_text(self):
        block = {
            "id": "shape-1",
            "type": "shape",
            "text": "Aprovar pedido",
            "shape": {"kind": "diamond"},
            "position": {"x": 120, "y": 80, "w": 260, "h": 150},
        }
        document = apply_document_payload({}, {"blocks": [block]})

        self.assertEqual(document["blocks"][0], block)
        self.assertEqual(document["content"], "Aprovar pedido")


if __name__ == "__main__":
    unittest.main()

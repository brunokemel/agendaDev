import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app as agenda_app
from asset_store import AssetStore


class AssetApiTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = AssetStore(Path(self.temp.name) / "assets")
        self.store_patch = patch.object(agenda_app, "get_asset_store", return_value=self.store)
        self.store_patch.start()
        self.client = agenda_app.app.test_client()

    def tearDown(self):
        self.store_patch.stop()
        self.temp.cleanup()

    def test_upload_and_read_image(self):
        image = b"\x89PNG\r\n\x1a\nconteudo"
        response = self.client.post(
            "/api/assets",
            data={"file": (io.BytesIO(image), "foto.png")},
            content_type="multipart/form-data",
        )

        self.assertEqual(response.status_code, 201)
        asset = response.get_json()["asset"]
        self.assertNotIn(str(self.store.root), str(asset))
        read = self.client.get(asset["url"])
        self.assertEqual(read.status_code, 200)
        self.assertEqual(read.data, image)
        self.assertEqual(read.mimetype, "image/png")

        duplicate = self.client.post(
            "/api/assets",
            data={"file": (io.BytesIO(image), "copia.png")},
            content_type="multipart/form-data",
        )
        self.assertEqual(duplicate.get_json()["asset"]["id"], asset["id"])
        self.assertEqual(len(list(self.store.root.rglob("*.png"))), 1)

    def test_rejects_spoofed_or_missing_image(self):
        missing = self.client.post("/api/assets", data={}, content_type="multipart/form-data")
        spoofed = self.client.post(
            "/api/assets",
            data={"file": (io.BytesIO(b"nao e imagem"), "foto.png")},
            content_type="multipart/form-data",
        )

        self.assertEqual(missing.status_code, 400)
        self.assertEqual(spoofed.status_code, 400)

        pdf = self.client.post(
            "/api/assets",
            data={"file": (io.BytesIO(b"%PDF-1.4"), "arquivo.pdf")},
            content_type="multipart/form-data",
        )
        self.assertEqual(pdf.status_code, 400)
        self.assertEqual(len(list(self.store.root.rglob("*.pdf"))), 0)


if __name__ == "__main__":
    unittest.main()

import tempfile
import unittest
from pathlib import Path

from asset_store import AssetError, AssetStore


class AssetStoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = AssetStore(Path(self.temp.name) / "assets", max_bytes=16)

    def tearDown(self):
        self.temp.cleanup()

    def test_store_is_content_addressed_and_deduplicated(self):
        image = b"\x89PNG\r\n\x1a\nimg"
        first = self.store.store_bytes(image, "foto.png", "image/png")
        second = self.store.store_bytes(image, "outra.png", "image/png")

        self.assertEqual(first["id"], second["id"])
        self.assertEqual(len(list(self.store.root.rglob("*.png"))), 1)
        self.assertEqual(self.store.resolve(first["path"]).read_bytes(), image)

    def test_rejects_large_or_unsupported_assets(self):
        with self.assertRaises(AssetError):
            self.store.store_bytes(b"\x89PNG\r\n\x1a\n" + b"x" * 17, "grande.png", "image/png")
        with self.assertRaises(AssetError):
            self.store.store_bytes(b"conteudo", "programa.exe", "application/octet-stream")

    def test_rejects_mime_spoofing(self):
        with self.assertRaises(AssetError):
            self.store.store_bytes(b"nao e png", "foto.png", "image/png")

    def test_resolve_rejects_path_escape(self):
        with self.assertRaises(AssetError):
            self.store.resolve("../fora.png")


if __name__ == "__main__":
    unittest.main()

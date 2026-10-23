import unittest
from unittest.mock import patch

from app import DesktopApi


class DesktopApiTest(unittest.TestCase):
    @patch("app.webbrowser.open", return_value=True)
    def test_open_external_accepts_http_links(self, mocked_open):
        result = DesktopApi().open_external("https://example.com/documento")

        self.assertTrue(result["ok"])
        mocked_open.assert_called_once_with("https://example.com/documento", new=2)

    @patch("app.webbrowser.open")
    def test_open_external_rejects_unsafe_schemes(self, mocked_open):
        result = DesktopApi().open_external("javascript:alert(1)")

        self.assertFalse(result["ok"])
        mocked_open.assert_not_called()


if __name__ == "__main__":
    unittest.main()

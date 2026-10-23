import unittest

from app import app


class InterfaceTest(unittest.TestCase):
    def test_shape_palette_and_editor_resizer_are_served(self):
        response = app.test_client().get("/")
        html = response.get_data(as_text=True)

        self.assertEqual(response.status_code, 200)
        self.assertIn('id="shape-menu"', html)
        self.assertIn('data-shape="diamond"', html)
        self.assertIn('data-shape="arrow"', html)
        self.assertIn('id="editor-resizer"', html)


if __name__ == "__main__":
    unittest.main()

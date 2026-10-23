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
        client = app.test_client()
        block_editor = client.get("/static/js/block-editor.js").get_data(as_text=True)
        app_js = client.get("/static/js/app.js").get_data(as_text=True)
        self.assertIn("startShapeDrawing(event)", block_editor)
        self.assertIn('data-shape-handle="${corner}"', block_editor)
        self.assertIn("activateShapeTool(option.dataset.shape)", app_js)
        self.assertIn('id="editor-resizer"', html)


if __name__ == "__main__":
    unittest.main()

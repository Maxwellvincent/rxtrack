import ast
import pathlib
import re
import unittest


SOURCE = pathlib.Path(__file__).with_name("__init__.py").read_text()
TREE = ast.parse(SOURCE)
NAMES = {"_media_markup", "_rewrite_fields", "_rewrite_prompt"}
SELECTED = [node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name in NAMES]
NAMESPACE = {"re": re, "json": __import__("json")}
exec(compile(ast.Module(body=SELECTED, type_ignores=[]), "helpers", "exec"), NAMESPACE)


class FakeNote(dict):
    def __init__(self, model_name, **fields):
        super().__init__(fields)
        self.model_name = model_name

    def note_type(self):
        return {"name": self.model_name}


class RewriteHelperTests(unittest.TestCase):
    def test_media_markup_preserves_unique_media(self):
        text = '<img src="a.png"><br>[sound:x.mp3]<img src="a.png"><audio src="b.mp3">'
        self.assertEqual(
            NAMESPACE["_media_markup"](text),
            '<img src="a.png"><audio src="b.mp3">[sound:x.mp3]',
        )

    def test_basic_note_is_eligible(self):
        note = FakeNote("Basic+++", Front="Question", Back="Answer")
        self.assertEqual(NAMESPACE["_rewrite_fields"](note), ("Front", "Back"))

    def test_cloze_and_image_occlusion_are_protected(self):
        cloze = FakeNote("Cloze++++++++", Text="{{c1::x}}", Extra="")
        image = FakeNote("Image Occlusion Enhanced", Header="", Image="")
        self.assertIsNone(NAMESPACE["_rewrite_fields"](cloze))
        self.assertIsNone(NAMESPACE["_rewrite_fields"](image))

    def test_prompt_requires_one_target_and_causal_anchor(self):
        prompt = NAMESPACE["_rewrite_prompt"]({"packed": "card"}, {"concept": "ovulation"})
        self.assertIn("one primary retrieval target", prompt)
        self.assertIn("what it is + what it does + what it connects to", prompt)
        self.assertIn("mental_map_anchor", prompt)


if __name__ == "__main__":
    unittest.main()

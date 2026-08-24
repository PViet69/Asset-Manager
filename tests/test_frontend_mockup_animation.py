import re
import unittest
from pathlib import Path


MOCKUP = Path(__file__).parents[1] / "frontend-mockup.html"


class SearchResultAnimationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = MOCKUP.read_text(encoding="utf-8")

    def test_search_hits_have_top_to_bottom_stagger(self):
        self.assertIn("@keyframes search-hit-enter", self.source)
        self.assertRegex(
            self.source,
            re.compile(
                r"#panel-search \.list\.is-entering li\s*\{[^}]*"
                r"animation-delay:\s*calc\(var\(--result-index\) \* 70ms\)",
                re.DOTALL,
            ),
        )
        self.assertIn("--result-index", self.source)

    def test_animation_replays_from_tab_and_search_button(self):
        self.assertIn("function animateSearchResults()", self.source)
        self.assertIn("if (t.dataset.tab === 'search')", self.source)
        self.assertRegex(
            self.source,
            r"searchButton\.addEventListener\('click', animateSearchResults\)",
        )

    def test_reduced_motion_disables_search_hit_animation(self):
        self.assertIn("@media (prefers-reduced-motion: reduce)", self.source)
        self.assertIn(
            "#panel-search .list.is-entering li { animation: none; }",
            self.source,
        )


if __name__ == "__main__":
    unittest.main()

"""Checked-in prompts for structured model calls."""

CAPTIONING_PROMPT = """
Analyze this image for semantic retrieval.
Report visible, factual details only.
Do not infer unsupported identity, intent, or hidden information.
Follow the response-model field descriptions and object, dont make
your own object.
""".strip()

VIDEO_CAPTIONING_PROMPT = """
Analyze this whole video for semantic retrieval.
Report visible, factual details only across its complete duration.
Do not infer unsupported identity, intent, or hidden information.
Follow the response-model field descriptions and object, dont make
your own object.
""".strip()

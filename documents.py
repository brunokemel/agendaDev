"""Canonical, versioned document helpers.

The current UI still edits a single text field.  This module creates a stable
bridge to the future block editor without forcing an eager data migration.
"""

from copy import deepcopy


DOCUMENT_SCHEMA_VERSION = 1


def legacy_content_to_blocks(content):
    """Represent legacy plain text losslessly as a single paragraph block."""
    return [
        {
            "id": "legacy-content",
            "type": "paragraph",
            "text": str(content or ""),
        }
    ]


def blocks_to_plain_text(blocks):
    """Render the supported block subset to plain text for legacy consumers."""
    rendered = []
    for block in blocks or []:
        if not isinstance(block, dict):
            continue
        block_type = block.get("type") or "paragraph"
        text = str(block.get("text") or "")
        if block_type == "divider":
            rendered.append("---")
        elif block_type == "checklist":
            rendered.append(f"[{'x' if block.get('checked') else ' '}] {text}")
        elif block_type == "bulleted_list":
            rendered.append(f"- {text}")
        elif block_type == "numbered_list":
            rendered.append(f"{block.get('number') or 1}. {text}")
        else:
            rendered.append(text)
    return "\n".join(rendered)


def normalize_document(note):
    """Return a copy with the canonical schema while preserving legacy text."""
    document = deepcopy(note or {})
    blocks = document.get("blocks")
    if not isinstance(blocks, list):
        blocks = legacy_content_to_blocks(document.get("content"))
    else:
        blocks = [deepcopy(block) for block in blocks if isinstance(block, dict)]
        for index, block in enumerate(blocks):
            block.setdefault("id", f"block-{index + 1}")
            block.setdefault("type", "paragraph")
            block.setdefault("text", "")
        if "content" not in document:
            document["content"] = blocks_to_plain_text(blocks)
    document["blocks"] = blocks
    document["schema_version"] = DOCUMENT_SCHEMA_VERSION
    document.setdefault("content", "")
    return document


def apply_document_payload(note, payload):
    """Apply editor input and keep block/plain-text representations aligned."""
    updated = deepcopy(note or {})
    if isinstance(payload.get("blocks"), list):
        updated["blocks"] = deepcopy(payload["blocks"])
        updated["content"] = blocks_to_plain_text(payload["blocks"])
    elif "content" in payload:
        updated["content"] = payload.get("content") or ""
        updated["blocks"] = legacy_content_to_blocks(updated["content"])
    return normalize_document(updated)

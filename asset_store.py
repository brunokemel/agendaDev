"""Content-addressed local storage for document and board assets."""

import mimetypes
import re
from hashlib import sha256
from pathlib import Path
from uuid import uuid4


MAX_ASSET_BYTES = 25 * 1024 * 1024
ALLOWED_MIME_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "application/pdf": ".pdf",
}
EXTENSION_MIME_TYPES = {extension: mime for mime, extension in ALLOWED_MIME_TYPES.items()}
ASSET_ID_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class AssetError(ValueError):
    pass


class AssetStore:
    def __init__(self, root, max_bytes=MAX_ASSET_BYTES):
        self.root = Path(root)
        self.max_bytes = max_bytes
        self.root.mkdir(parents=True, exist_ok=True)

    def store_bytes(self, data, filename="asset", mime_type=None):
        if not isinstance(data, (bytes, bytearray)):
            raise AssetError("O asset precisa ser binario")
        if not data:
            raise AssetError("O asset esta vazio")
        if len(data) > self.max_bytes:
            raise AssetError("O asset excede o limite permitido")
        guessed = mimetypes.guess_type(str(filename or ""))[0]
        mime = (mime_type or guessed or "").lower()
        extension = ALLOWED_MIME_TYPES.get(mime)
        if not extension:
            raise AssetError("Tipo de asset nao permitido")
        if not _matches_signature(bytes(data), mime):
            raise AssetError("O conteudo do asset nao corresponde ao tipo informado")
        digest = sha256(bytes(data)).hexdigest()
        relative = Path(digest[:2]) / f"{digest}{extension}"
        destination = self.root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            temporary = destination.with_suffix(destination.suffix + f".{uuid4().hex}.tmp")
            try:
                temporary.write_bytes(bytes(data))
                temporary.replace(destination)
            finally:
                if temporary.exists():
                    temporary.unlink()
        return {
            "id": digest,
            "sha256": digest,
            "mime": mime,
            "size": len(data),
            "filename": Path(str(filename or "asset")).name,
            "path": relative.as_posix(),
        }

    def resolve(self, relative_path):
        candidate = (self.root / str(relative_path)).resolve()
        root = self.root.resolve()
        if candidate != root and root not in candidate.parents:
            raise AssetError("Caminho de asset invalido")
        return candidate

    def find(self, asset_id):
        """Resolve a content-addressed asset by its public SHA-256 ID."""
        asset_id = str(asset_id or "").lower()
        if not ASSET_ID_PATTERN.fullmatch(asset_id):
            raise AssetError("Identificador de asset invalido")
        directory = self.root / asset_id[:2]
        matches = [path for path in directory.glob(f"{asset_id}.*") if path.is_file()]
        if len(matches) != 1 or matches[0].suffix.lower() not in EXTENSION_MIME_TYPES:
            raise AssetError("Asset nao encontrado")
        path = matches[0].resolve()
        root = self.root.resolve()
        if root not in path.parents:
            raise AssetError("Caminho de asset invalido")
        return path, EXTENSION_MIME_TYPES[path.suffix.lower()]


def _matches_signature(data, mime):
    if mime == "image/png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if mime == "image/jpeg":
        return data.startswith(b"\xff\xd8\xff")
    if mime == "image/gif":
        return data.startswith((b"GIF87a", b"GIF89a"))
    if mime == "image/webp":
        return len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP"
    if mime == "application/pdf":
        return data.startswith(b"%PDF-")
    return False

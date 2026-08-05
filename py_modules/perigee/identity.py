from __future__ import annotations

import contextlib
import os
import ssl
import threading
from typing import TYPE_CHECKING, Final

if TYPE_CHECKING:
    from pathlib import Path

    from perigee.config import ClientIdentity

_CERT_FILE: Final = "client.crt"
_KEY_FILE: Final = "client.key"
_PRIVATE_MODE: Final = 0o600


class IdentityStore:
    """Materializes Moonlight's client identity as files, because `ssl` loads chains by path."""

    def __init__(self, runtime_dir: Path) -> None:
        self._runtime_dir = runtime_dir
        self._context: ssl.SSLContext | None = None
        self._materialized: ClientIdentity | None = None
        # Hosts are probed in parallel, so several threads ask for the context at once.
        self._lock = threading.Lock()

    def ssl_context(self, identity: ClientIdentity) -> ssl.SSLContext:
        """Write the key at most once per identity: it is secret, not a per-host artifact."""
        with self._lock:
            if self._context is not None and self._materialized == identity:
                return self._context

            cert_path = self._write(_CERT_FILE, identity.cert_pem)
            key_path = self._write(_KEY_FILE, identity.key_pem)

            context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            # GameStream hosts serve self-signed certificates; srvcert pinning is a follow-up.
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
            context.load_cert_chain(certfile=str(cert_path), keyfile=str(key_path))

            self._context = context
            self._materialized = identity
            return context

    def purge(self) -> None:
        with self._lock:
            self._context = None
            self._materialized = None
            for name in (_CERT_FILE, _KEY_FILE):
                with contextlib.suppress(OSError):
                    (self._runtime_dir / name).unlink()

    def _write(self, name: str, pem: str) -> Path:
        """Stage then rename, so a reader never sees the destination missing or half written."""
        self._runtime_dir.mkdir(parents=True, exist_ok=True)
        path = self._runtime_dir / name
        staged = self._runtime_dir / f".{name}.partial"
        with contextlib.suppress(FileNotFoundError):
            staged.unlink()
        # O_NOFOLLOW refuses a symlink planted at the staging path.
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
        descriptor = os.open(staged, flags, _PRIVATE_MODE)
        with os.fdopen(descriptor, "w", encoding="ascii") as handle:
            handle.write(pem)
        staged.chmod(_PRIVATE_MODE)
        staged.replace(path)
        return path

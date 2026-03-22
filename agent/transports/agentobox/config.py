from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse, urlunparse


@dataclass(frozen=True)
class AgentoboxTransportConfig:
    agent_id: str
    callback_url: str
    relay_auth_token: str

    def ws_url(self) -> str:
        parsed = urlparse(self.callback_url)
        ws_scheme = "wss" if parsed.scheme == "https" else "ws"
        return urlunparse(
            parsed._replace(
                scheme=ws_scheme,
                path=f"/ws/relay/{self.agent_id}/",
                params="",
                query="",
                fragment="",
            )
        )

    def auth_headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.relay_auth_token}"}

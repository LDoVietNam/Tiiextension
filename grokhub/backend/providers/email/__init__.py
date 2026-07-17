"""Abstract email provider interface and registry."""
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class Mailbox:
    address: str
    token: str = ""          # provider session token if needed
    client: object = None    # provider-specific client handle


class EmailProvider(ABC):
    name = "base"

    @abstractmethod
    def get_address(self) -> Mailbox:
        """Acquire a fresh temp email address."""

    @abstractmethod
    def wait_for_code(self, mailbox: Mailbox, sender_filter: str = "", timeout: int = 120) -> str:
        """Poll inbox for a verification code/link; return code string."""


_REGISTRY: dict[str, type[EmailProvider]] = {}


def register_provider(cls: type[EmailProvider]) -> type[EmailProvider]:
    _REGISTRY[cls.name] = cls
    return cls


def get_provider(name: str) -> EmailProvider:
    if name not in _REGISTRY:
        raise ValueError(f"Unknown email provider: {name}. Available: {list(_REGISTRY)}")
    return _REGISTRY[name]()

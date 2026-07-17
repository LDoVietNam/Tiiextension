"""Abstract captcha solver interface and registry."""
from abc import ABC, abstractmethod


class CaptchaSolver(ABC):
    name = "base"

    @abstractmethod
    def solve_turnstile(self, site_key: str, page_url: str, action: str = "") -> str:
        """Return a Turnstile token for the given site key / page."""


_REGISTRY: dict[str, type[CaptchaSolver]] = {}


def register_solver(cls: type[CaptchaSolver]) -> type[CaptchaSolver]:
    _REGISTRY[cls.name] = cls
    return cls


def get_solver(name: str) -> CaptchaSolver:
    if name not in _REGISTRY:
        raise ValueError(f"Unknown captcha solver: {name}. Available: {list(_REGISTRY)}")
    return _REGISTRY[name]()

"""
bridge_protocol.py — Protocol definitions and schemas for the Antigravity Python SDK bridge.

Defines the JSON-RPC 2.0 structures exchanged over stdio between SealCode (Node.js)
and the Python bridge process.
"""

from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any, Dict, List, Optional, Union

BRIDGE_PROTOCOL_VERSION = "1.0.0"
PINNED_SDK_VERSION = "0.1.12"


class DecisionKind(str, Enum):
    ACCEPT = "accept"
    ACCEPT_FOR_SESSION = "acceptForSession"
    DECLINE = "decline"
    CANCEL = "cancel"


class TurnState(str, Enum):
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"


@dataclass
class BridgeHello:
    protocolVersion: str = BRIDGE_PROTOCOL_VERSION
    sdkVersion: str = PINNED_SDK_VERSION
    pythonVersion: str = ""
    platform: str = ""
    arch: str = ""
    supportedFeatures: List[str] = field(
        default_factory=lambda: [
            "streaming",
            "thoughts",
            "tool_hooks",
            "questions",
            "cancellation",
            "usage",
            "resume",
        ]
    )


@dataclass
class QuestionItem:
    id: str
    question: str
    options: List[str]
    is_multi_select: bool = False


@dataclass
class ApprovalRequestPayload:
    sessionId: str
    turnId: str
    requestId: str
    toolName: str
    args: Dict[str, Any]
    itemType: str
    message: Optional[str] = None


@dataclass
class UserInputRequestPayload:
    sessionId: str
    turnId: str
    requestId: str
    questions: List[Dict[str, Any]]


@dataclass
class UsagePayload:
    sessionId: str
    turnId: str
    inputTokens: int = 0
    outputTokens: int = 0
    cachedInputTokens: int = 0
    reasoningOutputTokens: int = 0
    totalTurnTokens: int = 0
    totalProcessedTokens: int = 0

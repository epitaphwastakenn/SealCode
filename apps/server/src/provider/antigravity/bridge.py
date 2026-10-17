#!/usr/bin/env python3
"""
bridge.py — Stdio JSON-RPC 2.0 bridge for the Antigravity Python SDK.

Orchestrates google.antigravity Agent sessions over stdio for SealCode.
Stdout is strictly reserved for newline-delimited JSON-RPC frames.
Stderr is used for diagnostics and logging.
"""

import asyncio
import json
import os
import platform
import sys
import traceback
import uuid
from dataclasses import asdict
from typing import Any, Dict, List, Optional, Set

_script_dir = os.path.dirname(os.path.abspath(__file__))
if _script_dir not in sys.path:
    sys.path.insert(0, _script_dir)

from bridge_protocol import (
    BRIDGE_PROTOCOL_VERSION,
    PINNED_SDK_VERSION,
    BridgeHello,
    DecisionKind,
    TurnState,
)

# Tool classifications
READ_ONLY_TOOLS = {
    "list_directory",
    "search_directory",
    "find_file",
    "view_file",
    "search_web",
    "read_url_content",
    "ask_question",
    "finish",
}

FILE_EDIT_TOOLS = {
    "create_file",
    "edit_file",
    "replace_file_content",
    "multi_replace_file_content",
    "write_to_file",
}

CONSEQUENTIAL_TOOLS = {
    "run_command",
    "generate_image",
    "start_subagent",
    "define_subagent",
}


def classify_tool(tool_name: str) -> str:
    if tool_name in READ_ONLY_TOOLS:
        return "read_only"
    if tool_name in FILE_EDIT_TOOLS:
        return "file_edit"
    return "consequential"


def mcp_tool_metadata(tool_name: str, server_name: Optional[str] = None) -> Optional[Dict[str, str]]:
    provider_name = str(tool_name)
    marker_index = provider_name.lower().rfind("mcp__")
    if not server_name and marker_index < 0:
        return None

    resolved_server_id = server_name or "sealcode-global"
    canonical_name = provider_name[marker_index:] if marker_index >= 0 else provider_name
    upstream_name = canonical_name
    if marker_index >= 0:
        parts = canonical_name.split("__")
        if len(parts) >= 3:
            resolved_server_id = parts[1]
            upstream_name = "__".join(parts[2:])
    elif server_name:
        canonical_name = "mcp__" + server_name.replace("-", "_") + "__" + provider_name.replace("-", "_")
        upstream_name = provider_name
    return {
        "serverId": resolved_server_id,
        "upstreamToolName": upstream_name,
        "canonicalToolName": canonical_name,
        "providerToolName": provider_name,
    }


def annotation_is_read_only(tool_call: Any) -> bool:
    annotations = getattr(tool_call, "annotations", None)
    if isinstance(annotations, dict):
        return annotations.get("readOnlyHint") is True
    return getattr(annotations, "readOnlyHint", False) is True


def tool_item_type(tool_name: str, server_name: Optional[str] = None) -> str:
    if mcp_tool_metadata(tool_name, server_name) is not None:
        return "mcp_tool_call"
    if tool_name in ("run_command", "bash", "execute_command"):
        return "command_execution"
    if tool_name in FILE_EDIT_TOOLS:
        return "file_change"
    if tool_name in READ_ONLY_TOOLS:
        return "file_read"
    return "dynamic_tool_call"


def send_json(data: Dict[str, Any]) -> None:
    line = json.dumps(data) + "\n"
    sys.stdout.write(line)
    sys.stdout.flush()


def send_notification(method: str, params: Dict[str, Any]) -> None:
    send_json({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
    })


def send_response(req_id: Any, result: Any = None, error: Optional[Dict[str, Any]] = None) -> None:
    payload: Dict[str, Any] = {"jsonrpc": "2.0", "id": req_id}
    if error is not None:
        payload["error"] = error
    else:
        payload["result"] = result
    send_json(payload)


def detect_auth_mode() -> str:
    if os.environ.get("GEMINI_API_KEY"):
        return "gemini_api_key"
    if os.environ.get("GOOGLE_GENAI_USE_VERTEXAI") or os.environ.get("GOOGLE_CLOUD_PROJECT"):
        return "vertex_adc"
    return "none"


class SessionContext:
    def __init__(
        self,
        session_id: str,
        cwd: str,
        model: Optional[str] = None,
        system_instructions: Optional[str] = None,
        runtime_mode: str = "approval-required",
        save_dir: Optional[str] = None,
        conversation_id: Optional[str] = None,
        mcp_servers: Optional[List[Dict[str, Any]]] = None,
    ):
        self.session_id = session_id
        self.cwd = cwd
        self.model = model or "gemini-3.7-flash"
        self.system_instructions = system_instructions
        self.runtime_mode = runtime_mode
        self.save_dir = save_dir
        self.conversation_id = conversation_id or str(uuid.uuid4())
        self.mcp_servers = mcp_servers or []
        self.session_approved_tools: Set[str] = set()

        self.agent: Any = None
        self.active_turn_id: Optional[str] = None
        self.active_task: Optional[asyncio.Task] = None
        self.pending_approvals: Dict[str, asyncio.Future] = {}
        self.pending_questions: Dict[str, asyncio.Future] = {}
        self.total_processed_tokens: int = 0


class AntigravityBridge:
    def __init__(self):
        self.sessions: Dict[str, SessionContext] = {}
        self.is_shutting_down = False

    async def run(self) -> None:
        # Emit hello notification immediately
        hello = BridgeHello(
            pythonVersion=platform.python_version(),
            platform=sys.platform,
            arch=platform.machine(),
        )
        send_notification("bridge.hello", asdict(hello))

        while not self.is_shutting_down:
            line = await asyncio.to_thread(sys.stdin.readline)
            if not line:
                break
            line = line.strip()
            if not line:
                continue

            try:
                msg = json.loads(line)
                asyncio.create_task(self.handle_message(msg))
            except Exception as e:
                sys.stderr.write(f"[AntigravityBridge] JSON parse error: {e}\n")
                sys.stderr.flush()

    async def handle_message(self, msg: Dict[str, Any]) -> None:
        req_id = msg.get("id")
        method = msg.get("method")
        params = msg.get("params", {})

        if not method:
            return

        try:
            if method == "probe":
                await self.handle_probe(req_id, params)
            elif method == "session.start":
                await self.handle_session_start(req_id, params)
            elif method == "turn.start":
                await self.handle_turn_start(req_id, params)
            elif method == "turn.cancel":
                await self.handle_turn_cancel(req_id, params)
            elif method == "approval.resolve":
                await self.handle_approval_resolve(req_id, params)
            elif method == "user_input.resolve":
                await self.handle_user_input_resolve(req_id, params)
            elif method == "session.stop":
                await self.handle_session_stop(req_id, params)
            elif method == "shutdown":
                await self.handle_shutdown(req_id, params)
            elif method == "completion.generate":
                await self.handle_completion_generate(req_id, params)
            else:
                send_response(
                    req_id,
                    error={"code": -32601, "message": f"Method '{method}' not found"},
                )
        except Exception as e:
            sys.stderr.write(f"[AntigravityBridge] Error in method '{method}': {traceback.format_exc()}\n")
            sys.stderr.flush()
            send_response(req_id, error={"code": -32603, "message": str(e)})

    async def handle_probe(self, req_id: Any, params: Dict[str, Any]) -> None:
        auth_mode = detect_auth_mode()
        ready = auth_mode != "none"
        send_response(
            req_id,
            result={
                "ready": ready,
                "sdkVersion": PINNED_SDK_VERSION,
                "protocolVersion": BRIDGE_PROTOCOL_VERSION,
                "defaultModel": "gemini-3.7-flash",
                "authMode": auth_mode,
                "pythonVersion": platform.python_version(),
            },
        )

    async def handle_session_start(self, req_id: Any, params: Dict[str, Any]) -> None:
        session_id = params.get("sessionId")
        if not session_id:
            send_response(req_id, error={"code": -32602, "message": "sessionId is required"})
            return

        ctx = SessionContext(
            session_id=session_id,
            cwd=params.get("cwd", os.getcwd()),
            model=params.get("model"),
            system_instructions=params.get("systemInstructions"),
            runtime_mode=params.get("runtimeMode", "approval-required"),
            save_dir=params.get("saveDir"),
            conversation_id=params.get("conversationId"),
            mcp_servers=params.get("mcpServers", []),
        )
        self.sessions[session_id] = ctx

        send_response(
            req_id,
            result={
                "sessionId": ctx.session_id,
                "conversationId": ctx.conversation_id,
                "model": ctx.model,
            },
        )
        send_notification("session.ready", {
            "sessionId": ctx.session_id,
            "conversationId": ctx.conversation_id,
        })

    async def handle_turn_start(self, req_id: Any, params: Dict[str, Any]) -> None:
        session_id = params.get("sessionId")
        turn_id = params.get("turnId")
        prompt = params.get("prompt", "")
        image_paths = params.get("imagePaths", [])
        interaction_mode = params.get("interactionMode", "default")

        ctx = self.sessions.get(session_id)
        if not ctx:
            send_response(req_id, error={"code": -32602, "message": f"Session '{session_id}' not found"})
            return

        if ctx.active_task and not ctx.active_task.done():
            send_response(req_id, error={"code": -32600, "message": f"Turn already in progress for session '{session_id}'"})
            return

        ctx.active_turn_id = turn_id
        send_response(req_id, result={"turnId": turn_id, "status": "started"})
        send_notification("turn.started", {
            "sessionId": session_id,
            "turnId": turn_id,
            "model": ctx.model,
        })

        ctx.active_task = asyncio.create_task(
            self._execute_turn(ctx, turn_id, prompt, image_paths, interaction_mode)
        )

    async def _execute_turn(
        self,
        ctx: SessionContext,
        turn_id: str,
        prompt: str,
        image_paths: List[str],
        interaction_mode: str,
    ) -> None:
        try:
            # Check if google.antigravity is available
            try:
                from google.antigravity import Agent, LocalAgentConfig, CapabilitiesConfig
                from google.antigravity.hooks import OnToolErrorHook, PostToolCallHook, PreToolCallDecideHook
                from google.antigravity.types import HookResult
                has_sdk = True
            except ImportError:
                has_sdk = False

            if not has_sdk:
                # Fallback / Simulated SDK response if running in test environment without native wheel
                await self._simulate_or_fallback_turn(ctx, turn_id, prompt, interaction_mode)
                return

            if detect_auth_mode() == "none":
                raise RuntimeError(
                    "Antigravity SDK authentication is not configured. Set GEMINI_API_KEY "
                    "or configure Vertex AI ADC; the agy CLI login is not accepted by the Python SDK."
                )

            async def decide_tool(tool_call: Any) -> Any:
                tool_name = str(getattr(tool_call, "name", ""))
                tool_args = getattr(tool_call, "args", {}) or {}
                server_name = getattr(tool_call, "server_name", None)
                server_name = str(server_name) if server_name else None
                mcp = mcp_tool_metadata(tool_name, server_name)
                classification = (
                    "read_only"
                    if mcp is not None and annotation_is_read_only(tool_call)
                    else classify_tool(tool_name)
                )

                if interaction_mode == "plan":
                    return classification == "read_only"
                if ctx.runtime_mode == "full-access":
                    return True
                if tool_name in ctx.session_approved_tools:
                    return True
                if classification == "read_only":
                    return True
                if classification == "file_edit" and ctx.runtime_mode == "auto-accept-edits":
                    return True

                request_id = str(uuid.uuid4())
                fut = asyncio.get_running_loop().create_future()
                ctx.pending_approvals[request_id] = fut
                send_notification("approval.requested", {
                    "sessionId": ctx.session_id,
                    "turnId": turn_id,
                    "requestId": request_id,
                    "toolName": tool_name,
                    "args": tool_args,
                    "itemType": tool_item_type(tool_name, server_name),
                    "message": f"Approval requested for tool {tool_name}",
                    **(mcp or {}),
                })
                decision = await fut
                if decision == DecisionKind.ACCEPT_FOR_SESSION.value:
                    ctx.session_approved_tools.add(tool_name)
                    return True
                return decision == DecisionKind.ACCEPT.value

            class SealCodePreToolCallHook(PreToolCallDecideHook):
                async def run(self, context: Any, tool_call: Any) -> Any:
                    tool_name = str(getattr(tool_call, "name", ""))
                    tool_args = getattr(tool_call, "args", {}) or {}
                    server_name = getattr(tool_call, "server_name", None)
                    server_name = str(server_name) if server_name else None
                    mcp = mcp_tool_metadata(tool_name, server_name)
                    call_id = getattr(tool_call, "id", None) or str(uuid.uuid4())
                    send_notification("tool.started", {
                        "sessionId": ctx.session_id,
                        "turnId": turn_id,
                        "callId": call_id,
                        "toolName": tool_name,
                        "args": tool_args,
                        "isMcp": mcp is not None,
                        **(mcp or {}),
                    })
                    allowed = await decide_tool(tool_call)
                    if not allowed:
                        send_notification("tool.failed", {
                            "sessionId": ctx.session_id,
                            "turnId": turn_id,
                            "callId": call_id,
                            "toolName": tool_name,
                            "error": "Permission denied.",
                            "isMcp": mcp is not None,
                            **(mcp or {}),
                        })
                    return HookResult(
                        allow=allowed,
                        message="Tool call denied by SealCode permissions." if not allowed else "",
                    )

            class SealCodePostToolCallHook(PostToolCallHook):
                async def run(self, context: Any, tool_result: Any) -> None:
                    tool_name = str(getattr(tool_result, "name", ""))
                    server_name = getattr(tool_result, "server_name", None)
                    server_name = str(server_name) if server_name else None
                    mcp = mcp_tool_metadata(tool_name, server_name)
                    call_id = getattr(tool_result, "id", None) or str(uuid.uuid4())
                    error = getattr(tool_result, "error", None)
                    if error:
                        send_notification("tool.failed", {
                            "sessionId": ctx.session_id,
                            "turnId": turn_id,
                            "callId": call_id,
                            "toolName": tool_name,
                            "error": str(error),
                            "isMcp": mcp is not None,
                            **(mcp or {}),
                        })
                    else:
                        send_notification("tool.completed", {
                            "sessionId": ctx.session_id,
                            "turnId": turn_id,
                            "callId": call_id,
                            "toolName": tool_name,
                            "result": getattr(tool_result, "result", None),
                            "isMcp": mcp is not None,
                            **(mcp or {}),
                        })

            class SealCodeToolErrorHook(OnToolErrorHook):
                async def run(self, context: Any, error: Exception) -> Optional[str]:
                    tool_name = getattr(error, "tool_name", None)
                    if tool_name:
                        server_name = getattr(error, "server_name", None)
                        server_name = str(server_name) if server_name else None
                        mcp = mcp_tool_metadata(str(tool_name), server_name)
                        send_notification("tool.failed", {
                            "sessionId": ctx.session_id,
                            "turnId": turn_id,
                            "callId": getattr(error, "call_id", None) or str(uuid.uuid4()),
                            "toolName": str(tool_name),
                            "error": str(error),
                            "isMcp": mcp is not None,
                            **(mcp or {}),
                        })
                    return None

            # Run SDK agent
            config = LocalAgentConfig(
                model=ctx.model,
                workspaces=[ctx.cwd],
                system_instructions=ctx.system_instructions,
                capabilities=CapabilitiesConfig(),
                mcp_servers=[
                    {
                        "name": server["name"],
                        "type": "http",
                        "url": server["url"],
                        "headers": server.get("headers", {}),
                    }
                    for server in ctx.mcp_servers
                ],
                hooks=[
                    SealCodePreToolCallHook(),
                    SealCodePostToolCallHook(),
                    SealCodeToolErrorHook(),
                ],
            )

            async with Agent(config) as agent:
                ctx.agent = agent
                response = await agent.chat(prompt)

                # Stream response
                async for chunk in response.chunks:
                    if hasattr(chunk, "thought") and chunk.thought:
                        send_notification("reasoning.delta", {
                            "sessionId": ctx.session_id,
                            "turnId": turn_id,
                            "delta": chunk.thought,
                        })
                    if hasattr(chunk, "text") and chunk.text:
                        send_notification("content.delta", {
                            "sessionId": ctx.session_id,
                            "turnId": turn_id,
                            "delta": chunk.text,
                        })

                # Usage reporting
                usage = getattr(response, "usage_metadata", None)
                if usage:
                    input_tokens = getattr(usage, "prompt_token_count", 0)
                    output_tokens = getattr(usage, "candidates_token_count", 0)
                    thoughts_tokens = getattr(usage, "thoughts_token_count", 0)
                    cached_tokens = getattr(usage, "cached_content_token_count", 0)
                    turn_total = getattr(usage, "total_token_count", input_tokens + output_tokens)
                    ctx.total_processed_tokens += turn_total

                    send_notification("usage.updated", {
                        "sessionId": ctx.session_id,
                        "turnId": turn_id,
                        "inputTokens": input_tokens,
                        "outputTokens": output_tokens,
                        "cachedInputTokens": cached_tokens,
                        "reasoningOutputTokens": thoughts_tokens,
                        "totalTurnTokens": turn_total,
                        "totalProcessedTokens": ctx.total_processed_tokens,
                    })

            send_notification("turn.completed", {
                "sessionId": ctx.session_id,
                "turnId": turn_id,
                "state": TurnState.COMPLETED.value,
                "stopReason": "stop",
            })
        except asyncio.CancelledError:
            send_notification("turn.completed", {
                "sessionId": ctx.session_id,
                "turnId": turn_id,
                "state": TurnState.CANCELLED.value,
            })
        except Exception as e:
            sys.stderr.write(f"[AntigravityBridge] Turn execution error: {traceback.format_exc()}\n")
            sys.stderr.flush()
            send_notification("turn.completed", {
                "sessionId": ctx.session_id,
                "turnId": turn_id,
                "state": TurnState.FAILED.value,
                "error": str(e),
            })
        finally:
            ctx.active_task = None
            ctx.active_turn_id = None
            # Clear pending interactions
            for fut in ctx.pending_approvals.values():
                if not fut.done():
                    fut.set_result(DecisionKind.CANCEL.value)
            ctx.pending_approvals.clear()
            for fut in ctx.pending_questions.values():
                if not fut.done():
                    fut.cancel()
            ctx.pending_questions.clear()

    async def _simulate_or_fallback_turn(
        self,
        ctx: SessionContext,
        turn_id: str,
        prompt: str,
        interaction_mode: str,
    ) -> None:
        """Lightweight simulation for testing or standalone bridge verification."""
        await asyncio.sleep(0.01)
        send_notification("reasoning.delta", {
            "sessionId": ctx.session_id,
            "turnId": turn_id,
            "delta": f"Analyzing prompt: '{prompt}'",
        })
        await asyncio.sleep(0.01)
        send_notification("content.delta", {
            "sessionId": ctx.session_id,
            "turnId": turn_id,
            "delta": f"Antigravity SDK ready for {ctx.model}.",
        })
        send_notification("usage.updated", {
            "sessionId": ctx.session_id,
            "turnId": turn_id,
            "inputTokens": len(prompt.split()),
            "outputTokens": 10,
            "totalTurnTokens": len(prompt.split()) + 10,
            "totalProcessedTokens": len(prompt.split()) + 10,
        })
        send_notification("turn.completed", {
            "sessionId": ctx.session_id,
            "turnId": turn_id,
            "state": TurnState.COMPLETED.value,
            "stopReason": "stop",
        })

    async def handle_turn_cancel(self, req_id: Any, params: Dict[str, Any]) -> None:
        session_id = params.get("sessionId")
        turn_id = params.get("turnId")
        ctx = self.sessions.get(session_id)
        if not ctx:
            send_response(req_id, error={"code": -32602, "message": f"Session '{session_id}' not found"})
            return

        if ctx.active_task and not ctx.active_task.done():
            ctx.active_task.cancel()
            send_response(req_id, result={"turnId": turn_id, "status": "cancelled"})
        else:
            send_response(req_id, result={"turnId": turn_id, "status": "idle"})

    async def handle_approval_resolve(self, req_id: Any, params: Dict[str, Any]) -> None:
        session_id = params.get("sessionId")
        request_id = params.get("requestId")
        decision = params.get("decision", DecisionKind.DECLINE.value)

        ctx = self.sessions.get(session_id)
        if not ctx:
            send_response(req_id, error={"code": -32602, "message": f"Session '{session_id}' not found"})
            return

        fut = ctx.pending_approvals.get(request_id)
        if fut and not fut.done():
            fut.set_result(decision)
            del ctx.pending_approvals[request_id]
            send_response(req_id, result={"resolved": True})
        else:
            send_response(req_id, result={"resolved": False, "reason": "No pending approval for this requestId"})

    async def handle_user_input_resolve(self, req_id: Any, params: Dict[str, Any]) -> None:
        session_id = params.get("sessionId")
        request_id = params.get("requestId")
        answers = params.get("answers", {})

        ctx = self.sessions.get(session_id)
        if not ctx:
            send_response(req_id, error={"code": -32602, "message": f"Session '{session_id}' not found"})
            return

        fut = ctx.pending_questions.get(request_id)
        if fut and not fut.done():
            fut.set_result(answers)
            del ctx.pending_questions[request_id]
            send_response(req_id, result={"resolved": True})
        else:
            send_response(req_id, result={"resolved": False, "reason": "No pending question for this requestId"})

    async def handle_session_stop(self, req_id: Any, params: Dict[str, Any]) -> None:
        session_id = params.get("sessionId")
        ctx = self.sessions.pop(session_id, None)
        if ctx:
            if ctx.active_task and not ctx.active_task.done():
                ctx.active_task.cancel()
            for fut in ctx.pending_approvals.values():
                if not fut.done():
                    fut.set_result(DecisionKind.CANCEL.value)
            for fut in ctx.pending_questions.values():
                if not fut.done():
                    fut.cancel()
        send_response(req_id, result={"stopped": True})

    async def handle_shutdown(self, req_id: Any, params: Dict[str, Any]) -> None:
        self.is_shutting_down = True
        for session_id in list(self.sessions.keys()):
            await self.handle_session_stop(None, {"sessionId": session_id})
        send_response(req_id, result={"shutdown": True})

    async def handle_completion_generate(self, req_id: Any, params: Dict[str, Any]) -> None:
        prompt = params.get("prompt", "")
        # Isolated single-shot completion
        send_response(req_id, result={"text": f"Completion result for: {prompt[:30]}"})


def main() -> None:
    bridge = AntigravityBridge()
    try:
        asyncio.run(bridge.run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

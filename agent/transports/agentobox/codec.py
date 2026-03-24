"""Wire encoding and decoding for the Agentobox managed transport."""

from __future__ import annotations

from agent.transports.agentobox.commands import (
    CallbackBehavior,
    CallbackResponseCommand,
    DownstreamCommand,
    DownstreamCommandType,
    RelayAction,
    ReloadCommand,
    SignalCommand,
    TerminalAction,
    TerminalCommand,
    TerminalProgram,
)
from agent.transports.agentobox.upstream import UpstreamMessage


def encode_downstream_command(command: DownstreamCommand) -> dict[str, str]:
    """Serialize a typed downstream command into its wire payload."""

    return command.to_dict()


def encode_upstream_message(message: UpstreamMessage) -> dict:
    """Serialize a typed upstream message into its wire payload."""

    return message.to_dict()


def parse_downstream_command(payload: dict) -> DownstreamCommand:
    """Parse and validate a downstream command from a raw wire payload."""

    cmd_type = payload.get("type", "")
    if cmd_type == DownstreamCommandType.RELOAD.value:
        path = payload.get("path", "")
        if not path:
            raise ValueError("reload command requires non-empty path")
        return ReloadCommand(path=path)
    if cmd_type == DownstreamCommandType.SIGNAL.value:
        action = payload.get("action", "")
        try:
            return SignalCommand(action=RelayAction(action))
        except ValueError as exc:
            raise ValueError(f"unsupported relay action: {action}") from exc
    if cmd_type == DownstreamCommandType.CALLBACK_RESPONSE.value:
        request_id = payload.get("request_id", "")
        behavior = payload.get("behavior", "")
        if not request_id:
            raise ValueError("callback_response requires request_id")
        try:
            parsed_behavior = CallbackBehavior(behavior)
        except ValueError as exc:
            raise ValueError(f"unsupported callback behavior: {behavior}") from exc
        return CallbackResponseCommand(
            request_id=request_id,
            behavior=parsed_behavior,
            message=payload.get("message", ""),
        )
    if cmd_type == DownstreamCommandType.TERMINAL.value:
        action = payload.get("action", "")
        terminal_id = payload.get("terminal_id", "main")
        program = payload.get("program", "")
        if not terminal_id:
            raise ValueError("terminal command requires terminal_id")
        try:
            parsed_action = TerminalAction(action)
        except ValueError as exc:
            raise ValueError(f"unsupported terminal action: {action}") from exc
        parsed_program = None
        if program:
            try:
                parsed_program = TerminalProgram(program)
            except ValueError as exc:
                raise ValueError(f"unsupported terminal program: {program}") from exc
        cols = int(payload.get("cols", 0) or 0)
        rows = int(payload.get("rows", 0) or 0)
        data = payload.get("data", "")
        if parsed_action is TerminalAction.INPUT and not isinstance(data, str):
            raise ValueError("terminal input requires string data")
        return TerminalCommand(
            action=parsed_action,
            terminal_id=terminal_id,
            program=parsed_program,
            data=data if isinstance(data, str) else "",
            cols=max(0, cols),
            rows=max(0, rows),
        )
    raise ValueError(f"unsupported downstream command type: {cmd_type}")

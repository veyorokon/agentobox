# Agentobox Agent Reference

> Auto-generated from agent codebase. Do not edit — regenerate with `make docs`.

## Modules

### agent/runtime/__init__.py

Standalone-valid runtime implementation.

### agent/runtime/app.py

Top-level runtime composition root.

`AgentApplication` wires together provisioning, lifecycle, transport, local
ingress, task execution, and runtime-owned services. Transition policy lives
in `LifecycleCoordinator`; this class is intentionally a composition root,
not the runtime state machine itself.

### agent/runtime/bootstrap.py

Managed runtime bootstrap.

This module owns the boot-time wait/validate behavior for managed mode before
the long-lived runtime process starts. It keeps the provisioning contract
explicit and prevents image entrypoints from reintroducing ad hoc shell loops.

### agent/runtime/desktop/__init__.py

Desktop-profile runtime helpers.

These modules own the minimal local process behavior for the visual desktop
stack. They intentionally replace old shell-run scripts with small Python
entrypoints so the desktop profile stays inside the new runtime architecture.

### agent/runtime/desktop/awesome.py

Desktop-profile AwesomeWM launcher.

### agent/runtime/desktop/browser.py

Desktop-profile Chromium launcher.

### agent/runtime/desktop/common.py

Shared helpers for desktop-profile service launchers.

### agent/runtime/desktop/config.py

Runtime-owned desktop configuration bridge.

The desktop profile projects only the files the window manager needs from the
canonical runtime tree. Chromium is available from the dock on demand; the
browser home surface itself is runtime-owned and fed by the canonical theme
projection.

### agent/runtime/desktop/websockify.py

Desktop-profile websockify launcher.

### agent/runtime/desktop/x11vnc.py

Desktop-profile x11vnc launcher.

### agent/runtime/desktop/xvfb.py

Desktop-profile Xvfb launcher.

### agent/runtime/execution.py

Execution-layer contracts for runtime-owned task execution.

The transport tells the runtime *that* new work exists. Executors own *how*
that work is performed and what execution-time events are emitted. Keeping
this seam explicit prevents transport and execution concerns from collapsing
back into a single relay blob.

### agent/runtime/executors/__init__.py

Runtime execution adapters.

### agent/runtime/executors/claude_code.py

Claude Code execution adapter.

This module owns Claude SDK-specific behavior only:

- preserving raw SDK message payloads
- building ClaudeSDKClient options from typed runtime config
- normalizing parsed SDK messages into runtime execution events

It does not own transport policy, websocket behavior, or backend protocol
translation. Those concerns live above this adapter.

### agent/runtime/executors/factory.py

Executor factory for runtime-owned task execution.

### agent/runtime/fsbridge.py

Materialize canonical runtime files at the container-visible paths tools expect.

The managed runtime treats ``AGENTOBOX_ROOT_DIR`` as the canonical provisioned
tree, but external tools like Claude Code and desktop applications still read conventional
paths such as ``/home/agent/.claude`` and ``/run/secrets``. This module creates
an explicit bridge from the canonical tree into those container-visible paths.

### agent/runtime/inbox.py

Durable managed-mode inbox files.

Managed transport should stay thin: websocket commands tell the runtime which
durable file changed, and runtime code owns how those files are interpreted.
This keeps transport semantics separate from task/session execution.

### agent/runtime/lifecycle.py

Lifecycle coordination for the agent runtime.

This module owns transition policy. The app wires components together; the
coordinator decides how component facts become canonical runtime state.

### agent/runtime/mailbox.py

Small synchronized mailboxes for runtime cross-thread handoff.

### agent/runtime/managed_session.py

Runtime-owned Agentobox relay session.

The websocket client owns connectivity; this session owns how managed runtime
state reacts to canonical downstream commands. It is intentionally narrow so
legacy relay behavior gets split into explicit runtime concerns instead of
reforming into a single transport monolith.

### agent/runtime/projection.py

Runtime-owned projection of live state onto canonical filesystem artifacts.

The runtime's live source of truth remains in memory. This module is only
responsible for publishing selected projections, such as `_abox/status.json`,
so other components can observe the runtime without becoming the authority for
its state.

### agent/runtime/service_catalog.py

Canonical runtime service declarations by platform and runtime profile.

This module is the source of truth for which long-running external services
exist for a given runtime shape. Platform adapters may change how services
run, but not which services exist or how they depend on one another.

### agent/runtime/services.py

Runtime-owned service graph and supervision primitives.

This layer is intentionally small and explicit. It provides one canonical
dependency graph and one managed-process supervision model so image startup
does not regress into shell-script ordering and ad hoc process wrappers.

### agent/runtime/theme.py

Runtime-owned theme loading and projection.

The durable theme contract is a semantic-token document. The runtime derives
the concrete artifacts it needs from that one source of truth so boot-time and
live theme updates follow the same path.

### agent/transports/__init__.py

Transport adapters.

### agent/transports/agentobox/__init__.py

Agentobox managed transport plugin.

### agent/transports/agentobox/codec.py

Wire encoding and decoding for the Agentobox managed transport.

### agent/transports/agentobox/commands.py

Canonical Agentobox managed transport commands.

These are semantic control-plane requests from backend to agent. They are
kept separate from runtime events so the wire contract stays clear:

- commands ask the agent to do something
- events report facts about what happened

### agent/transports/agentobox/session.py

Managed relay session interfaces for Agentobox transport.

The websocket client owns transport connectivity. Relay session objects own
what to do once connected: receive commands, apply them to the local runtime,
and eventually emit upstream events/results. Keeping this seam explicit avoids
recreating the old relay monolith inside the transport client.

### agent/transports/agentobox/upstream.py

Canonical Agentobox managed transport messages sent from agent to backend.

### agent/contracts/__init__.py

Shared contracts for the Agentobox agent runtime.

### agent/contracts/input.py

Canonical task input model for runtime execution.

Task input should preserve structured multimodal content without making the
runtime contract depend on one executor vendor's private payload shape.
Executors adapt this semantic model into their native wire format.

### agent/contracts/services.py

Contracts for runtime-owned service supervision.

The runtime service graph is the canonical declaration of long-running local
processes that support the agent image. Service specs are platform-agnostic:
platform adapters decide how services are run, not what services exist or how
they depend on each other.

### agent/platform/__init__.py

Platform adapters.

## Test Principles

### test_managed_docker_contract.py — FakeRelayServer

Minimal relay peer for managed image contract tests.

The image only needs a successful websocket peer to reach managed-ready.
This server intentionally stays tiny: it accepts a connection and captures
upstream messages so the test can assert the runtime actually attached.

## Exception Annotations

| File | Line | Annotation |
|------|------|------------|
| runner.py | 208 | task execution failure should be surfaced on the task record |
| client.py | 114 | transport startup failure should degrade the runtime instead of crashing the process |

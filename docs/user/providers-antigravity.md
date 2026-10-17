# Antigravity

Antigravity uses Google's official ACP agent by default. It connects to your Google
account and does not require an API key. Account access and limits are determined by Google.

## Set up your account

1. Open **Settings > Providers** and expand Antigravity.
2. Select **ACP (Google account)**, then **Install runtime**.
3. Select **Sign in with Google** and complete Google's flow in your browser. If it
   does not open, select **Open Google sign-in** or copy **Google sign-in URL** into your browser.
4. Choose an available Antigravity model and start a new thread.

The runtime is installed on the machine hosting your SealCode environment. If you
sign in from another device and the final localhost page cannot load, copy its full
address into **Google return URL** in the provider settings. Cancel stops a pending
sign-in; Sign out removes that instance's saved ACP credentials and stops its sessions.

For a manual installation, set **ACP executable** to `agy_acp_server.exe` on Windows
or `agy_acp_server.par` on macOS/Linux. Keep `localharness_external` beside it, with
`.exe` on Windows. Leave the path blank to use the managed installation.

## Conversations and questions

Follow-ups resume the same ACP conversation. Failed and interrupted turns keep their
conversation identity. Tool failures do not automatically fail an otherwise successful
turn. Native questions require one of the offered choices; answering continues the
current turn. Interrupting closes pending questions and approvals.

The Usage page reads your plan and quota bars from this instance's saved Google ACP
sign-in. Refresh account usage to update them; no separate CLI or IDE sign-in is needed.

The old `agy` CLI route has been removed. Saved CLI settings migrate to ACP, but CLI
sign-in and conversation IDs cannot be reused. Your old chat history remains available;
start a new ACP thread after signing in. Use Antigravity's `/plan` command for planning.

On Windows, stopping Antigravity or closing SealCode waits for the runtime's
temporary files to be released. This can take longer if the runtime is still starting.

## Additional accounts and SDK mode

Each Antigravity provider instance has its own Google sign-in. Add another instance
and sign in from its settings to use another account. Select a **Fallback instance**
if you want SealCode's existing quota-error failover behavior.

**SDK (API / Vertex)** remains available for API-key or Vertex credentials. It is
separate from Google account ACP sign-in and keeps its existing Python setup.

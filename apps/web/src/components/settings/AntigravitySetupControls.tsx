import { useCallback, useEffect, useRef, useState } from "react";
import type {
  EnvironmentId,
  ProviderInstanceId,
  ProviderSetupInput,
  ProviderSetupState,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ensureLocalApi } from "../../localApi";

export function AntigravitySetupControls({
  environmentId,
  instanceId,
}: {
  environmentId: EnvironmentId;
  instanceId: ProviderInstanceId;
}) {
  const setup = useAtomCommand(serverEnvironment.setupProvider, { reportFailure: false });
  const [state, setState] = useState<ProviderSetupState>({
    phase: "idle",
    authorizationUrl: null,
    message: null,
  });
  const [callbackUrl, setCallbackUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const openedUrl = useRef<string | null>(null);
  const openSignIn = useCallback(async (url: string) => {
    setBrowserError(null);
    try {
      await ensureLocalApi().shell.openExternal(url);
    } catch {
      setBrowserError("Could not open your browser. Copy the sign-in URL below into your browser.");
    }
  }, []);
  useEffect(() => {
    const url = state.authorizationUrl;
    if (url && openedUrl.current !== url) void openSignIn(url);
    openedUrl.current = url;
  }, [state.authorizationUrl, openSignIn]);
  const run = useCallback(
    async (action: ProviderSetupInput["action"], callback?: string) => {
      setPending(true);
      const result = await setup({
        environmentId,
        input: { instanceId, action, ...(callback ? { callbackUrl: callback } : {}) },
      });
      setPending(false);
      if (result._tag === "Success") setState(result.value);
      else
        setState((previous) => ({
          ...previous,
          message: String(squashAtomCommandFailure(result)),
        }));
    },
    [setup, environmentId, instanceId],
  );
  useEffect(() => {
    void run("status");
  }, [run]);
  const busy = state.phase === "installing" || state.phase === "signing-in";
  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => {
      void run("status");
    }, 1500);
    return () => clearTimeout(timer);
  }, [busy, state, run]);
  return (
    <div className="space-y-3 rounded-md border p-3 text-sm">
      <p>
        Connect your Google account to Antigravity. An eligible subscription is required; no API key
        is needed.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={pending || busy}
          onClick={() => void run("install")}
        >
          Install runtime
        </Button>
        <Button size="sm" disabled={pending || busy} onClick={() => void run("login")}>
          Sign in with Google
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || busy}
          onClick={() => void run("logout")}
        >
          Sign out
        </Button>
        {state.phase === "signing-in" && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => void run("cancel")}>
            Cancel
          </Button>
        )}
      </div>
      {state.message && (
        <p
          role="status"
          className={state.phase === "error" ? "text-destructive" : "text-muted-foreground"}
        >
          {state.message}
        </p>
      )}
      {state.authorizationUrl && (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void openSignIn(state.authorizationUrl!)}
          >
            Open Google sign-in
          </Button>
          {browserError && (
            <p role="alert" className="text-destructive">
              {browserError}
            </p>
          )}
          <Input
            aria-label="Google sign-in URL"
            readOnly
            value={state.authorizationUrl}
            onFocus={(event) => event.currentTarget.select()}
          />
          <p className="text-xs text-muted-foreground">
            Signing in from another device? If the final localhost page cannot load, paste its full
            address here.
          </p>
          <Input
            aria-label="Google return URL"
            value={callbackUrl}
            onChange={(event) => setCallbackUrl(event.target.value)}
          />
          <Button
            size="sm"
            disabled={pending || !callbackUrl.trim()}
            onClick={() => {
              void run("callback", callbackUrl);
              setCallbackUrl("");
            }}
          >
            Continue sign-in
          </Button>
        </>
      )}
    </div>
  );
}

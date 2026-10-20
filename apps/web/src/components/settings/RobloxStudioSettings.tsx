import { RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import type {
  GlobalMcpStatus,
  RobloxStudioMode,
  RobloxStudioScope,
  RobloxStudioSettings as RobloxStudioSettingsValue,
  RobloxStudioStatus,
} from "@t3tools/contracts";

import { usePrimarySettings, useUpdatePrimarySettings } from "~/hooks/useSettings";
import { usePrimaryEnvironment } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const MODES: ReadonlyArray<{ value: RobloxStudioMode; label: string }> = [
  { value: "sealcode", label: "SealCode" },
  { value: "official", label: "Roblox's own Studio MCP" },
  { value: "off", label: "Off" },
];

const SCOPES: ReadonlyArray<{ value: RobloxStudioScope; label: string }> = [
  { value: "roblox-projects", label: "Roblox projects" },
  { value: "all-projects", label: "All projects" },
];

/** Settings keep a saved secret as this marker; see `settingsSecrets.ts`. */
const REDACTED = "\u2022\u2022\u2022\u2022\u2022\u2022";

function ServerStatusLine({
  label,
  status,
  onReconnect,
  reconnecting,
}: {
  readonly label: string;
  readonly status: GlobalMcpStatus | undefined;
  readonly onReconnect: () => void;
  readonly reconnecting: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{label}</span>
      <span className={status?.state === "ready" ? "text-success" : undefined}>
        {status?.state ?? "connecting"}
      </span>
      <span>{status?.toolCount ?? 0} tools</span>
      {status?.errorMessage ? (
        <span className="min-w-0 break-words text-destructive">{status.errorMessage}</span>
      ) : null}
      <Button
        type="button"
        size="xs"
        variant="outline"
        className="ml-auto"
        disabled={reconnecting}
        onClick={onReconnect}
      >
        <RefreshCwIcon className={reconnecting ? "size-3 animate-spin" : "size-3"} />
        Reconnect
      </Button>
    </div>
  );
}

function BridgeSummary({ status }: { readonly status: RobloxStudioStatus }) {
  const bridge = status.bridge;
  if (bridge === undefined) return null;
  const notices = [
    bridge.pluginUpdated
      ? "The SealCode Studio plugin was just installed or updated. Open places update themselves in a few seconds; a Studio that was open before SealCode first installed the plugin loads it when its next place opens."
      : undefined,
    bridge.pluginRejected
      ? `A Studio is still running an older plugin (${bridge.pluginRejected}); restart Roblox Studio.`
      : undefined,
    bridge.pluginProblem ? `Plugin install failed: ${bridge.pluginProblem}` : undefined,
    bridge.warning,
    bridge.error,
  ].filter((notice): notice is string => notice !== undefined);
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p>
        Bridge {bridge.state}
        {bridge.version ? ` · v${bridge.version}` : ""}
        {bridge.restarts > 0 ? ` · restarted ${String(bridge.restarts)}×` : ""}
        {" · "}
        {bridge.places.length === 0
          ? "no place connected — open a place in Roblox Studio"
          : bridge.places
              .map(
                (place) =>
                  `${place.placeName ?? place.instanceId}${place.role ? ` (${place.role})` : ""}`,
              )
              .join(", ")}
      </p>
      {notices.map((notice) => (
        <p key={notice} className="text-warning">
          {notice}
        </p>
      ))}
    </div>
  );
}

function TextSetting({
  value,
  placeholder,
  label,
  secret = false,
  onCommit,
}: {
  readonly value: string;
  readonly placeholder: string;
  readonly label: string;
  readonly secret?: boolean;
  readonly onCommit: (value: string) => void;
}) {
  const saved = secret && value === REDACTED;
  const [draft, setDraft] = useState(saved ? "" : value);
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(secret && value === REDACTED ? "" : value);
  }
  return (
    <Input
      value={draft}
      type={secret ? "password" : "text"}
      placeholder={saved ? "Saved (type to replace)" : placeholder}
      aria-label={label}
      className="sm:w-72"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = draft.trim();
        if (secret && next === "") return;
        if (next !== value) onCommit(next);
      }}
    />
  );
}

export function RobloxStudioSettings() {
  const primaryEnvironment = usePrimaryEnvironment();
  const environmentId = primaryEnvironment?.environmentId ?? null;
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const statusQuery = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.robloxStudioStatus({ environmentId, input: {} }),
  );
  const reconnectMcp = useAtomCommand(serverEnvironment.reconnectMcp, { reportFailure: false });
  const [reconnectingId, setReconnectingId] = useState<string | null>(null);
  const roblox = settings.robloxStudio;
  const status = statusQuery.data;

  const update = (patch: Partial<RobloxStudioSettingsValue>) =>
    updateSettings({ robloxStudio: patch });
  const reconnect = (id: string) => {
    if (environmentId === null) return;
    setReconnectingId(id);
    void reconnectMcp({ environmentId, input: { id } }).finally(() => {
      setReconnectingId(null);
      statusQuery.refresh();
    });
  };

  return (
    <SettingsSection {...searchableSetting("roblox-studio")}>
      <p className="px-3 text-xs leading-relaxed text-muted-foreground sm:px-4">
        Drive Roblox Studio from any agent. SealCode installs its own Studio plugin and keeps it up
        to date in place. The plugin adds a Studio panel with a switch for every tool, plus safety
        switches to pause the agent, make the place read-only or stop Luau. Agents can move the
        camera and send screenshots to the chat, use Creator Store assets and model in Blender.
      </p>
      <SettingsRow
        title="Studio connection"
        description={
          roblox.mode === "sealcode"
            ? `SealCode Studio connection${status?.bridge?.version ? ` v${status.bridge.version}` : ""}: the plugin, the Studio panel and the tool switches.`
            : roblox.mode === "official"
              ? "Only the MCP server Roblox Studio ships."
              : "Choose how agents reach Roblox Studio."
        }
        control={
          <Select
            value={roblox.mode}
            onValueChange={(value) => {
              if (typeof value === "string") update({ mode: value as RobloxStudioMode });
            }}
          >
            <SelectTrigger aria-label="Roblox Studio connection" className="sm:w-60">
              <SelectValue>{MODES.find((mode) => mode.value === roblox.mode)?.label}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {MODES.map((mode) => (
                <SelectItem key={mode.value} value={mode.value} hideIndicator>
                  {mode.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      {roblox.mode === "off" ? null : (
        <>
          <SettingsRow
            title="Projects"
            description="Threads outside these projects do not get the Studio tools or instructions. A Roblox project has a Rojo project, place or model file, Roblox tooling such as wally.toml, or a .sealcode-roblox file in its root."
            control={
              <Select
                value={roblox.scope}
                onValueChange={(value) => {
                  if (typeof value === "string") update({ scope: value as RobloxStudioScope });
                }}
              >
                <SelectTrigger aria-label="Roblox Studio projects" className="sm:w-60">
                  <SelectValue>
                    {SCOPES.find((scope) => scope.value === roblox.scope)?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {SCOPES.map((scope) => (
                    <SelectItem key={scope.value} value={scope.value} hideIndicator>
                      {scope.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
          {roblox.mode === "sealcode" ? (
            <>
              <SettingsRow
                title="Studio instructions"
                description="Gives each new conversation SealCode's rules and Roblox skills for working in Studio."
                control={
                  <Switch
                    checked={roblox.instructions}
                    onCheckedChange={(instructions) => update({ instructions })}
                    aria-label="Studio instructions"
                  />
                }
              />
              <SettingsRow
                title="Automatic playtests"
                description="Agents run the smallest useful playtest to verify runtime changes, and stop it before replying."
                control={
                  <Switch
                    checked={roblox.autoPlaytest}
                    onCheckedChange={(autoPlaytest) => update({ autoPlaytest })}
                    aria-label="Automatic playtests"
                  />
                }
              />
              <SettingsRow
                title="Studio selection as context"
                description="Each message tells the agent what you have selected in Studio and which script is open, so you can say “this part” or “the open script”."
                control={
                  <Switch
                    checked={roblox.studioContext}
                    onCheckedChange={(studioContext) => update({ studioContext })}
                    aria-label="Studio selection as context"
                  />
                }
              />
              <SettingsRow
                title="Also connect Roblox's own MCP"
                description={
                  status?.officialMcpAvailable === false
                    ? "Roblox Studio's mcp.bat was not found on this machine."
                    : "Adds Roblox's mesh, texture and material generation beside SealCode's tools."
                }
                control={
                  <Switch
                    checked={roblox.officialMcpAlongside}
                    onCheckedChange={(officialMcpAlongside) => update({ officialMcpAlongside })}
                    aria-label="Also connect Roblox's own MCP"
                  />
                }
              />
              {/* Uploads go through the Roblox Assistant now; a key saved before can still be cleared. */}
              {roblox.openCloudApiKey.length > 0 ? (
                <SettingsRow
                  title="Remove the saved Open Cloud key"
                  description="SealCode no longer uploads with an Open Cloud key: agents ask whether to publish through the Roblox Assistant or let you publish."
                  control={
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => update({ openCloudApiKey: "" })}
                    >
                      Remove
                    </Button>
                  }
                />
              ) : null}
              <SettingsRow
                title="Blender executable"
                description={
                  status?.blender.problem ??
                  (status?.blender.version
                    ? `${status.blender.version} · ${status.blender.executable ?? ""}`
                    : "Leave empty to use the Blender found in the usual install folders and Steam libraries.")
                }
                control={
                  <TextSetting
                    value={roblox.blenderExecutable}
                    placeholder={status?.blender.executable ?? "C:\\...\\blender.exe"}
                    label="Blender executable"
                    onCommit={(blenderExecutable) => update({ blenderExecutable })}
                  />
                }
              />
            </>
          ) : null}
          <SettingsRow
            title="Blender MCP"
            description={
              status?.blenderMcp.problem ??
              "Connects an MCP server that drives your live Blender, such as MCP for Blender."
            }
            control={
              <Switch
                checked={roblox.blenderMcp}
                onCheckedChange={(blenderMcp) => update({ blenderMcp })}
                aria-label="Blender MCP"
              />
            }
          />
          {roblox.blenderMcp ? (
            <SettingsRow
              title="Blender MCP command"
              description={`Leave empty to run ${status?.blenderMcp.command ?? "the detected install"}${status?.blenderMcp.args.length ? ` ${status.blenderMcp.args.join(" ")}` : ""}.`}
              control={
                <div className="flex flex-col gap-2 sm:flex-row">
                  <TextSetting
                    value={roblox.blenderMcpCommand}
                    placeholder="Command"
                    label="Blender MCP command"
                    onCommit={(blenderMcpCommand) => update({ blenderMcpCommand })}
                  />
                  <TextSetting
                    value={roblox.blenderMcpArgs.join(" ")}
                    placeholder="Arguments"
                    label="Blender MCP arguments"
                    onCommit={(args) =>
                      update({ blenderMcpArgs: args.length > 0 ? args.split(/\s+/u) : [] })
                    }
                  />
                </div>
              }
            />
          ) : null}
          {status !== null ? (
            <div className="space-y-2 rounded-xl border border-border/70 bg-muted/10 p-3 sm:p-4">
              {status.servers.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {roblox.mode === "official" && !status.officialMcpAvailable
                    ? "Roblox Studio's mcp.bat was not found. Install Roblox Studio, or choose SealCode."
                    : "No Roblox server is running for these settings."}
                </p>
              ) : (
                status.servers.map((server) => (
                  <ServerStatusLine
                    key={server.id}
                    label={server.id}
                    status={server}
                    reconnecting={reconnectingId === server.id}
                    onReconnect={() => reconnect(server.id)}
                  />
                ))
              )}
              {roblox.mode === "sealcode" ? <BridgeSummary status={status} /> : null}
            </div>
          ) : null}
        </>
      )}
    </SettingsSection>
  );
}

import { useState } from "react";
import type {
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
import { McpReconnectButton, McpStatusBadge } from "./McpStatus";
import {
  SettingsCallout,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { StudioPlaceChip } from "./StudioPlaceChip";
import { useCanManageLocalBackend } from "./useCanManageLocalBackend";

const modes: ReadonlyArray<{ value: RobloxStudioMode; label: string }> = [
  { value: "sealcode", label: "Harp" },
  { value: "official", label: "Roblox's own Studio MCP" },
  { value: "off", label: "Off" },
];

const scopes: ReadonlyArray<{ value: RobloxStudioScope; label: string }> = [
  { value: "roblox-projects", label: "Roblox projects" },
  { value: "all-projects", label: "All projects" },
];

const redacted = "\u2022\u2022\u2022\u2022\u2022\u2022";

function bridgeNotices(status: RobloxStudioStatus): ReadonlyArray<string> {
  const bridge = status.bridge;
  if (bridge === undefined) return [];
  return [
    bridge.pluginUpdated
      ? "The Harp Studio plugin was just installed or updated. Open places update themselves in a few seconds. A Studio that was open before the plugin was first installed loads it when its next place opens."
      : undefined,
    bridge.pluginRejected
      ? `A Studio is still running an older plugin (${bridge.pluginRejected}). Restart Roblox Studio.`
      : undefined,
    bridge.pluginProblem ? `Plugin install failed: ${bridge.pluginProblem}` : undefined,
    bridge.warning,
    bridge.error,
  ].filter((notice): notice is string => notice !== undefined);
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
  const saved = secret && value === redacted;
  const [draft, setDraft] = useState(saved ? "" : value);
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(secret && value === redacted ? "" : value);
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

function StudioConnectionStatus({
  status,
  mode,
  reconnectingId,
  onReconnect,
}: {
  readonly status: RobloxStudioStatus;
  readonly mode: RobloxStudioMode;
  readonly reconnectingId: string | null;
  readonly onReconnect: (id: string) => void;
}) {
  const places = status.bridge?.places ?? [];
  const notices = bridgeNotices(status);
  return (
    <div className="space-y-2 pt-1">
      {status.servers.length === 0 ? (
        <p>
          {mode === "official" && !status.officialMcpAvailable
            ? "Roblox Studio's mcp.bat was not found. Install Roblox Studio, or choose Harp."
            : "No Roblox server is running for these settings."}
        </p>
      ) : (
        status.servers.map((server) => (
          <div key={server.id} className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {server.displayName ?? server.id}
            </span>
            <McpStatusBadge state={server.state} />
            <span className="tabular-nums">{server.toolCount} tools</span>
            <McpReconnectButton
              label={server.displayName ?? server.id}
              reconnecting={reconnectingId === server.id}
              onReconnect={() => onReconnect(server.id)}
            />
            {server.errorMessage ? (
              <span className="min-w-0 break-words text-error-foreground">
                {server.errorMessage}
              </span>
            ) : null}
          </div>
        ))
      )}
      {mode === "sealcode" && status.bridge !== undefined ? (
        places.length === 0 ? (
          <p>No place connected. Open a place in Roblox Studio.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {places.map((place) => (
              <StudioPlaceChip
                key={place.instanceId}
                name={place.placeName ?? place.instanceId}
                role={place.role}
                running={place.isRunning === true}
              />
            ))}
          </div>
        )
      ) : null}
      {notices.map((notice) => (
        <SettingsCallout key={notice} tone="warning">
          {notice}
        </SettingsCallout>
      ))}
    </div>
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
    <>
      <SettingsSection
        {...searchableSetting("roblox-studio")}
        description="Let agents read and edit your place in Roblox Studio."
      >
        <SettingsRow
          title="Connection"
          description={
            roblox.mode === "sealcode"
              ? "Harp installs and updates its own Studio plugin. Its Studio panel has a switch for every tool and safety switches to pause the agent, make the place read-only or stop Luau."
              : roblox.mode === "official"
                ? "Agents only get the MCP server Roblox Studio ships."
                : "Choose how agents reach Roblox Studio."
          }
          status={
            roblox.mode !== "off" && status !== null ? (
              <StudioConnectionStatus
                status={status}
                mode={roblox.mode}
                reconnectingId={reconnectingId}
                onReconnect={reconnect}
              />
            ) : undefined
          }
          control={
            <Select
              value={roblox.mode}
              onValueChange={(value) => {
                if (typeof value === "string") update({ mode: value as RobloxStudioMode });
              }}
            >
              <SelectTrigger aria-label="Roblox Studio connection" className="sm:w-60">
                <SelectValue>{modes.find((mode) => mode.value === roblox.mode)?.label}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {modes.map((mode) => (
                  <SelectItem key={mode.value} value={mode.value} hideIndicator>
                    {mode.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        {roblox.mode === "off" ? null : (
          <SettingsRow
            title="Projects"
            description="Threads outside these projects do not get the Studio tools or instructions. A Roblox project has a Rojo project, a place or model file, Roblox tooling such as wally.toml, or a .sealcode-roblox file in its root."
            control={
              <Select
                value={roblox.scope}
                onValueChange={(value) => {
                  if (typeof value === "string") update({ scope: value as RobloxStudioScope });
                }}
              >
                <SelectTrigger aria-label="Roblox Studio projects" className="sm:w-60">
                  <SelectValue>
                    {scopes.find((scope) => scope.value === roblox.scope)?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {scopes.map((scope) => (
                    <SelectItem key={scope.value} value={scope.value} hideIndicator>
                      {scope.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
        )}
      </SettingsSection>

      {roblox.mode === "sealcode" ? (
        <SettingsSection id="roblox-studio-agents" title="Agent behavior">
          <SettingsRow
            title="Studio instructions"
            description="Gives each new conversation Harp's rules and Roblox skills for working in Studio."
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
                : "Adds Roblox's mesh, texture and material generation beside Harp's tools."
            }
            control={
              <Switch
                checked={roblox.officialMcpAlongside}
                onCheckedChange={(officialMcpAlongside) => update({ officialMcpAlongside })}
                aria-label="Also connect Roblox's own MCP"
              />
            }
          />
          {roblox.openCloudApiKey.length > 0 ? (
            <SettingsRow
              title="Saved Open Cloud key"
              description="Harp no longer uploads with an Open Cloud key. Agents ask whether to publish through the Roblox Assistant or let you publish."
              control={
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => update({ openCloudApiKey: "" })}
                >
                  Remove key
                </Button>
              }
            />
          ) : null}
        </SettingsSection>
      ) : null}

      {roblox.mode === "off" ? null : (
        <SettingsSection
          id="roblox-studio-blender"
          title="Blender"
          description="Model in Blender and bring the result into Studio."
        >
          {roblox.mode === "sealcode" ? (
            <SettingsRow
              title="Blender executable"
              description={
                status?.blender.problem ??
                (status?.blender.version
                  ? `${status.blender.version} at ${status.blender.executable ?? "the detected path"}`
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
        </SettingsSection>
      )}
    </>
  );
}

export function RobloxStudioSettingsPanel() {
  const canManageLocalBackend = useCanManageLocalBackend();
  return (
    <SettingsPageContainer>
      {canManageLocalBackend ? (
        <RobloxStudioSettings />
      ) : (
        <SettingsCallout>
          Roblox Studio settings are only available on the computer that runs Harp.
        </SettingsCallout>
      )}
    </SettingsPageContainer>
  );
}

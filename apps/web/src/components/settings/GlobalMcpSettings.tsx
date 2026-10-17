import { PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  GlobalMcpServer,
  GlobalMcpStatus,
  GlobalMcpTransport,
  McpSecretField,
} from "@t3tools/contracts";

import { usePrimaryEnvironment } from "~/state/environments";
import { serverEnvironment } from "~/state/server";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { usePrimarySettings, useUpdatePrimarySettings } from "~/hooks/useSettings";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsSection, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const TRANSPORTS: ReadonlyArray<{ value: GlobalMcpTransport; label: string }> = [
  { value: "stdio", label: "Local process (stdio)" },
  { value: "streamable-http", label: "Streamable HTTP" },
  { value: "sse", label: "SSE" },
];

const newServer = (id: string): GlobalMcpServer => ({
  id,
  displayName: "New MCP server",
  enabled: false,
  transport: "stdio",
  command: "mcp-server",
  args: [],
  env: [],
  headers: [],
});

function FieldList({
  fields,
  kind,
  onChange,
}: {
  readonly fields: ReadonlyArray<McpSecretField>;
  readonly kind: "environment variable" | "header";
  readonly onChange: (fields: ReadonlyArray<McpSecretField>) => void;
}) {
  return (
    <div className="space-y-2">
      {fields.map((field, index) => (
        <McpFieldRow
          key={`${field.name}-${index}`}
          field={field}
          kind={kind}
          onChange={(next) => {
            const updated = [...fields];
            updated[index] = next;
            onChange(updated);
          }}
          onRemove={() => onChange(fields.filter((_, fieldIndex) => fieldIndex !== index))}
        />
      ))}
      <Button
        type="button"
        size="xs"
        variant="ghost"
        onClick={() =>
          onChange([
            ...fields,
            {
              name: kind === "header" ? "X-MCP-Header" : "MCP_VALUE",
              value: "",
              sensitive: true,
            },
          ])
        }
      >
        <PlusIcon className="size-3" />
        Add {kind}
      </Button>
    </div>
  );
}

function McpFieldRow({
  field,
  kind,
  onChange,
  onRemove,
}: {
  readonly field: McpSecretField;
  readonly kind: "environment variable" | "header";
  readonly onChange: (field: McpSecretField) => void;
  readonly onRemove: () => void;
}) {
  const [name, setName] = useState(field.name);
  const [value, setValue] = useState(field.value);

  // Adopt a changed field (reordered row, committed edit) without an extra effect render.
  const [syncedField, setSyncedField] = useState({ name: field.name, value: field.value });
  if (syncedField.name !== field.name || syncedField.value !== field.value) {
    setSyncedField({ name: field.name, value: field.value });
    setName(field.name);
    setValue(field.value);
  }

  const commit = () => {
    if (value.length > 0) {
      const { valueRedacted: _omit, ...withoutRedaction } = field;
      onChange({ ...withoutRedaction, name, value });
      return;
    }
    onChange({ ...field, name, value });
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Input
        value={name}
        placeholder={kind === "header" ? "Header name" : "VARIABLE_NAME"}
        aria-label={`${kind} name`}
        onChange={(event) => setName(event.target.value)}
        onBlur={commit}
        className="sm:w-48"
      />
      <Input
        value={value}
        placeholder={field.valueRedacted ? "Stored secret (leave blank to keep)" : "Value"}
        type={field.sensitive ? "password" : "text"}
        aria-label={`${kind} value`}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        className="min-w-0 flex-1"
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={field.sensitive}
          onChange={(event) => onChange({ ...field, sensitive: event.target.checked })}
        />
        Sensitive
      </label>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="size-7 shrink-0"
        aria-label={`Remove ${kind}`}
        onClick={onRemove}
      >
        <Trash2Icon className="size-3.5" />
      </Button>
    </div>
  );
}

function McpServerCard({
  server,
  status,
  onChange,
  onRemove,
  onReconnect,
  reconnecting,
}: {
  readonly server: GlobalMcpServer;
  readonly status: GlobalMcpStatus | undefined;
  readonly onChange: (server: GlobalMcpServer) => void;
  readonly onRemove: () => void;
  readonly onReconnect: () => void;
  readonly reconnecting: boolean;
}) {
  const isRemote = server.transport !== "stdio";
  return (
    <div className="rounded-xl border border-border/70 bg-muted/10 p-3 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(9rem,0.6fr)_minmax(0,1fr)]">
          <Input
            value={server.id}
            aria-label="MCP server id"
            onChange={(event) => onChange({ ...server, id: event.target.value })}
          />
          <Input
            value={server.displayName}
            aria-label="MCP server display name"
            onChange={(event) => onChange({ ...server, displayName: event.target.value })}
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={server.enabled}
            onCheckedChange={(enabled) => onChange({ ...server, enabled })}
            aria-label={`Enable ${server.displayName}`}
          />
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Remove MCP server"
            onClick={onRemove}
          >
            <Trash2Icon className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>Transport</span>
          <Select
            value={server.transport}
            onValueChange={(value) => {
              if (typeof value !== "string") return;
              const transport = value as GlobalMcpTransport;
              const {
                command: _command,
                url: _url,
                args: _args,
                cwd: _cwd,
                env: _env,
                headers: _headers,
                ...base
              } = server;
              onChange(
                transport === "stdio"
                  ? {
                      ...base,
                      transport,
                      command: server.command ?? "mcp-server",
                      args: server.args,
                      env: server.env,
                      headers: [],
                    }
                  : {
                      ...base,
                      transport,
                      url: server.url ?? "",
                      args: [],
                      env: [],
                      headers: server.headers,
                    },
              );
            }}
          >
            <SelectTrigger aria-label="MCP transport">
              <SelectValue>
                {TRANSPORTS.find((item) => item.value === server.transport)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {TRANSPORTS.map((item) => (
                <SelectItem key={item.value} value={item.value} hideIndicator>
                  {item.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </label>
        {isRemote ? (
          <Input
            value={server.url ?? ""}
            placeholder="https://example.test/mcp"
            aria-label="MCP server URL"
            onChange={(event) => onChange({ ...server, url: event.target.value })}
          />
        ) : (
          <Input
            value={server.command ?? ""}
            placeholder="Command"
            aria-label="MCP server command"
            onChange={(event) => onChange({ ...server, command: event.target.value })}
          />
        )}
      </div>

      {server.transport === "stdio" ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Input
            value={(server.args ?? []).join(" ")}
            placeholder="Arguments separated by spaces"
            aria-label="MCP server arguments"
            onChange={(event) =>
              onChange({
                ...server,
                args: event.target.value.trim() ? event.target.value.trim().split(/\s+/u) : [],
              })
            }
          />
          <Input
            value={server.cwd ?? ""}
            placeholder="Working directory (optional)"
            aria-label="MCP server working directory"
            onChange={(event) => {
              const cwd = event.target.value;
              if (cwd) {
                onChange({ ...server, cwd });
              } else {
                const { cwd: _cwd, ...withoutCwd } = server;
                onChange(withoutCwd);
              }
            }}
          />
        </div>
      ) : null}

      <div className="mt-4">
        {server.transport === "stdio" ? (
          <>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Environment</p>
            <FieldList
              fields={server.env}
              kind="environment variable"
              onChange={(env) => onChange({ ...server, env })}
            />
          </>
        ) : (
          <>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Headers</p>
            <FieldList
              fields={server.headers}
              kind="header"
              onChange={(headers) => onChange({ ...server, headers })}
            />
          </>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className={status?.state === "ready" ? "text-success" : undefined}>
          {status?.state ?? (server.enabled ? "connecting" : "disabled")}
        </span>
        <span>{status?.toolCount ?? 0} tools</span>
        {status?.errorMessage ? (
          <span className="text-destructive">{status.errorMessage}</span>
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
    </div>
  );
}

export function GlobalMcpSettings() {
  const primaryEnvironment = usePrimaryEnvironment();
  const environmentId = primaryEnvironment?.environmentId ?? null;
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const statusesQuery = useEnvironmentQuery(
    environmentId === null ? null : serverEnvironment.mcpStatuses({ environmentId, input: {} }),
  );
  const statusUpdates = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.mcpStatusUpdates({ environmentId, input: {} }),
  );
  const reconnectMcp = useAtomCommand(serverEnvironment.reconnectMcp, {
    reportFailure: false,
  });
  const [reconnectingId, setReconnectingId] = useState<string | null>(null);
  const statuses = statusUpdates.data?.statuses ?? statusesQuery.data ?? [];
  const statusById = useMemo(
    () => new Map(statuses.map((status) => [status.id, status] as const)),
    [statuses],
  );
  const servers = settings.mcpServers ?? {};

  const commit = (next: Record<string, GlobalMcpServer>) => updateSettings({ mcpServers: next });
  const updateServer = (previousId: string, next: GlobalMcpServer) => {
    const nextServers = { ...servers };
    if (previousId !== next.id) delete nextServers[previousId];
    nextServers[next.id] = next;
    commit(nextServers);
  };

  return (
    <SettingsSection {...searchableSetting("global-mcp-servers")}>
      <p className="px-3 text-xs leading-relaxed text-muted-foreground sm:px-4">
        Connect external MCP servers once for this SealCode environment. Every provider receives the
        authenticated gateway, while local process configuration stays on the server.
      </p>
      {Object.values(servers).map((server) => (
        <McpServerCard
          key={server.id}
          server={server}
          status={statusById.get(server.id)}
          reconnecting={reconnectingId === server.id}
          onChange={(next) => updateServer(server.id, next)}
          onRemove={() => {
            const next = { ...servers };
            delete next[server.id];
            commit(next);
          }}
          onReconnect={() => {
            if (environmentId === null) return;
            setReconnectingId(server.id);
            void reconnectMcp({ environmentId, input: { id: server.id } }).finally(() =>
              setReconnectingId(null),
            );
          }}
        />
      ))}
      <SettingsRow
        title="Add server"
        description="Add a disabled server, then fill in its transport details before enabling it."
        control={
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => {
              const base = "mcp-server";
              let id = base;
              let suffix = 2;
              while (servers[id]) id = `${base}-${suffix++}`;
              const server = newServer(id);
              commit({ ...servers, [server.id]: server });
            }}
          >
            <PlusIcon className="size-3" />
            Add server
          </Button>
        }
      />
    </SettingsSection>
  );
}

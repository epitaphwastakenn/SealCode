import * as readline from "node:readline";

let model = "gemini-test";
let mode = "default";
let heldPrompt;
let permissionPrompt;
const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
const result = (id, value) => send({ id, result: value });
const update = (value) => send({ method: "session/update", params: { sessionId: "acp-test-session", update: value } });
const text = (value) => update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: value } });
const configOptions = () => [
  { id: "model", name: "Model", type: "select", currentValue: model, options: [
    { value: "gemini-test", name: "Gemini Test" }, { value: "gemini-other", name: "Gemini Other" },
  ] },
  { id: "mode", name: "Mode", type: "select", currentValue: mode, options: [
    { value: "default", name: "Default" }, { value: "auto_edit", name: "Auto edit" }, { value: "yolo", name: "Full access" },
  ] },
];
const finish = (id, answer) => { text(answer); result(id, { stopReason: "end_turn" }); };

for await (const line of readline.createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  const { id, method, params } = message;
  if (!method) {
    if (permissionPrompt !== undefined) { finish(permissionPrompt, message.result.outcome.optionId ?? "cancelled"); permissionPrompt = undefined; }
    continue;
  }
  switch (method) {
    case "initialize": result(id, { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [{ id: "oauth-personal", name: "Google" }], agentInfo: { name: "fake-antigravity", version: "1" } }); break;
    case "authenticate":
      if (process.env.ANTIGRAVITY_TEST_AUTH) process.stdout.write(`Open the following link to authenticate the ACP server: ${process.env.ANTIGRAVITY_TEST_AUTH}\n`);
      result(id, {}); break;
    case "session/new": result(id, { sessionId: "acp-test-session", configOptions: configOptions() }); break;
    case "session/resume": result(id, { configOptions: configOptions() }); break;
    case "session/load": send({ id, error: { code: -32601, message: "Use session/resume" } }); break;
    case "session/set_config_option":
      if (params.configId === "model") model = params.value;
      if (params.configId === "mode") mode = params.value;
      result(id, { configOptions: configOptions() }); break;
    case "session/cancel":
      if (heldPrompt !== undefined) { text("stopped"); result(heldPrompt, { stopReason: "cancelled" }); heldPrompt = undefined; }
      break;
    case "session/prompt": {
      const prompt = params.prompt.filter((item) => item.type === "text").map((item) => item.text).join("");
      if (prompt === "fail") { send({ id, error: { code: -32603, message: "subscription exhausted" } }); break; }
      if (prompt === "exit") process.exit(1);
      if (prompt === "hang") { heldPrompt = id; text("working"); break; }
      if (prompt === "permission" || prompt === "question") {
        permissionPrompt = id;
        send({ id: "approval", method: "session/request_permission", params: { sessionId: "acp-test-session",
          toolCall: { toolCallId: prompt === "question" ? "interaction_1" : "shell_1", title: "Choose an option", kind: "execute" },
          options: prompt === "question" ? [{ optionId: "a", name: "Option A", kind: "allow_once" }, { optionId: "b", name: "Option B", kind: "allow_once" }]
            : [{ optionId: "allow", name: "Allow", kind: "allow_once" }, { optionId: "deny", name: "Deny", kind: "reject_once" }],
        } }); break;
      }
      if (prompt === "tools") update({ sessionUpdate: "tool_call", toolCallId: "failed-tool", title: "A tool failed", status: "failed", kind: "execute" });
      finish(id, model); break;
    }
  }
}

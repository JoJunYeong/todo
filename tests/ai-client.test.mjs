import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DaynoteClient,
  mcpMessage,
  dispatch,
  TOOL_DEFINITIONS,
} from "../public/daynote-ai.mjs";

const config = {
  version: 1,
  projectId: "demo-daynote-ein6xs",
  ownerUid: "owner",
  agentUid: "agent",
  apiKey: "demo",
  refreshToken: "test-only",
  emulator: true,
};
test("client refuses owner credentials and production emulator redirection", () => {
  assert.throws(() => new DaynoteClient({ ...config, agentUid: "owner" }));
  assert.throws(() => new DaynoteClient({ ...config, projectId: "jjy-todo" }));
});
test("filtered empty pages retain the cursor, and calendar cursors can be followed", async () => {
  const urls = [];
  const client = new DaynoteClient(config, {
    fetch: async (url) => {
      urls.push(String(url));
      return Response.json(
        String(url).includes("/token?")
          ? { id_token: "test", user_id: "agent", expires_in: 3600 }
          : { documents: [], nextPageToken: "another/page+=" },
      );
    },
  });
  const result = await client.listTasks({ query: "absent" });
  assert.deepEqual(result, {
    tasks: [],
    nextPageToken: "another/page+=",
    scanned: 0,
    complete: false,
  });
  await client.listCalendars({ pageToken: result.nextPageToken });
  assert.equal(
    new URL(urls.at(-1)).searchParams.get("pageToken"),
    result.nextPageToken,
  );
});
test("MCP advertises bounded tools, reports tool errors, and never dispatches arbitrary methods", async () => {
  const client = {
    status: async () => ({ serverVerified: true }),
    getTask: async () => {
      throw Object.assign(Error("권한 없음"), { code: "PERMISSION_DENIED" });
    },
  };
  const initialized = await mcpMessage(client, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
  });
  assert.equal(initialized.result.serverInfo.name, "daynote");
  assert.equal(
    await mcpMessage(client, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
    null,
  );
  const listed = await mcpMessage(client, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
  });
  assert.equal(listed.result.tools.length, 7);
  assert.ok(
    listed.result.tools.every(
      (t) =>
        t.inputSchema.additionalProperties === false && !("operation" in t),
    ),
  );
  const called = await mcpMessage(client, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "daynote_status" },
  });
  assert.equal(JSON.parse(called.result.content[0].text).serverVerified, true);
  const denied = await mcpMessage(client, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "daynote_get_task", arguments: { taskId: "one" } },
  });
  assert.equal(denied.result.isError, true);
  assert.equal(
    JSON.parse(denied.result.content[0].text).error,
    "PERMISSION_DENIED",
  );
  await assert.rejects(dispatch(client, "constructor"));
  assert.ok(TOOL_DEFINITIONS.some((t) => t.operation === "appendNote"));
});

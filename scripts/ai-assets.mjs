import fs from "node:fs/promises";
import { AI_PROMPT } from "../src/ai-prompt.js";
const config = JSON.parse(
  await fs.readFile(new URL("../src/firebase-config.json", import.meta.url)),
);
const parameter = (
  name,
  location,
  schema = { type: "string" },
  required = true,
) => ({ name, in: location, required, schema });
const value = {
  oneOf: [
    {
      type: "object",
      properties: { stringValue: { type: "string" } },
      required: ["stringValue"],
    },
    {
      type: "object",
      properties: { integerValue: { type: "string" } },
      required: ["integerValue"],
    },
    {
      type: "object",
      properties: { doubleValue: { type: "number" } },
      required: ["doubleValue"],
    },
    {
      type: "object",
      properties: { booleanValue: { type: "boolean" } },
      required: ["booleanValue"],
    },
    {
      type: "object",
      properties: { nullValue: { type: "null" } },
      required: ["nullValue"],
    },
    {
      type: "object",
      properties: {
        arrayValue: {
          type: "object",
          properties: {
            values: {
              type: "array",
              items: { $ref: "#/components/schemas/Value" },
            },
          },
        },
      },
      required: ["arrayValue"],
    },
    {
      type: "object",
      properties: {
        mapValue: {
          type: "object",
          properties: { fields: { $ref: "#/components/schemas/Fields" } },
        },
      },
      required: ["mapValue"],
    },
  ],
};
const json = (schema) => ({ "application/json": { schema } });
const response = (schema = { type: "object" }) => ({
  200: { description: "Server result", content: json(schema) },
  401: { description: "Refresh the delegated Firebase ID token" },
  403: { description: "Expired, revoked, disabled, or insufficient access" },
  409: {
    description: "Concurrent change or idempotency conflict; read latest data",
  },
});
const root = `/v1/projects/${config.projectId}/databases/(default)/documents`;
const owner = parameter("ownerUid", "path");
const schema = {
  openapi: "3.1.0",
  info: {
    title: "Daynote AI HTTP API (Firebase REST)",
    version: "1.0.0",
    description:
      "Delegated per-agent access. Credentials are issued in Daynote > Settings > AI connection. GitHub Pages serves documentation and the client; Firebase serves the authenticated API. Never use an owner's password or service-account key.",
  },
  servers: [{ url: "https://firestore.googleapis.com" }],
  security: [{ firebaseIdToken: [] }],
  components: {
    securitySchemes: {
      firebaseIdToken: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "Firebase ID token for agentUid",
      },
    },
    schemas: {
      Value: value,
      Fields: {
        type: "object",
        additionalProperties: { $ref: "#/components/schemas/Value" },
      },
      Document: {
        type: "object",
        properties: {
          name: { type: "string" },
          fields: { $ref: "#/components/schemas/Fields" },
          updateTime: { type: "string" },
        },
      },
      Write: {
        type: "object",
        required: ["update", "currentDocument"],
        properties: {
          update: { $ref: "#/components/schemas/Document" },
          updateMask: {
            type: "object",
            properties: {
              fieldPaths: { type: "array", items: { type: "string" } },
            },
          },
          currentDocument: {
            type: "object",
            description:
              "Use exists:false for creation, or the exact updateTime returned by GET for modification.",
            properties: {
              exists: { type: "boolean" },
              updateTime: { type: "string" },
            },
          },
        },
      },
    },
  },
  paths: {
    "/v1/token": {
      post: {
        operationId: "refreshDaynoteAiToken",
        servers: [{ url: "https://securetoken.googleapis.com" }],
        security: [],
        parameters: [
          parameter("key", "query", { type: "string", default: config.apiKey }),
        ],
        requestBody: {
          required: true,
          content: {
            "application/x-www-form-urlencoded": {
              schema: {
                type: "object",
                required: ["grant_type", "refresh_token"],
                properties: {
                  grant_type: { type: "string", const: "refresh_token" },
                  refresh_token: { type: "string", writeOnly: true },
                },
              },
            },
          },
        },
        responses: response({
          type: "object",
          properties: {
            id_token: { type: "string" },
            refresh_token: { type: "string" },
            user_id: { type: "string" },
            expires_in: { type: "string" },
          },
        }),
      },
    },
    [`${root}/users/{ownerUid}/aiConnections/{agentUid}`]: {
      get: {
        operationId: "getDaynoteAiConnection",
        parameters: [owner, parameter("agentUid", "path")],
        responses: response({ $ref: "#/components/schemas/Document" }),
      },
    },
    [`${root}/users/{ownerUid}/aiConnections/{agentUid}/requests/{requestKey}`]:
      {
        get: {
          operationId: "getDaynoteAiRequestReceipt",
          description:
            "Look up the SHA-256 requestId receipt before retrying a mutation. A missing receipt returns 404. Follow the hashing and atomic-write procedure in AI_API.md or use the downloadable client.",
          parameters: [
            owner,
            parameter("agentUid", "path"),
            parameter("requestKey", "path", {
              type: "string",
              pattern: "^[a-f0-9]{64}$",
            }),
          ],
          responses: {
            ...response({ $ref: "#/components/schemas/Document" }),
            404: {
              description:
                "No receipt yet; safe to attempt the same atomic commit",
            },
          },
        },
      },
    [`${root}/users/{ownerUid}/calendars`]: {
      get: {
        operationId: "listDaynoteCalendars",
        parameters: [
          owner,
          parameter(
            "pageSize",
            "query",
            { type: "integer", maximum: 100 },
            false,
          ),
          parameter("pageToken", "query", undefined, false),
        ],
        responses: response(),
      },
    },
    [`${root}/users/{ownerUid}/tasks`]: {
      get: {
        operationId: "listDaynoteTasks",
        description:
          "Follow every nextPageToken. Search and filter locally. Missing matches on one page do not imply no matches overall.",
        parameters: [
          owner,
          parameter(
            "pageSize",
            "query",
            { type: "integer", maximum: 100 },
            false,
          ),
          parameter("pageToken", "query", undefined, false),
        ],
        responses: response(),
      },
    },
    [`${root}/users/{ownerUid}/tasks/{taskId}`]: {
      get: {
        operationId: "getDaynoteTask",
        parameters: [owner, parameter("taskId", "path")],
        responses: response({ $ref: "#/components/schemas/Document" }),
      },
    },
    [`${root}:commit`]: {
      post: {
        operationId: "commitDaynoteAiChange",
        description:
          "Atomically write a task and its create-only idempotency receipt. Prefer the downloadable client/MCP, which builds these writes. GET the task after success. Never replace an entire existing document: send updateMask and currentDocument.updateTime.",
        requestBody: {
          required: true,
          content: json({
            type: "object",
            required: ["writes"],
            properties: {
              writes: {
                type: "array",
                minItems: 2,
                maxItems: 2,
                items: { $ref: "#/components/schemas/Write" },
              },
            },
          }),
        },
        responses: response(),
      },
    },
  },
};
await fs.writeFile(
  new URL("../dist/ai-instructions.txt", import.meta.url),
  AI_PROMPT,
);
await fs.writeFile(
  new URL("../dist/ai-openapi.json", import.meta.url),
  JSON.stringify(schema, null, 2) + "\n",
);
console.log("AI instructions and OpenAPI generated (no private credentials).");

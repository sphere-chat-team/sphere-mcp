import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * ビルド済み dist/index.js を実際に子プロセスとして起動し、stdio で MCP の握手ができることを確認する。
 * Sphere API の代わりに固定応答の HTTP サーバーを立てる。
 */

const DIST = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const CONVERSATION_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const TEST_TOKEN = "sph_" + "t".repeat(43);
const REJECTED_TOKEN = "sph_" + "x".repeat(43);

const fixtures: Record<string, { status: number; body: unknown }> = {
  "GET /api/token/me": {
    status: 200,
    body: {
      status: "SUCCESS",
      message: "ok",
      data: {
        user: { id: "01USER000000000000000000000", user_name: "Taro", user_language: "ja" },
        token: { id: 1, name: "Claude Code", token_prefix: "sph_abcdefgh", can_write: false, include_dm: true, expires_at: null, last_used_at: null, revoked_at: null, created_at: null },
      },
    },
  },
  "GET /api/token/conversations": {
    status: 200,
    body: {
      status: "SUCCESS",
      message: "ok",
      data: [{ id: CONVERSATION_ID, type: "group", name: "Team", partner_external_user_id: null, latest_message_at: null, unread_count: 0 }],
    },
  },
};

/** dist を子プロセスで起動して終了を待つ。spawnSync だと同一プロセスのスタブ HTTP サーバーが応答できないので非同期で待つ */
function runDist(env: NodeJS.ProcessEnv, args: string[] = []): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [DIST, ...args], { env: { PATH: process.env.PATH ?? "", ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

describe("dist/index.js over stdio", () => {
  let http: Server;
  let baseUrl: string;
  const seenAuthorization: string[] = [];

  beforeAll(async () => {
    if (!existsSync(DIST)) {
      throw new Error("dist/index.js がありません。先に `npm run build` を実行してください。");
    }

    http = createServer((req, res) => {
      seenAuthorization.push(req.headers.authorization ?? "");
      if (req.headers.authorization === `Bearer ${REJECTED_TOKEN}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "UNAUTHORIZED", message: "Unauthorized", data: [] }));
        return;
      }
      const fixture = fixtures[`${req.method} ${new URL(req.url ?? "/", "http://localhost").pathname}`];
      res.writeHead(fixture?.status ?? 404, { "Content-Type": "application/json" });
      res.end(JSON.stringify(fixture?.body ?? { status: "NOT_FOUND", message: "not found", data: [] }));
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });

  it("exits with a clear message when the environment is incomplete", async () => {
    const missingUrl = await runDist({});
    expect(missingUrl.status).toBe(1);
    expect(missingUrl.stderr).toContain("SPHERE_API_URL");
    expect(missingUrl.stdout).toBe("");

    const badToken = await runDist({ SPHERE_API_URL: "https://api.example.com", SPHERE_API_TOKEN: "sph_SECRET\nvalue" });
    expect(badToken.status).toBe(1);
    expect(badToken.stderr).toContain("形式が違います");
    expect(badToken.stderr).not.toContain("SECRET");
  });

  it("runs as a CLI when given a subcommand, without starting the MCP server", async () => {
    const result = await runDist({ SPHERE_API_URL: baseUrl, SPHERE_API_TOKEN: TEST_TOKEN }, ["conversations", "--json"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toMatchObject({ id: CONVERSATION_ID, type: "group", name: "Team" });

    const unknown = await runDist({ SPHERE_API_URL: baseUrl, SPHERE_API_TOKEN: TEST_TOKEN }, ["nope"]);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain("不明なサブコマンド");
    expect(unknown.stderr).not.toContain(TEST_TOKEN);
  });

  it("exits when /me is rejected, and explains a wrong URL on 404", async () => {
    // 401: トークンが無効（末尾 /api 付きの URL でも origin に正規化される）
    const rejected = await runDist({ SPHERE_API_URL: `${baseUrl}/api`, SPHERE_API_TOKEN: REJECTED_TOKEN });
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("新しいトークンを発行");
    expect(rejected.stderr).not.toContain(REJECTED_TOKEN);

    // 404: API ではない場所を指している
    const notApi = createServer((_req, res) => {
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end("<html>not found</html>");
    });
    await new Promise<void>((resolve) => notApi.listen(0, "127.0.0.1", resolve));
    try {
      const wrongUrl = await runDist({ SPHERE_API_URL: `http://127.0.0.1:${(notApi.address() as AddressInfo).port}`, SPHERE_API_TOKEN: TEST_TOKEN });
      expect(wrongUrl.status).toBe(1);
      expect(wrongUrl.stderr).toContain("SPHERE_API_URL");
    } finally {
      await new Promise<void>((resolve) => notApi.close(() => resolve()));
    }
  });

  it("starts, probes /me, and serves tools matching the token's permissions", async () => {
    seenAuthorization.length = 0;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [DIST],
      env: { ...process.env, SPHERE_API_URL: baseUrl, SPHERE_API_TOKEN: TEST_TOKEN },
      stderr: "pipe",
    });
    const client = new Client({ name: "stdio-test", version: "0.0.0" });

    try {
      await client.connect(transport);

      const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
      // can_write=false なので送信系は出ない
      expect(tools).toEqual(["get_conversation", "list_conversations", "list_messages", "search_all_messages", "search_messages", "whoami"]);

      const result = await client.callTool({ name: "list_conversations", arguments: {} });
      const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(payload.conversations[0]).toMatchObject({ id: CONVERSATION_ID, type: "group", name: "Team" });

      expect(seenAuthorization.every((value) => value === `Bearer ${TEST_TOKEN}`)).toBe(true);
    } finally {
      await client.close();
    }
  });
});

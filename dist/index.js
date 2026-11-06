#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isCliInvocation, runCli } from "./cli.js";
import { SphereApiClient, SphereApiError, describeApiError } from "./client.js";
import { ConfigError, loadConfig } from "./config.js";
import { SERVER_INSTRUCTIONS, registerTools, toAccessInfo } from "./tools.js";
import { VERSION } from "./version.js";
// stdio transport では stdout が MCP のチャンネルなので、人向けの出力はすべて stderr に出す。
// トークンや URL の値はここに出さない（MCP クライアントが stderr をログに残すことがある）
function log(message) {
    process.stderr.write(`[sphere-mcp] ${message}\n`);
}
async function main() {
    let config;
    try {
        config = loadConfig(process.env);
    }
    catch (error) {
        log(error instanceof ConfigError ? error.message : String(error));
        process.exit(1);
    }
    const api = new SphereApiClient({ baseUrl: config.baseUrl, token: config.token });
    // 起動時にトークンを確認し、権限に応じて登録するツールを決める
    let access;
    try {
        access = toAccessInfo(await api.me());
    }
    catch (error) {
        // 起動時の 404 は会話が無いのではなく URL の誤り（/api/token/me が無い）なので、案内を変える
        log(error instanceof SphereApiError && error.status === 404
            ? "GET /api/token/me が 404 です。SPHERE_API_URL が Sphere の API のホスト（例: https://api.example.com）を指しているか確認してください。"
            : describeApiError(error));
        process.exit(1);
    }
    if (config.forceReadOnly && access.canWrite) {
        access = { ...access, canWrite: false };
        log("SPHERE_MCP_READ_ONLY が指定されているため、送信系ツールは登録しません。");
    }
    const server = new McpServer({ name: "sphere", version: VERSION }, { instructions: SERVER_INSTRUCTIONS });
    registerTools(server, api, access);
    await server.connect(new StdioServerTransport());
    log(`接続しました: ${config.baseUrl} / ${access.user.user_name} / トークン「${access.token.name}」（送信: ${access.canWrite ? "可" : "不可"}, DM: ${access.includeDm ? "含む" : "含まない"}）`);
}
// 引数があれば CLI（search / messages / conversations / help）、なければ MCP サーバー。
// bin は sphere-mcp 1 つのまま（npx が実行するものを決められなくなるため増やさない）
const args = process.argv.slice(2);
if (isCliInvocation(args)) {
    runCli(args, {
        env: process.env,
        stdout: (text) => process.stdout.write(text),
        stderr: (text) => process.stderr.write(text),
    }).then((code) => {
        process.exitCode = code;
    });
}
else {
    main().catch((error) => {
        log(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}

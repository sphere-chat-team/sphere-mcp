import { parseArgs } from "node:util";
import { SphereApiClient, describeApiError, type ApiMessage, type ApiSearchHit, type SphereApi } from "./client.js";
import { ConfigError, loadConfig } from "./config.js";
import { formatConversation, formatMessage, type Conversation, type Message } from "./format.js";

/**
 * コマンドラインから Sphere を検索・取得する。MCP サーバーと同じエントリ（index.ts）から、
 * 第 1 引数がサブコマンドのときだけ呼ばれる。トークンと URL は MCP と同じ環境変数から読む。
 * 出力は 1 行 1 件。他のユーザーが書いた文字列を端末に出すので、改行と制御文字は空白に置き換える。
 */

export const SUBCOMMANDS = ["search", "messages", "conversations", "help"] as const;

export const HELP_TEXT = [
  "使い方: sphere-mcp <サブコマンド> [オプション]",
  "",
  "  search <語> [--since 日付] [--until 日付] [--limit 件数] [--conversation <id>]",
  "      全会話（--conversation を付けるとその会話内）を部分一致で検索する。新しい順",
  "  messages <conversation_id> [--limit 件数(1-30)] [--before <message_id>]",
  "      会話のメッセージを古い順に表示する（既定は最新から）。--before で、その ID より前を取得する",
  "  conversations",
  "      参加している会話の一覧",
  "  help",
  "      この説明",
  "",
  "共通オプション: --json（1 行 1 件の JSON Lines で出力）",
  "日付は YYYY-MM-DD または \"YYYY-MM-DD HH:MM:SS\"（JST）。--until が日付だけならその日の終わりまで含む",
  "環境変数: SPHERE_API_URL / SPHERE_API_TOKEN（MCP サーバーと同じ）",
  "引数なしで起動すると MCP サーバーとして動く",
].join("\n");

export interface CliIo {
  env: NodeJS.ProcessEnv;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** テストで差し替える。既定は環境変数から作る SphereApiClient */
  createApi?: (env: NodeJS.ProcessEnv) => SphereApi;
}

class UsageError extends Error {}

/** 引数があれば CLI、なければ MCP サーバーとして起動する */
export function isCliInvocation(args: readonly string[]): boolean {
  return args.length > 0;
}

/** 1 行に収める。改行・タブ・その他の制御文字（端末のエスケープシーケンスを含む）を空白にする */
export function oneLine(text: string | null | undefined): string {
  return (text ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").trim();
}

function parseLimit(raw: string | undefined, max: number): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > max) {
    throw new UsageError(`--limit は 1〜${max} の整数で指定してください。`);
  }
  return Number(raw);
}

function parsePositiveInt(raw: string, name: string): number {
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new UsageError(`${name} は 1 以上の整数で指定してください。`);
  }
  return Number(raw);
}

export function formatSearchHitLine(hit: ApiSearchHit): string {
  const name = oneLine(hit.conversation_name) || hit.conversation_id;
  return `${hit.sent_at}  [${name}] ${oneLine(hit.user_name) || "?"}: ${oneLine(hit.snippet)}  (${hit.conversation_id} #${hit.message_id})`;
}

export function formatMessageLine(conversationId: string, message: Message): string {
  const content = message.deleted ? "(削除済み)" : oneLine(message.content);
  return `${message.sent_at}  ${oneLine(message.sender.name) || "?"}: ${content}  (${conversationId} #${message.id})`;
}

export function formatConversationLine(conversation: Conversation): string {
  const name = oneLine(conversation.name) || (conversation.type === "dm" ? "(DM)" : "(名前なし)");
  return `${conversation.latest_message_at ?? "-"}  [${conversation.type}] ${name}  未読 ${conversation.unread_count}  (${conversation.id})`;
}

/** フィード行を除いて整形する */
function toMessages(rows: ApiMessage[]): Message[] {
  return rows.filter((row) => row.type === undefined || row.type === "message").map(formatMessage);
}

function emit(io: CliIo, json: boolean, items: Array<{ json: object; line: string }>): void {
  for (const item of items) {
    io.stdout(`${json ? JSON.stringify(item.json) : item.line}\n`);
  }
}

/** 終了コードを返す。0 = 成功、1 = エラー（メッセージは stderr） */
export async function runCli(args: readonly string[], io: CliIo): Promise<number> {
  try {
    await dispatch(args, io);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`[sphere] ${error.message}\n\`help\` で使い方を表示します。\n`);
    } else if (error instanceof ConfigError) {
      io.stderr(`[sphere] ${error.message}\n`);
    } else {
      // describeApiError はトークンを含まない文言だけを返す
      io.stderr(`[sphere] ${describeApiError(error)}\n`);
    }
    return 1;
  }
}

async function dispatch(args: readonly string[], io: CliIo): Promise<void> {
  const [command, ...rest] = args;

  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      strict: true,
      options: {
        since: { type: "string" },
        until: { type: "string" },
        limit: { type: "string" },
        conversation: { type: "string" },
        before: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  const json = values.json === true;

  if (command === "help" || command === "--help" || command === "-h" || values.help === true) {
    io.stdout(`${HELP_TEXT}\n`);
    return;
  }
  if (!SUBCOMMANDS.includes(command as (typeof SUBCOMMANDS)[number])) {
    throw new UsageError(`不明なサブコマンドです: ${oneLine(command)}`);
  }

  const api = (io.createApi ?? createApiFromEnv)(io.env);

  switch (command) {
    case "search": {
      if (positionals.length !== 1 || positionals[0] === "") {
        throw new UsageError("search には検索語を 1 つ指定してください（空白を含む語は引用符で囲む）。");
      }
      const q = positionals[0];
      if (q.length > 255) throw new UsageError("検索語は 255 文字までです。");
      const params = { since: values.since, until: values.until, limit: parseLimit(values.limit, 100) };

      if (values.conversation !== undefined) {
        const conversationId = values.conversation;
        const rows = await api.searchMessages(conversationId, q, params);
        emit(
          io,
          json,
          toMessages(rows).map((message) => ({ json: { conversation_id: conversationId, ...message }, line: formatMessageLine(conversationId, message) })),
        );
      } else {
        const hits = await api.searchAllMessages(q, params);
        emit(io, json, hits.map((hit) => ({ json: hit, line: formatSearchHitLine(hit) })));
      }
      return;
    }
    case "messages": {
      if (positionals.length !== 1) {
        throw new UsageError("messages には conversation_id を 1 つ指定してください。");
      }
      const conversationId = positionals[0];
      const before = values.before === undefined ? undefined : parsePositiveInt(values.before, "--before");
      const rows = await api.listMessages(conversationId, {
        limit: parseLimit(values.limit, 30),
        ...(before === undefined ? {} : { from_id: before, direction: "<" as const }),
      });
      emit(
        io,
        json,
        toMessages(rows).map((message) => ({ json: { conversation_id: conversationId, ...message }, line: formatMessageLine(conversationId, message) })),
      );
      return;
    }
    case "conversations": {
      if (positionals.length !== 0) throw new UsageError("conversations に引数は不要です。");
      const rows = await api.listConversations();
      emit(io, json, rows.map(formatConversation).map((conversation) => ({ json: conversation, line: formatConversationLine(conversation) })));
      return;
    }
  }
}

function createApiFromEnv(env: NodeJS.ProcessEnv): SphereApi {
  const config = loadConfig(env);
  return new SphereApiClient({ baseUrl: config.baseUrl, token: config.token });
}

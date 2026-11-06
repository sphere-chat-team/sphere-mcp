/**
 * Sphere の個人用 API トークン API（/api/token/*）の薄いクライアント。
 * 認証は持たず、渡されたトークンを Authorization ヘッダに付けるだけ。
 */

import { z } from "zod";

export interface SphereApiClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  /** 1 リクエストの上限（ms）。応答しない API で起動やツール呼び出しが止まり続けないようにする */
  timeoutMs?: number;
}

export interface RequestOptions {
  /** MCP クライアントからのキャンセル（ツール呼び出しの extra.signal） */
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** API のレスポンス封筒。2xx でもこの形でなければ Sphere の API ではない（URL の誤りなど） */
const envelopeSchema = z.object({
  status: z.string(),
  message: z.string(),
  data: z.unknown(),
  errors: z.record(z.string(), z.array(z.string())).optional(),
});

const meSchema = z.object({
  user: z.object({ id: z.string(), user_name: z.string(), user_language: z.string().nullable() }),
  token: z.object({
    id: z.number(),
    name: z.string(),
    token_prefix: z.string(),
    can_write: z.boolean(),
    include_dm: z.boolean(),
    expires_at: z.string().nullable(),
    last_used_at: z.string().nullable(),
    revoked_at: z.string().nullable(),
    created_at: z.string().nullable(),
  }),
});

export type MeResponse = z.infer<typeof meSchema>;

export interface ApiConversation {
  id: string;
  type: "group" | "dm";
  name: string | null;
  partner_external_user_id: string | null;
  latest_message_at: string | null;
  unread_count: number;
}

export interface ApiConversationDetail extends Omit<ApiConversation, "partner_external_user_id" | "latest_message_at" | "unread_count"> {
  overview: string | null;
  host_external_user_id: string | null;
  created_at: string | null;
  members: Array<{ user_id: string; user_name: string; user_language: string; profile_image_url: string | null }>;
}

/**
 * メッセージ取得・検索の 1 行。
 * 送信者の外部 ID はどちらの API でも `user_id`（external_user_id の別名）で返る。
 * 取得 API はフィード行（type: 'feed'、id は 0）を混ぜて返す
 */
export interface ApiMessage {
  id: number;
  user_id?: string;
  user_name?: string;
  message_text: string | null;
  translated_message?: string | null;
  user_language?: string | null;
  created_at: string;
  edited_at?: string | null;
  reply_message_id?: number | null;
  quoted_text?: string | null;
  sent_via?: number | null;
  status?: number;
  type?: string;
  sub_type?: string | null;
  reply_message?: unknown;
}

export interface ListMessagesParams {
  from_id?: number;
  direction?: "<" | ">" | "<=" | ">=";
  loaded_by?: string;
  /** 1〜30。'<' / '<=' / 指定なしは新しい方から、'>' / '>=' は古い方から limit 件（返る順序は古い順） */
  limit?: number;
}

/** 会話内検索・全会話検索で共通の絞り込み。日時は YYYY-MM-DD または YYYY-MM-DD HH:MM:SS（JST） */
export interface SearchParams {
  since?: string;
  until?: string;
  /** 1〜100 */
  limit?: number;
}

/** 全会話をまたぐ検索の 1 件。snippet は一致箇所の前後だけの本文（切った側に "…" が付く） */
export interface ApiSearchHit {
  conversation_id: string;
  conversation_type: "group" | "dm";
  conversation_name: string | null;
  message_id: number;
  user_id: string | null;
  user_name: string | null;
  sent_at: string;
  snippet: string;
}

export interface SendMessageResult {
  message_id: number;
  message_text: string | null;
  user_language: string | null;
}

export class SphereApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly errors: Record<string, string[]> | undefined,
    message: string,
  ) {
    super(message);
    this.name = "SphereApiError";
  }

  /** errors の最初のキー文字列（例: validation.forbidden.api_token_read_only） */
  firstErrorKey(): string | null {
    if (!this.errors) return null;
    for (const values of Object.values(this.errors)) {
      if (Array.isArray(values) && values.length > 0) return String(values[0]);
    }
    return null;
  }
}

export class SphereNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SphereNetworkError";
  }
}

/** 2xx だが Sphere の API の応答ではない（URL の誤りで Web 画面の HTML が返った、など） */
export class SphereUnexpectedResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SphereUnexpectedResponseError";
  }
}

/** ツール側が依存するインターフェース（テストで差し替えるため） */
export interface SphereApi {
  me(options?: RequestOptions): Promise<MeResponse>;
  listConversations(options?: RequestOptions): Promise<ApiConversation[]>;
  getConversation(conversationId: string, options?: RequestOptions): Promise<ApiConversationDetail>;
  listMessages(conversationId: string, params?: ListMessagesParams, options?: RequestOptions): Promise<ApiMessage[]>;
  searchMessages(conversationId: string, q: string, params?: SearchParams, options?: RequestOptions): Promise<ApiMessage[]>;
  searchAllMessages(q: string, params?: SearchParams, options?: RequestOptions): Promise<ApiSearchHit[]>;
  sendMessage(conversationId: string, body: { message_text: string; reply_message_id?: number }, options?: RequestOptions): Promise<SendMessageResult>;
  editMessage(conversationId: string, messageId: number, messageText: string, options?: RequestOptions): Promise<void>;
  deleteMessage(conversationId: string, messageId: number, options?: RequestOptions): Promise<void>;
  addReaction(conversationId: string, messageId: number, stamp: string, options?: RequestOptions): Promise<void>;
  removeReaction(conversationId: string, messageId: number, stamp: string, options?: RequestOptions): Promise<void>;
}

export class SphereApiClient implements SphereApi {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: SphereApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async me(options?: RequestOptions): Promise<MeResponse> {
    const data = await this.request("GET", "/api/token/me", {}, options);
    const parsed = meSchema.safeParse(data);
    if (!parsed.success) {
      throw new SphereUnexpectedResponseError("GET /api/token/me の応答が想定の形ではありません。SPHERE_API_URL が Sphere の API を指しているか確認してください。");
    }
    return parsed.data;
  }

  listConversations(options?: RequestOptions): Promise<ApiConversation[]> {
    return this.request<ApiConversation[]>("GET", "/api/token/conversations", {}, options);
  }

  getConversation(conversationId: string, options?: RequestOptions): Promise<ApiConversationDetail> {
    return this.request<ApiConversationDetail>("GET", `/api/token/conversations/${encodeURIComponent(conversationId)}`, {}, options);
  }

  listMessages(conversationId: string, params: ListMessagesParams = {}, options?: RequestOptions): Promise<ApiMessage[]> {
    const query: Record<string, string> = {};
    if (params.from_id !== undefined) query.from_id = String(params.from_id);
    if (params.direction !== undefined) query.direction = params.direction;
    if (params.loaded_by !== undefined) query.loaded_by = params.loaded_by;
    if (params.limit !== undefined) query.limit = String(params.limit);
    // 本文の HTML エスケープを戻して返してもらう（古い API は無視するだけ）
    query.unescape = "1";
    return this.request<ApiMessage[]>("GET", `/api/token/conversations/${encodeURIComponent(conversationId)}/messages`, { query }, options);
  }

  searchMessages(conversationId: string, q: string, params: SearchParams = {}, options?: RequestOptions): Promise<ApiMessage[]> {
    return this.request<ApiMessage[]>(
      "GET",
      `/api/token/conversations/${encodeURIComponent(conversationId)}/messages/search`,
      { query: searchQuery(q, params) },
      options,
    );
  }

  /** 古い API では 404（describeApiError の文言は会話向けなので、呼び出し側で必要なら補足する） */
  searchAllMessages(q: string, params: SearchParams = {}, options?: RequestOptions): Promise<ApiSearchHit[]> {
    return this.request<ApiSearchHit[]>("GET", "/api/token/messages/search", { query: searchQuery(q, params) }, options);
  }

  sendMessage(conversationId: string, body: { message_text: string; reply_message_id?: number }, options?: RequestOptions): Promise<SendMessageResult> {
    return this.request<SendMessageResult>("POST", `/api/token/conversations/${encodeURIComponent(conversationId)}/messages`, { body }, options);
  }

  async editMessage(conversationId: string, messageId: number, messageText: string, options?: RequestOptions): Promise<void> {
    await this.request("PATCH", `/api/token/conversations/${encodeURIComponent(conversationId)}/messages/${messageId}`, { body: { message_text: messageText } }, options);
  }

  async deleteMessage(conversationId: string, messageId: number, options?: RequestOptions): Promise<void> {
    await this.request("DELETE", `/api/token/conversations/${encodeURIComponent(conversationId)}/messages/${messageId}`, {}, options);
  }

  async addReaction(conversationId: string, messageId: number, stamp: string, options?: RequestOptions): Promise<void> {
    await this.request("POST", `/api/token/conversations/${encodeURIComponent(conversationId)}/messages/${messageId}/reactions`, { body: { selected_stamp: stamp } }, options);
  }

  async removeReaction(conversationId: string, messageId: number, stamp: string, options?: RequestOptions): Promise<void> {
    await this.request("DELETE", `/api/token/conversations/${encodeURIComponent(conversationId)}/messages/${messageId}/reactions`, { body: { selected_stamp: stamp } }, options);
  }

  /** 例外文にトークンが含まれていても外に出さない（undici はヘッダ値を例外文に入れることがある） */
  private redact(message: string): string {
    return message.split(this.token).join("[redacted]");
  }

  private async request<T = unknown>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    init: { query?: Record<string, string>; body?: unknown } = {},
    options: RequestOptions = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      url.searchParams.set(key, value);
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
      "User-Agent": "sphere-mcp",
    };
    let body: string | undefined;
    if (init.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.body);
    }

    // タイムアウトと、MCP クライアントからのキャンセルの両方で中断する
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;

    let text: string;
    let response: Response;
    try {
      // API はリダイレクトしない。万一リダイレクトされてもトークンを別の場所へ送らない
      response = await this.fetchImpl(url, { method, headers, body, redirect: "error", signal });
      text = await response.text();
    } catch (error) {
      throw new SphereNetworkError(this.redact(describeFetchFailure(error, timeout)));
    }

    let json: unknown;
    try {
      json = text === "" ? undefined : JSON.parse(text);
    } catch {
      json = undefined;
    }

    if (!response.ok) {
      const envelope = envelopeSchema.safeParse(json);
      throw new SphereApiError(
        response.status,
        envelope.success ? envelope.data.errors : undefined,
        envelope.success ? envelope.data.message : `HTTP ${response.status}`,
      );
    }

    const envelope = envelopeSchema.safeParse(json);
    if (!envelope.success) {
      throw new SphereUnexpectedResponseError(
        json === undefined
          ? `Sphere の API ではない応答が返りました（HTTP ${response.status}、JSON でない）。SPHERE_API_URL が API のホストを指しているか確認してください。`
          : `Sphere の API の応答が想定の形ではありません（HTTP ${response.status}）。SPHERE_API_URL が API のホストを指しているか確認してください。`,
      );
    }

    return envelope.data.data as T;
  }
}

function searchQuery(q: string, params: SearchParams): Record<string, string> {
  const query: Record<string, string> = { q };
  if (params.since !== undefined) query.since = params.since;
  if (params.until !== undefined) query.until = params.until;
  if (params.limit !== undefined) query.limit = String(params.limit);
  query.unescape = "1";
  return query;
}

/** undici の失敗は message が "fetch failed" 固定で、原因は cause に入る */
function describeFetchFailure(error: unknown, timeout: AbortSignal): string {
  if (timeout.aborted) {
    return "応答がありません（タイムアウト）";
  }
  if (error instanceof Error && error.name === "AbortError") {
    return "キャンセルされました";
  }
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause;
    const detail = cause?.code ?? cause?.message;
    return detail ? `${error.message} (${detail})` : error.message;
  }
  return String(error);
}

/** API のエラーを、利用者（と AI）が次に何をすればよいか分かる文に変換する */
export function describeApiError(error: unknown): string {
  if (error instanceof SphereNetworkError) {
    return `Sphere に接続できません: ${error.message}。SPHERE_API_URL とネットワークを確認してください。`;
  }

  if (error instanceof SphereUnexpectedResponseError) {
    return error.message;
  }

  if (!(error instanceof SphereApiError)) {
    return error instanceof Error ? error.message : String(error);
  }

  const key = error.firstErrorKey();
  switch (error.status) {
    case 401:
      return "トークンが無効か、期限切れ・失効済みです。Sphere の設定画面で新しいトークンを発行し、SPHERE_API_TOKEN を更新してください。";
    case 403:
      switch (key) {
        case "validation.forbidden.api_token_read_only":
          return "このトークンは読み取り専用で、送信・編集・削除・リアクションはできません。必要なら Sphere の設定画面で「送信を許可する」を付けたトークンを発行してください。";
        case "validation.forbidden.api_token_write_disabled_by_organization":
          return "組織の設定で API トークンからの送信が禁止されています。組織の管理者に確認してください。";
        case "validation.forbidden.api_token_disabled_by_organization":
          return "組織の設定で API トークンの利用が無効化されています。組織の管理者に確認してください。";
        case "validation.forbidden.api_token_user_suspended":
          return "アカウントが停止中のため利用できません。";
        default:
          return `権限がありません（${key ?? error.message}）。`;
      }
    case 404:
      return "会話またはメッセージが見つかりません。自分がメンバーでない会話、DM を含めないトークンでの DM、削除済みのメッセージ、他人のメッセージの編集・削除のいずれかです。";
    case 422:
      return `リクエストの内容が不正です: ${JSON.stringify(error.errors ?? error.message)}`;
    case 429:
      return "レート制限に達しました。1 分ほど待ってから再試行してください。";
    default:
      if (error.status >= 500) {
        return `Sphere のサーバーでエラーが発生しました（HTTP ${error.status}）。しばらく待ってから再試行してください。`;
      }
      return `Sphere の API がエラーを返しました（HTTP ${error.status}: ${error.message}）。`;
  }
}

/**
 * Sphere の個人用 API トークン API（/api/token/*）の薄いクライアント。
 * 認証は持たず、渡されたトークンを Authorization ヘッダに付けるだけ。
 */
import { z } from "zod";
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
export class SphereApiError extends Error {
    status;
    errors;
    constructor(status, errors, message) {
        super(message);
        this.status = status;
        this.errors = errors;
        this.name = "SphereApiError";
    }
    /** errors の最初のキー文字列（例: validation.forbidden.api_token_read_only） */
    firstErrorKey() {
        if (!this.errors)
            return null;
        for (const values of Object.values(this.errors)) {
            if (Array.isArray(values) && values.length > 0)
                return String(values[0]);
        }
        return null;
    }
}
export class SphereNetworkError extends Error {
    constructor(message) {
        super(message);
        this.name = "SphereNetworkError";
    }
}
/** 2xx だが Sphere の API の応答ではない（URL の誤りで Web 画面の HTML が返った、など） */
export class SphereUnexpectedResponseError extends Error {
    constructor(message) {
        super(message);
        this.name = "SphereUnexpectedResponseError";
    }
}
export class SphereApiClient {
    baseUrl;
    token;
    fetchImpl;
    timeoutMs;
    constructor(options) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, "");
        this.token = options.token;
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    }
    async me(options) {
        const data = await this.request("GET", "/api/token/me", {}, options);
        const parsed = meSchema.safeParse(data);
        if (!parsed.success) {
            throw new SphereUnexpectedResponseError("GET /api/token/me の応答が想定の形ではありません。SPHERE_API_URL が Sphere の API を指しているか確認してください。");
        }
        return parsed.data;
    }
    listConversations(options) {
        return this.request("GET", "/api/token/conversations", {}, options);
    }
    getConversation(conversationId, options) {
        return this.request("GET", `/api/token/conversations/${encodeURIComponent(conversationId)}`, {}, options);
    }
    listMessages(conversationId, params = {}, options) {
        const query = {};
        if (params.from_id !== undefined)
            query.from_id = String(params.from_id);
        if (params.direction !== undefined)
            query.direction = params.direction;
        if (params.loaded_by !== undefined)
            query.loaded_by = params.loaded_by;
        return this.request("GET", `/api/token/conversations/${encodeURIComponent(conversationId)}/messages`, { query }, options);
    }
    searchMessages(conversationId, q, options) {
        return this.request("GET", `/api/token/conversations/${encodeURIComponent(conversationId)}/messages/search`, { query: { q } }, options);
    }
    sendMessage(conversationId, body, options) {
        return this.request("POST", `/api/token/conversations/${encodeURIComponent(conversationId)}/messages`, { body }, options);
    }
    async editMessage(conversationId, messageId, messageText, options) {
        await this.request("PATCH", `/api/token/conversations/${encodeURIComponent(conversationId)}/messages/${messageId}`, { body: { message_text: messageText } }, options);
    }
    async deleteMessage(conversationId, messageId, options) {
        await this.request("DELETE", `/api/token/conversations/${encodeURIComponent(conversationId)}/messages/${messageId}`, {}, options);
    }
    async addReaction(conversationId, messageId, stamp, options) {
        await this.request("POST", `/api/token/conversations/${encodeURIComponent(conversationId)}/messages/${messageId}/reactions`, { body: { selected_stamp: stamp } }, options);
    }
    async removeReaction(conversationId, messageId, stamp, options) {
        await this.request("DELETE", `/api/token/conversations/${encodeURIComponent(conversationId)}/messages/${messageId}/reactions`, { body: { selected_stamp: stamp } }, options);
    }
    /** 例外文にトークンが含まれていても外に出さない（undici はヘッダ値を例外文に入れることがある） */
    redact(message) {
        return message.split(this.token).join("[redacted]");
    }
    async request(method, path, init = {}, options = {}) {
        const url = new URL(this.baseUrl + path);
        for (const [key, value] of Object.entries(init.query ?? {})) {
            url.searchParams.set(key, value);
        }
        const headers = {
            Authorization: `Bearer ${this.token}`,
            Accept: "application/json",
            "User-Agent": "sphere-mcp",
        };
        let body;
        if (init.body !== undefined) {
            headers["Content-Type"] = "application/json";
            body = JSON.stringify(init.body);
        }
        // タイムアウトと、MCP クライアントからのキャンセルの両方で中断する
        const timeout = AbortSignal.timeout(this.timeoutMs);
        const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
        let text;
        let response;
        try {
            // API はリダイレクトしない。万一リダイレクトされてもトークンを別の場所へ送らない
            response = await this.fetchImpl(url, { method, headers, body, redirect: "error", signal });
            text = await response.text();
        }
        catch (error) {
            throw new SphereNetworkError(this.redact(describeFetchFailure(error, timeout)));
        }
        let json;
        try {
            json = text === "" ? undefined : JSON.parse(text);
        }
        catch {
            json = undefined;
        }
        if (!response.ok) {
            const envelope = envelopeSchema.safeParse(json);
            throw new SphereApiError(response.status, envelope.success ? envelope.data.errors : undefined, envelope.success ? envelope.data.message : `HTTP ${response.status}`);
        }
        const envelope = envelopeSchema.safeParse(json);
        if (!envelope.success) {
            throw new SphereUnexpectedResponseError(json === undefined
                ? `Sphere の API ではない応答が返りました（HTTP ${response.status}、JSON でない）。SPHERE_API_URL が API のホストを指しているか確認してください。`
                : `Sphere の API の応答が想定の形ではありません（HTTP ${response.status}）。SPHERE_API_URL が API のホストを指しているか確認してください。`);
        }
        return envelope.data.data;
    }
}
/** undici の失敗は message が "fetch failed" 固定で、原因は cause に入る */
function describeFetchFailure(error, timeout) {
    if (timeout.aborted) {
        return "応答がありません（タイムアウト）";
    }
    if (error instanceof Error && error.name === "AbortError") {
        return "キャンセルされました";
    }
    if (error instanceof Error) {
        const cause = error.cause;
        const detail = cause?.code ?? cause?.message;
        return detail ? `${error.message} (${detail})` : error.message;
    }
    return String(error);
}
/** API のエラーを、利用者（と AI）が次に何をすればよいか分かる文に変換する */
export function describeApiError(error) {
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

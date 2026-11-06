import { describe, expect, it, vi } from "vitest";
import { SphereApiClient, SphereApiError, SphereNetworkError, SphereUnexpectedResponseError, describeApiError } from "../src/client.js";

const TOKEN = "sph_" + "a".repeat(43);
const CONVERSATION_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function envelope(data: unknown, status = 200): Response {
  return jsonResponse(status, { status: "SUCCESS", message: "ok", data });
}

function clientWith(fetchImpl: typeof fetch, timeoutMs?: number): SphereApiClient {
  return new SphereApiClient({ baseUrl: "https://api.example.com/", token: TOKEN, fetchImpl, timeoutMs });
}

const me = {
  user: { id: "u1", user_name: "Taro", user_language: "ja" },
  token: { id: 1, name: "t", token_prefix: "sph_aaaaaaaa", can_write: true, include_dm: true, expires_at: null, last_used_at: null, revoked_at: null, created_at: null },
};

describe("SphereApiClient", () => {
  it("sends the bearer token and JSON headers, never follows redirects, and unwraps the envelope", async () => {
    const fetchImpl = vi.fn(async () => envelope(me));
    const client = clientWith(fetchImpl as unknown as typeof fetch);

    const result = await client.me();

    expect(result.user.id).toBe("u1");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("https://api.example.com/api/token/me");
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect((init.headers as Record<string, string>).Accept).toBe("application/json");
    expect(init.body).toBeUndefined();
  });

  it("builds query strings for list and search", async () => {
    const fetchImpl = vi.fn(async () => envelope([]));
    const client = clientWith(fetchImpl as unknown as typeof fetch);

    await client.listMessages(CONVERSATION_ID, { from_id: 10, direction: "<", limit: 5 });
    await client.searchMessages(CONVERSATION_ID, "deploy tomorrow");
    await client.searchMessages(CONVERSATION_ID, "x", { since: "2026-10-01", until: "2026-10-31", limit: 7 });
    await client.searchAllMessages("deploy", { since: "2026-10-01 09:00:00", limit: 20 });

    const urls = fetchImpl.mock.calls.map((call) => (call as unknown as [URL])[0].toString());
    expect(urls[0]).toBe(`https://api.example.com/api/token/conversations/${CONVERSATION_ID}/messages?from_id=10&direction=%3C&limit=5&unescape=1`);
    expect(urls[1]).toBe(`https://api.example.com/api/token/conversations/${CONVERSATION_ID}/messages/search?q=deploy+tomorrow&unescape=1`);
    expect(urls[2]).toBe(`https://api.example.com/api/token/conversations/${CONVERSATION_ID}/messages/search?q=x&since=2026-10-01&until=2026-10-31&limit=7&unescape=1`);
    expect(urls[3]).toBe("https://api.example.com/api/token/messages/search?q=deploy&since=2026-10-01+09%3A00%3A00&limit=20&unescape=1");
  });

  it("posts JSON bodies, including the body of DELETE reactions", async () => {
    const fetchImpl = vi.fn(async () => envelope({ message_id: 5 }, 201));
    const client = clientWith(fetchImpl as unknown as typeof fetch);

    const result = await client.sendMessage(CONVERSATION_ID, { message_text: "hello", reply_message_id: 3 });
    await client.removeReaction(CONVERSATION_ID, 5, "👍");

    expect(result.message_id).toBe(5);
    const [, post] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(post.method).toBe("POST");
    expect((post.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(post.body as string)).toEqual({ message_text: "hello", reply_message_id: 3 });

    const [deleteUrl, del] = fetchImpl.mock.calls[1] as unknown as [URL, RequestInit];
    expect(deleteUrl.pathname).toBe(`/api/token/conversations/${CONVERSATION_ID}/messages/5/reactions`);
    expect(del.method).toBe("DELETE");
    expect(JSON.parse(del.body as string)).toEqual({ selected_stamp: "👍" });
  });

  it("throws SphereApiError with the status and errors on non-2xx", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(403, { status: "FORBIDDEN", message: "Forbidden", data: [], errors: { api_token: ["validation.forbidden.api_token_read_only"] } }),
    );
    const client = clientWith(fetchImpl as unknown as typeof fetch);

    await expect(client.sendMessage(CONVERSATION_ID, { message_text: "x" })).rejects.toMatchObject({
      name: "SphereApiError",
      status: 403,
      errors: { api_token: ["validation.forbidden.api_token_read_only"] },
    });
  });

  it("rejects 2xx responses that are not the Sphere envelope (wrong URL)", async () => {
    const html = vi.fn(async () => new Response("<!doctype html><html></html>", { status: 200, headers: { "Content-Type": "text/html" } }));
    await expect(clientWith(html as unknown as typeof fetch).listConversations()).rejects.toBeInstanceOf(SphereUnexpectedResponseError);

    const noEnvelope = vi.fn(async () => jsonResponse(200, { message: "missing envelope fields" }));
    await expect(clientWith(noEnvelope as unknown as typeof fetch).editMessage(CONVERSATION_ID, 1, "x")).rejects.toBeInstanceOf(SphereUnexpectedResponseError);

    const empty = vi.fn(async () => new Response("", { status: 200 }));
    await expect(clientWith(empty as unknown as typeof fetch).deleteMessage(CONVERSATION_ID, 1)).rejects.toBeInstanceOf(SphereUnexpectedResponseError);
  });

  it("validates the shape of /me", async () => {
    const fetchImpl = vi.fn(async () => envelope({ user: { id: "u1" } }));

    await expect(clientWith(fetchImpl as unknown as typeof fetch).me()).rejects.toBeInstanceOf(SphereUnexpectedResponseError);
  });

  it("wraps network failures with the underlying cause and without the token", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError(`fetch failed for Bearer ${TOKEN}`, { cause: { code: "ENOTFOUND" } });
    });

    const error = await clientWith(fetchImpl as unknown as typeof fetch).me().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SphereNetworkError);
    expect((error as Error).message).toContain("ENOTFOUND");
    expect((error as Error).message).not.toContain(TOKEN);
    expect((error as Error).message).toContain("[redacted]");
  });

  it("times out requests that never respond", async () => {
    const fetchImpl = vi.fn((_url: URL, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    }));

    const error = await clientWith(fetchImpl as unknown as typeof fetch, 20).me().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SphereNetworkError);
    expect((error as Error).message).toContain("タイムアウト");
  });

  it("aborts when the caller's signal is aborted", async () => {
    const fetchImpl = vi.fn((_url: URL, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    }));
    const controller = new AbortController();
    const pending = clientWith(fetchImpl as unknown as typeof fetch).me({ signal: controller.signal }).catch((e: unknown) => e);
    controller.abort();

    const error = await pending;
    expect(error).toBeInstanceOf(SphereNetworkError);
    expect((error as Error).message).toContain("キャンセル");
  });
});

describe("describeApiError", () => {
  const apiError = (status: number, key?: string) => new SphereApiError(status, key ? { api_token: [key] } : undefined, `HTTP ${status}`);

  it("explains each token-related failure in terms the user can act on", () => {
    expect(describeApiError(apiError(401))).toContain("新しいトークンを発行");
    expect(describeApiError(apiError(403, "validation.forbidden.api_token_read_only"))).toContain("読み取り専用");
    expect(describeApiError(apiError(403, "validation.forbidden.api_token_write_disabled_by_organization"))).toContain("送信が禁止");
    expect(describeApiError(apiError(403, "validation.forbidden.api_token_disabled_by_organization"))).toContain("無効化");
    expect(describeApiError(apiError(403, "validation.forbidden.api_token_user_suspended"))).toContain("停止中");
    expect(describeApiError(apiError(404))).toContain("見つかりません");
    expect(describeApiError(apiError(429))).toContain("レート制限");
    expect(describeApiError(apiError(500))).toContain("HTTP 500");
    expect(describeApiError(new SphereNetworkError("fetch failed (ECONNREFUSED)"))).toContain("接続できません");
    expect(describeApiError(new SphereUnexpectedResponseError("not the api"))).toBe("not the api");
  });
});

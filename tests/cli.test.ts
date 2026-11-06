import { describe, expect, it, vi } from "vitest";
import { SphereApiError, type ApiMessage, type ApiSearchHit, type SphereApi } from "../src/client.js";
import { isCliInvocation, oneLine, runCli } from "../src/cli.js";

const CONVERSATION_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const TOKEN = "sph_" + "a".repeat(43);

const hit: ApiSearchHit = {
  conversation_id: CONVERSATION_ID,
  conversation_type: "group",
  conversation_name: "Team",
  message_id: 9,
  user_id: "u2",
  user_name: "Hanako",
  sent_at: "2026-11-05 10:22:00",
  snippet: "…deploy\ntomorrow…",
};

function fakeApi(overrides: Partial<SphereApi> = {}): SphereApi {
  return {
    searchAllMessages: vi.fn(async () => [hit]),
    searchMessages: vi.fn(async () => []),
    listMessages: vi.fn(async () => []),
    listConversations: vi.fn(async () => []),
    ...overrides,
  } as unknown as SphereApi;
}

async function cli(args: string[], api: SphereApi = fakeApi()) {
  const out: string[] = [];
  const err: string[] = [];
  const createApi = vi.fn(() => api);
  const code = await runCli(args, {
    env: { SPHERE_API_URL: "https://api.example.com", SPHERE_API_TOKEN: TOKEN },
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    createApi,
  });
  return { code, stdout: out.join(""), stderr: err.join(""), createApi };
}

describe("isCliInvocation", () => {
  it("starts the MCP server when there are no arguments", () => {
    expect(isCliInvocation([])).toBe(false);
    expect(isCliInvocation(["search", "x"])).toBe(true);
  });
});

describe("oneLine", () => {
  it("replaces newlines and control characters with spaces", () => {
    expect(oneLine("a\nb\r\nc\td")).toBe("a b c d");
    expect(oneLine("x\u001b[31mred")).toBe("x [31mred");
    expect(oneLine(null)).toBe("");
  });
});

describe("runCli search", () => {
  it("searches all conversations and prints one line per hit", async () => {
    const api = fakeApi();
    const result = await cli(["search", "deploy", "--since", "2026-10-01", "--until", "2026-11-05", "--limit", "5"], api);

    expect(result.code).toBe(0);
    expect(api.searchAllMessages).toHaveBeenCalledWith("deploy", { since: "2026-10-01", until: "2026-11-05", limit: 5 });
    expect(api.searchMessages).not.toHaveBeenCalled();
    expect(result.stdout).toBe(`2026-11-05 10:22:00  [Team] Hanako: …deploy tomorrow…  (${CONVERSATION_ID} #9)\n`);
  });

  it("prints JSON Lines with --json", async () => {
    const result = await cli(["search", "deploy", "--json"]);

    expect(result.stdout.split("\n").filter(Boolean)).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toEqual(hit);
  });

  it("searches inside one conversation when --conversation is given", async () => {
    const rows: ApiMessage[] = [
      { id: 3, user_id: "u2", user_name: "Hanako", message_text: "deploy\nnow", created_at: "2026-11-05 10:00:00" },
      { id: 0, user_name: "Taro", message_text: null, created_at: "2026-11-05 09:00:00", type: "feed" },
    ];
    const api = fakeApi({ searchMessages: vi.fn(async () => rows) });

    const result = await cli(["search", "deploy", "--conversation", CONVERSATION_ID], api);

    expect(api.searchMessages).toHaveBeenCalledWith(CONVERSATION_ID, "deploy", { since: undefined, until: undefined, limit: undefined });
    expect(api.searchAllMessages).not.toHaveBeenCalled();
    expect(result.stdout).toBe(`2026-11-05 10:00:00  Hanako: deploy now  (${CONVERSATION_ID} #3)\n`);
  });

  it("rejects a missing term, extra words and a bad limit without calling the API", async () => {
    const api = fakeApi();

    for (const args of [["search"], ["search", "a", "b"], ["search", "a", "--limit", "0"], ["search", "a", "--limit", "101"], ["search", "a", "--limit", "x"], ["search", "a", "--nope"]]) {
      const result = await cli(args, api);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("[sphere]");
    }
    expect(api.searchAllMessages).not.toHaveBeenCalled();
  });
});

describe("runCli messages / conversations / help", () => {
  it("prints messages in the returned order and maps --before to from_id with direction '<'", async () => {
    const rows: ApiMessage[] = [
      { id: 1, user_id: "u1", user_name: "Taro", message_text: null, created_at: "2026-11-05 09:00:00", type: "message", status: 1, sub_type: "deleted_message" },
      { id: 2, user_id: "u2", user_name: "Hanako", message_text: "hi", created_at: "2026-11-05 09:01:00", type: "message", status: 0 },
    ];
    const api = fakeApi({ listMessages: vi.fn(async () => rows) });

    const result = await cli(["messages", CONVERSATION_ID, "--limit", "2", "--before", "10"], api);

    expect(api.listMessages).toHaveBeenCalledWith(CONVERSATION_ID, { limit: 2, from_id: 10, direction: "<" });
    expect(result.stdout).toBe(
      `2026-11-05 09:00:00  Taro: (削除済み)  (${CONVERSATION_ID} #1)\n2026-11-05 09:01:00  Hanako: hi  (${CONVERSATION_ID} #2)\n`,
    );
  });

  it("limits messages to 30", async () => {
    const result = await cli(["messages", CONVERSATION_ID, "--limit", "31"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("1〜30");
  });

  it("lists conversations", async () => {
    const api = fakeApi({
      listConversations: vi.fn(async () => [
        { id: CONVERSATION_ID, type: "group" as const, name: "Team", partner_external_user_id: null, latest_message_at: "2026-11-05 10:00:00", unread_count: 2 },
      ]),
    });

    const text = await cli(["conversations"], api);
    const json = await cli(["conversations", "--json"], api);

    expect(text.stdout).toBe(`2026-11-05 10:00:00  [group] Team  未読 2  (${CONVERSATION_ID})\n`);
    expect(JSON.parse(json.stdout)).toMatchObject({ id: CONVERSATION_ID, name: "Team", unread_count: 2 });
  });

  it("prints help without needing the environment or the API", async () => {
    const result = await cli(["help"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("search <語>");
    expect(result.createApi).not.toHaveBeenCalled();
  });

  it("fails on an unknown subcommand", async () => {
    const result = await cli(["nope"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("不明なサブコマンド");
  });
});

describe("runCli errors", () => {
  it("reports API errors on stderr with exit code 1 and never prints the token", async () => {
    const api = fakeApi({
      searchAllMessages: vi.fn(async () => {
        throw new SphereApiError(401, undefined, `Unauthorized ${TOKEN}`);
      }),
    });

    const result = await cli(["search", "x"], api);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("トークンが無効");
    expect(result.stderr).not.toContain(TOKEN);
  });

  it("explains a missing environment without printing values", async () => {
    const err: string[] = [];
    const code = await runCli(["conversations"], { env: {}, stdout: () => {}, stderr: (text) => err.push(text) });

    expect(code).toBe(1);
    expect(err.join("")).toContain("SPHERE_API_URL");
  });
});

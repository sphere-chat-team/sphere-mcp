/**
 * 環境変数の読み取りと検証。
 * エラーメッセージには値（トークン・URL）を入れない（MCP クライアントが stderr をログに残すことがあるため）。
 */

export interface Config {
  baseUrl: string;
  token: string;
  /** SPHERE_MCP_READ_ONLY=1 のとき、トークンに送信権限があっても送信系ツールを出さない */
  forceReadOnly: boolean;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** backend の TokenFormat: `sph_` + base64url 43 文字 */
export const TOKEN_PATTERN = /^sph_[A-Za-z0-9_-]{43}$/;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const rawUrl = env.SPHERE_API_URL;
  if (!rawUrl) {
    throw new ConfigError("環境変数 SPHERE_API_URL が設定されていません（例: https://api.example.com）。");
  }

  const token = env.SPHERE_API_TOKEN;
  if (!token) {
    throw new ConfigError("環境変数 SPHERE_API_TOKEN が設定されていません。Sphere の設定画面で発行したトークン（sph_...）を設定してください。");
  }
  if (!TOKEN_PATTERN.test(token)) {
    throw new ConfigError("SPHERE_API_TOKEN の形式が違います。Sphere の設定画面で表示された sph_ で始まる 47 文字をそのまま設定してください（前後の空白や改行を含めない）。");
  }

  return {
    baseUrl: parseBaseUrl(rawUrl),
    token,
    forceReadOnly: env.SPHERE_MCP_READ_ONLY === "1" || env.SPHERE_MCP_READ_ONLY === "true",
  };
}

/**
 * トークンが平文で流れる先なので、https 以外は localhost だけ許可する。
 * 認証情報・クエリ・フラグメント付きの URL は受け付けない。
 * Web 版の設定値（API_ENDPOINT_BASE_URL）は `/api` で終わるので、末尾の `/api` は付いていても外す
 * （パスはこのサーバーが `/api/token/...` を付ける）
 */
export function parseBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError("SPHERE_API_URL が URL として解釈できません（例: https://api.example.com）。");
  }

  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new ConfigError("SPHERE_API_URL にはスキームとホスト（必要ならポート）だけを指定してください。ユーザー名・クエリ・フラグメントは使えません。");
  }

  const isLocal = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    throw new ConfigError("SPHERE_API_URL は https である必要があります（http は localhost / 127.0.0.1 だけ許可）。トークンが平文で流れるためです。");
  }

  const path = url.pathname.replace(/\/+$/, "");
  if (path !== "" && path !== "/api") {
    throw new ConfigError("SPHERE_API_URL にパスは指定できません（末尾の /api だけは許可）。例: https://api.example.com または https://api.example.com/api");
  }

  return url.origin;
}

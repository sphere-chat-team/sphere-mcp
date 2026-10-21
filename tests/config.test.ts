import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, parseBaseUrl } from "../src/config.js";

const TOKEN = "sph_" + "a".repeat(43);

describe("loadConfig", () => {
  it("accepts a well-formed token and https URL", () => {
    const config = loadConfig({ SPHERE_API_URL: "https://api.example.com/", SPHERE_API_TOKEN: TOKEN });

    expect(config).toEqual({ baseUrl: "https://api.example.com", token: TOKEN, forceReadOnly: false });
  });

  it("honours SPHERE_MCP_READ_ONLY", () => {
    expect(loadConfig({ SPHERE_API_URL: "https://api.example.com", SPHERE_API_TOKEN: TOKEN, SPHERE_MCP_READ_ONLY: "1" }).forceReadOnly).toBe(true);
  });

  it("rejects a missing or malformed token without echoing it", () => {
    expect(() => loadConfig({ SPHERE_API_URL: "https://api.example.com" })).toThrow(ConfigError);

    const secret = "sph_SECRET\nwith-newline";
    try {
      loadConfig({ SPHERE_API_URL: "https://api.example.com", SPHERE_API_TOKEN: secret });
      expect.fail("should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).not.toContain("SECRET");
    }
  });
});

describe("parseBaseUrl", () => {
  it("allows http only for localhost", () => {
    expect(parseBaseUrl("http://localhost:8000")).toBe("http://localhost:8000");
    expect(parseBaseUrl("http://127.0.0.1:8000/")).toBe("http://127.0.0.1:8000");
    expect(() => parseBaseUrl("http://api.example.com")).toThrow(/https/);
  });

  it("rejects credentials, query, fragment, and garbage without echoing the value", () => {
    for (const raw of ["https://user:pass@evil.example.net", "https://evil.example.net/?x=1", "https://evil.example.net/#frag", "not a url evil.example.net"]) {
      try {
        parseBaseUrl(raw);
        expect.fail(`should throw for ${raw}`);
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        expect((error as Error).message).not.toContain("evil.example.net");
      }
    }
  });
});

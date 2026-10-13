import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accountBase,
  fetchAccountBalance,
  parseAccountCredentials,
} from "../worker/accounts";
import { channel as parseChannel, HttpError } from "../worker/validation";

const credentials = {
  username: "private-account@example.com",
  password: "private-password-do-not-expose",
};
const base = "https://accounts.example.com";

function makeChannel(
  integration: "newapi" | "sub2api" = "sub2api",
  endpoint = base + "/v1",
) {
  return parseChannel(
    {
      name: "Balance adapter",
      provider: integration,
      endpoint,
      models: ["test-model"],
      config: { protocol: "openai", integration },
    },
    false,
  );
}

function mockFetch(...responses: Response[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  fetch.mockRejectedValue(new Error("Unexpected account fetch"));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function success(data: unknown, headers?: HeadersInit) {
  return Response.json({ code: 0, data }, { headers });
}

function requestAt(fetch: ReturnType<typeof mockFetch>, index: number) {
  const [url, init] = fetch.mock.calls[index];
  return { url: String(url), init, headers: new Headers(init?.headers) };
}

function expectPrivateError(error: unknown, status?: number) {
  expect(error).toBeInstanceOf(HttpError);
  if (status !== undefined) expect((error as HttpError).status).toBe(status);
  expect((error as Error).message).not.toContain(credentials.password);
  expect((error as Error).message).not.toContain(credentials.username);
  expect((error as Error).message).not.toContain("private-session-token");
}

afterEach(() => vi.unstubAllGlobals());

describe("account input and management base URL", () => {
  it("keeps passwords intact while trimming account names and allows omitted credentials", () => {
    expect(parseAccountCredentials(undefined)).toBeUndefined();
    expect(
      parseAccountCredentials({
        username: " user@example.com ",
        password: " space-preserving password ",
      }),
    ).toEqual({
      username: "user@example.com",
      password: " space-preserving password ",
    });
  });

  it("accepts a dashboard access token and normalizes an optional legacy User ID", () => {
    expect(parseAccountCredentials({ accessToken: " private-dashboard-token " })).toEqual({ accessToken: "private-dashboard-token" });
    expect(parseAccountCredentials({ accessToken: "private-dashboard-token", userId: " 0042 " })).toEqual({ accessToken: "private-dashboard-token", userId: "42" });
  });

  it.each([
    { accessToken: "" }, { accessToken: "   " }, { accessToken: "x".repeat(4097) }, { accessToken: 123 },
    { accessToken: "private-dashboard token" }, { accessToken: "private-dashboard\u0000token" },
    { accessToken: "private-dashboard\r\ntoken" },
    { accessToken: "private-dashboard-token", username: credentials.username, password: credentials.password },
    { accessToken: "private-dashboard-token", password: credentials.password },
    { accessToken: "private-dashboard-token", userId: "0" }, { accessToken: "private-dashboard-token", userId: "-1" },
    { accessToken: "private-dashboard-token", userId: "1.5" }, { accessToken: "private-dashboard-token", userId: "1e3" },
    { accessToken: "private-dashboard-token", userId: "9007199254740992" },
    { accessToken: "private-dashboard-token", userId: 42 },
    { ...credentials, userId: "42" },
  ])("rejects ambiguous or invalid token credentials without returning input values", (input) => {
    let error: unknown;
    try { parseAccountCredentials(input); } catch (caught) { error = caught; }
    expectPrivateError(error, 400);
    expect((error as Error).message).not.toContain("private-dashboard");
  });

  it.each([
    {},
    { username: "account" },
    { password: "password" },
    { username: "  ", password: "password" },
    { username: "account", password: "" },
    { username: "x".repeat(257), password: "password" },
    { username: "account", password: "x".repeat(4097) },
    { username: 123, password: "password" },
  ])(
    "rejects incomplete or oversized account credentials without including their content",
    (input) => {
      const error = (() => {
        try {
          parseAccountCredentials(input);
        } catch (error) {
          return error;
        }
      })();
      expectPrivateError(error, 400);
    },
  );

  it("removes only the final API prefix and preserves a self-hosted deployment subdirectory", () => {
    expect(
      accountBase(makeChannel("newapi", base + "/deployment/v1/"), false),
    ).toBe(base + "/deployment");
    expect(
      accountBase(makeChannel("newapi", base + "/deployment/v1beta"), false),
    ).toBe(base + "/deployment");
    expect(
      accountBase(makeChannel("newapi", base + "/deployment"), false),
    ).toBe(base + "/deployment");
  });
});

describe("Sub2API account balance adapter", () => {
  it("logs in with email/password then reads the bearer-authenticated profile balance", async () => {
    const fetch = mockFetch(
      success({
        access_token: "private-session-token",
        expires_in: 7200,
        user: { id: 17 },
      }),
      success({ balance: "12.345" }),
    );
    const result = await fetchAccountBalance(makeChannel(), credentials, false);
    expect(result.amount).toBe(12.345);
    expect(result.unit).toBe("USD");
    expect(result.session.token).toBe("private-session-token");
    expect(result.session.expiresAt).toBeGreaterThan(Date.now() + 7_000_000);
    const login = requestAt(fetch, 0);
    expect(login.url).toBe(base + "/api/v1/auth/login");
    expect(login.init?.method).toBe("POST");
    expect(JSON.parse(String(login.init?.body))).toEqual({
      email: credentials.username,
      password: credentials.password,
    });
    expect(login.headers.get("Content-Type")).toBe("application/json");
    const profile = requestAt(fetch, 1);
    expect(profile.url).toBe(base + "/api/v1/user/profile");
    expect(profile.headers.get("Authorization")).toBe(
      "Bearer private-session-token",
    );
    expect(profile.headers.get("Cookie")).toBeNull();
    expect(profile.init?.body).toBeUndefined();
    for (const [, init] of fetch.mock.calls) {
      expect(init?.redirect).toBe("manual");
      expect(init?.signal).toBeDefined();
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reuses a valid matching session without transmitting the password again", async () => {
    const fetch = mockFetch(success({ balance: 0 }));
    const cached = {
      token: "cached-session-token",
      expiresAt: Date.now() + 3_600_000,
      base,
    };
    const result = await fetchAccountBalance(
      makeChannel(),
      credentials,
      false,
      cached,
    );
    expect(result.amount).toBe(0);
    expect(result.session).toEqual(cached);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(requestAt(fetch, 0).url).toBe(base + "/api/v1/user/profile");
    expect(requestAt(fetch, 0).headers.get("Authorization")).toBe(
      "Bearer cached-session-token",
    );
    expect(
      fetch.mock.calls.some(([, init]) =>
        String(init?.body ?? "").includes(credentials.password),
      ),
    ).toBe(false);
  });

  it("renews a rejected cached session once and retries the profile with the new bearer token", async () => {
    const fetch = mockFetch(
      Response.json({ message: credentials.password }, { status: 401 }),
      success({ access_token: "renewed-token" }),
      success({ balance: 4.5 }),
    );
    const result = await fetchAccountBalance(
      makeChannel(),
      credentials,
      false,
      { token: "expired-server-side", expiresAt: Date.now() + 3_600_000, base },
    );
    expect(result.amount).toBe(4.5);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(requestAt(fetch, 0).url).toBe(base + "/api/v1/user/profile");
    expect(requestAt(fetch, 1).url).toBe(base + "/api/v1/auth/login");
    expect(requestAt(fetch, 2).headers.get("Authorization")).toBe(
      "Bearer renewed-token",
    );
  });

  it.each(["expired", "different-host"] as const)(
    "replaces a %s cached session before accessing the profile",
    async (state) => {
      const fetch = mockFetch(
        success({ access_token: "fresh-token" }),
        success({ balance: 8 }),
      );
      const cached = {
        token: "cached-token",
        expiresAt:
          state === "expired" ? Date.now() - 1 : Date.now() + 3_600_000,
        base:
          state === "different-host" ? "https://old-account.example.com" : base,
      };
      const result = await fetchAccountBalance(
        makeChannel(),
        credentials,
        false,
        cached,
      );
      expect(result.amount).toBe(8);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(requestAt(fetch, 0).url).toBe(base + "/api/v1/auth/login");
      expect(requestAt(fetch, 1).headers.get("Authorization")).toBe(
        "Bearer fresh-token",
      );
      expect(
        fetch.mock.calls.every(
          ([url]) => !String(url).includes("old-account.example.com"),
        ),
      ).toBe(true);
    },
  );

  it("does not submit the password twice when a freshly logged-in session is rejected", async () => {
    const fetch = mockFetch(
      success({ access_token: "fresh-token" }),
      Response.json({ message: credentials.password }, { status: 403 }),
    );
    const error = await fetchAccountBalance(makeChannel(), credentials, false, {
      token: "already-expired",
      expiresAt: Date.now() - 1,
      base,
    }).catch((error) => error);
    expectPrivateError(error, 403);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      fetch.mock.calls.filter(([url]) => String(url).endsWith("/auth/login")),
    ).toHaveLength(1);
  });

  it.each([null, "", true, "NaN", {}, undefined])(
    "rejects invalid profile balance %s rather than displaying zero",
    async (balance) => {
      mockFetch(
        success({ access_token: "private-session-token" }),
        success({ balance }),
      );
      expectPrivateError(
        await fetchAccountBalance(makeChannel(), credentials, false).catch(
          (error) => error,
        ),
        502,
      );
    },
  );
});

describe("NewAPI account balance adapter", () => {
  it.each([undefined, "42"])("reads account quota using an explicit dashboard token and optional User ID (%s) without logging in", async (userId) => {
    const fetch = mockFetch(
      Response.json({ success: true, data: { quota: 1_250_000 } }),
      Response.json({ success: true, data: { quota_per_unit: 500000, turnstile_check: true } }),
    );
    const result = await fetchAccountBalance(makeChannel("newapi"), { accessToken: "private-dashboard-token", ...(userId ? { userId } : {}) }, false, {
      cookie: "old-password-session", token: "old-password-token", userId: "7", base, expiresAt: Date.now() + 3600000,
    });
    expect(result.amount).toBe(2.5);
    expect(result.unit).toBe("USD");
    expect(result.session.token).toBe("private-dashboard-token");
    expect(result.session.cookie).toBeUndefined();
    expect(result.session.userId).toBe(userId);
    const profile = requestAt(fetch, 0);
    expect(profile.url).toBe(base + "/api/user/self");
    expect(profile.headers.get("Authorization")).toBe("Bearer private-dashboard-token");
    expect(profile.headers.get("New-Api-User")).toBe(userId ?? null);
    expect(profile.headers.get("Cookie")).toBeNull();
    expect(profile.init?.body).toBeUndefined();
    expect(profile.init?.redirect).toBe("manual");
    expect(requestAt(fetch, 1).url).toBe(base + "/api/status");
    expect(requestAt(fetch, 1).headers.get("Authorization")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects dashboard tokens on Sub2API before making any request", async () => {
    const fetch = mockFetch();
    expectPrivateError(await fetchAccountBalance(makeChannel(), { accessToken: "private-dashboard-token" }, false).catch(error => error), 400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renews a cached NewAPI session rejected through a legacy HTTP 200 response", async () => {
    const fetch = mockFetch(
      Response.json({ success: false, message: "无权进行此操作，access token 无效" }),
      Response.json({ success: true, data: { access_token: "new-login-token", user: { id: 42 } } }),
      Response.json({ success: true, data: { quota: 1000000 } }),
      Response.json({ success: true, data: { quota_per_unit: 500000 } }),
    );
    const result = await fetchAccountBalance(makeChannel("newapi"), credentials, false, {
      token: "revoked-cached-token", base, expiresAt: Date.now() + 3600000,
    });
    expect(result.amount).toBe(2);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([base + "/api/user/self", base + "/api/user/login", base + "/api/user/self", base + "/api/status"]);
    expect(requestAt(fetch, 2).headers.get("Authorization")).toBe("Bearer new-login-token");
  });

  it("does not turn an unknown business rejection into session renewal", async () => {
    const fetch = mockFetch(Response.json({ success: false, message: credentials.password }));
    expectPrivateError(await fetchAccountBalance(makeChannel("newapi"), credentials, false, { token: "cached", base, expiresAt: Date.now() + 3600000 }).catch(error => error), 502);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [200, { success: false, message: "无权进行此操作，access token 无效" }, 401, "访问令牌失效"],
    [401, { success: false, message: "无权进行此操作，未提供 New-Api-User" }, 401, "需要用户 ID"],
    [401, { success: false, message: "无权进行此操作，New-Api-User 与登录用户不匹配" }, 401, "不匹配"],
    [401, { success: false, message: "无权进行此操作，New-Api-User 格式错误" }, 401, "用户 ID 无效"],
    [200, { success: false, message: "用户已被封禁" }, 403, "禁用"],
    [403, { success: false, code: "ACCESS_TOKEN_SCOPE_DENIED", message: credentials.password }, 403, "权限不足"],
    [200, { success: false, code: "ACCESS_TOKEN_EXPIRED", message: credentials.password }, 401, "访问令牌失效"],
    [200, { success: false, message: credentials.password }, 502, "后台拒绝请求"],
  ] as const)("diagnoses dashboard token failures safely (HTTP %s, %s)", async (status, body, expectedStatus, message) => {
    const fetch = mockFetch(Response.json(body, { status }));
    const error = await fetchAccountBalance(makeChannel("newapi"), { accessToken: "private-dashboard-token", userId: "42" }, false).catch(error => error);
    expectPrivateError(error, expectedStatus);
    expect(error.message).toContain(message);
    expect(error.message).not.toContain("private-dashboard-token");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(requestAt(fetch, 0).url).toBe(base + "/api/user/self");
  });

  it("reports a Turnstile-protected password login and never retries with encrypted credentials", async () => {
    const fetch = mockFetch(
      Response.json({ success: false, message: "Turnstile token 为空" }),
      Response.json({ success: true, data: { turnstile_check: true, password_login_enabled: true, password_login_encryption_enabled: true } }),
    );
    const error = await fetchAccountBalance(makeChannel("newapi"), credentials, false).catch(error => error);
    expectPrivateError(error, 409);
    expect(error.message).toContain("Turnstile");
    expect(error.message).toContain("后台访问令牌");
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([base + "/api/user/login", base + "/api/status"]);
  });

  it.each([
    { require_verification: true, flow_token: "private-flow-token", methods: [{ method: "two_fa", available: true }] },
    { require_2fa: true, flow_token: "private-flow-token" },
    { flow_token: "private-flow-token" },
  ])("recognizes an unfinished modern NewAPI login verification flow", async (challenge) => {
    const fetch = mockFetch(Response.json({ success: true, data: challenge }));
    const error = await fetchAccountBalance(makeChannel("newapi"), credentials, false).catch(error => error);
    expectPrivateError(error, 409);
    expect(error.message).toContain("二次验证");
    expect(error.message).not.toContain("private-flow-token");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("supports token login, User-ID authentication and the site-specific quota conversion", async () => {
    const expires = Math.floor(Date.now() / 1000) + 600;
    const fetch = mockFetch(
      Response.json({
        success: true,
        data: {
          access_token: "private-session-token",
          access_expires_at: expires,
          user: { id: 42 },
        },
      }),
      Response.json({ success: true, data: { quota: 9_000_000 } }),
      Response.json({ success: true, data: { quota_per_unit: 1_000_000 } }),
    );
    const result = await fetchAccountBalance(
      makeChannel("newapi"),
      credentials,
      false,
    );
    expect(result.amount).toBe(9);
    expect(result.unit).toBe("USD");
    expect(result.session.expiresAt).toBe(expires * 1000);
    expect(requestAt(fetch, 0).url).toBe(base + "/api/user/login");
    expect(JSON.parse(String(requestAt(fetch, 0).init?.body))).toEqual(
      credentials,
    );
    const profile = requestAt(fetch, 1);
    expect(profile.url).toBe(base + "/api/user/self");
    expect(profile.headers.get("Authorization")).toBe(
      "Bearer private-session-token",
    );
    expect(profile.headers.get("New-Api-User")).toBe("42");
    expect(requestAt(fetch, 2).url).toBe(base + "/api/status");
    expect(requestAt(fetch, 2).headers.get("Authorization")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("supports legacy cookie sessions and sends only cookie values with the correct User-ID", async () => {
    const cookies = new Headers();
    cookies.append(
      "Set-Cookie",
      "session=legacy-secret; HttpOnly; Path=/; Secure",
    );
    cookies.append("Set-Cookie", "route=server-a; Path=/");
    cookies.append("Set-Cookie", "deleted=; Max-Age=0; Path=/");
    const fetch = mockFetch(
      Response.json({ success: true, data: { id: 23 } }, { headers: cookies }),
      Response.json({ success: true, data: { quota: "1000000" } }),
      Response.json({ success: true, data: { quota_per_unit: 500000 } }),
    );
    const result = await fetchAccountBalance(
      makeChannel("newapi"),
      credentials,
      false,
    );
    expect(result.amount).toBe(2);
    expect(result.unit).toBe("USD");
    expect(result.session.token).toBeUndefined();
    const profile = requestAt(fetch, 1);
    expect(profile.headers.get("Cookie")).toBe(
      "session=legacy-secret; route=server-a",
    );
    expect(profile.headers.get("Cookie")).not.toContain("HttpOnly");
    expect(profile.headers.get("Cookie")).not.toContain("deleted");
    expect(profile.headers.get("Authorization")).toBeNull();
    expect(profile.headers.get("New-Api-User")).toBe("23");
  });

  it.each([undefined, null, 0, -1, "invalid"])(
    "keeps the raw quota when quota_per_unit is invalid (%s)",
    async (quota_per_unit) => {
      mockFetch(
        Response.json({ success: true, data: { token: "token", id: 3 } }),
        Response.json({ success: true, data: { quota: 12345 } }),
        Response.json({ success: true, data: { quota_per_unit } }),
      );
      const result = await fetchAccountBalance(
        makeChannel("newapi"),
        credentials,
        false,
      );
      expect(result.amount).toBe(12345);
      expect(result.unit).toBe("额度");
    },
  );

  it("keeps the raw quota if the public status endpoint is unavailable", async () => {
    mockFetch(
      Response.json({ success: true, data: { token: "token", id: 3 } }),
      Response.json({ success: true, data: { quota: 12345 } }),
      Response.json({ message: credentials.password }, { status: 503 }),
    );
    const result = await fetchAccountBalance(
      makeChannel("newapi"),
      credentials,
      false,
    );
    expect(result.amount).toBe(12345);
    expect(result.unit).toBe("额度");
  });
});

describe("account failure boundaries", () => {
  it.each([
    "requires_2fa",
    "require_2fa",
    "verification_required",
    "challenge_id",
  ])("does not request a profile when login requires %s", async (field) => {
    const fetch = mockFetch(
      success({
        [field]: true,
        access_token: "private-session-token",
        message: credentials.password,
      }),
    );
    expectPrivateError(
      await fetchAccountBalance(makeChannel(), credentials, false).catch(
        (error) => error,
      ),
      409,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sanitizes login rejection messages and never propagates the upstream response body", async () => {
    const fetch = mockFetch(
      Response.json({
        success: false,
        message: `${credentials.username} ${credentials.password} private-session-token`,
      }),
    );
    expectPrivateError(
      await fetchAccountBalance(
        makeChannel("newapi"),
        credentials,
        false,
      ).catch((error) => error),
      502,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(requestAt(fetch, 1).url).toBe(base + "/api/status");
    expect(requestAt(fetch, 1).init?.method).toBe("GET");
    expect(requestAt(fetch, 1).init?.body).toBeUndefined();
  });

  it("rejects login redirects without sending credentials to another host", async () => {
    const fetch = mockFetch(
      new Response(credentials.password, {
        status: 302,
        headers: { Location: "https://foreign.example.com/login" },
      }),
    );
    expectPrivateError(
      await fetchAccountBalance(makeChannel(), credentials, false).catch(
        (error) => error,
      ),
      302,
    );
    expect(requestAt(fetch, 0).init?.redirect).toBe("manual");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects successful login responses that contain no usable session", async () => {
    const fetch = mockFetch(
      success({ user: { id: 7 }, message: credentials.password }),
    );
    expectPrivateError(
      await fetchAccountBalance(makeChannel(), credentials, false).catch(
        (error) => error,
      ),
      502,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("bounds login response buffering and reports oversized responses without copying their content", async () => {
    const fetch = mockFetch(
      Response.json({
        data: {
          access_token: "private-session-token",
          message: credentials.password + "x".repeat(512 * 1024),
        },
      }),
    );
    expectPrivateError(
      await fetchAccountBalance(makeChannel(), credentials, false).catch(
        (error) => error,
      ),
      502,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

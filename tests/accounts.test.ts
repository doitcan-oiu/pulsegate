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

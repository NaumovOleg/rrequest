import { describe, it, expect, beforeAll } from "vitest";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";

// `handlers/api-app.ts` transitively imports `deps.ts`, which calls `loadConfig()`
// at module-load time (throws if required env vars are missing) and
// constructs a DynamoDB document client + Google OAuth2Client. Those
// constructions are lazy (no network I/O happens until a command/token
// exchange is actually attempted), so the handler can be exercised
// end-to-end in-process for a route that never touches Dynamo or Google's
// network endpoints -- `GET /api/auth/start` only builds a local auth URL.
// Required env vars are set here, before the dynamic import, since a static
// `import` would be hoisted above any `process.env` assignment.
let handler: (event: APIGatewayProxyEventV2, context: Context) => Promise<{ statusCode: number; headers?: Record<string, string>; body?: string }>;

beforeAll(async () => {
  process.env.JWT_SECRET = "smoke-jwt-secret";
  process.env.TOKEN_ENC_KEY = "smoke-token-enc-key";
  process.env.GOOGLE_CLIENT_ID = "smoke-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "smoke-client-secret";
  process.env.GOOGLE_REDIRECT_URI = "http://localhost:8787/api/auth/callback";
  const mod = await import("../../../server/src/handlers/api-app.js");
  handler = mod.handler as typeof handler;
});

function makeEvent(overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: "/api/auth/start",
    rawQueryString: "cb=http%3A%2F%2Flocalhost%3A5000",
    headers: { host: "example.execute-api.us-east-1.amazonaws.com" },
    queryStringParameters: { cb: "http://localhost:5000" },
    requestContext: {
      accountId: "123456789012",
      apiId: "test-api",
      domainName: "example.execute-api.us-east-1.amazonaws.com",
      domainPrefix: "example",
      http: {
        method: "GET",
        path: "/api/auth/start",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "req-1",
      routeKey: "$default",
      stage: "$default",
      time: "19/Jul/2026:00:00:00 +0000",
      timeEpoch: Date.now(),
    } as unknown as APIGatewayProxyEventV2["requestContext"],
    isBase64Encoded: false,
    ...overrides,
  } as APIGatewayProxyEventV2;
}

const context = { awsRequestId: "test-request-id" } as unknown as Context;

describe("apiFn handler smoke", () => {
  it("redirects GET /api/auth/start to Google's OAuth URL", async () => {
    const res = await handler(makeEvent(), context);
    expect(res.statusCode).toBe(302);
    expect(res.headers?.location).toContain("accounts.google.com");
  });

  it("400s a non-loopback cb", async () => {
    const event = makeEvent({
      rawQueryString: "cb=https%3A%2F%2Fevil.example",
      queryStringParameters: { cb: "https://evil.example" },
    });
    const res = await handler(event, context);
    expect(res.statusCode).toBe(400);
  });

  it("401s a protected route with no Authorization header", async () => {
    const event = makeEvent({
      rawPath: "/api/me",
      rawQueryString: "",
      queryStringParameters: undefined,
      requestContext: {
        accountId: "123456789012",
        apiId: "test-api",
        domainName: "example.execute-api.us-east-1.amazonaws.com",
        domainPrefix: "example",
        http: {
          method: "GET",
          path: "/api/me",
          protocol: "HTTP/1.1",
          sourceIp: "127.0.0.1",
          userAgent: "vitest",
        },
        requestId: "req-2",
        routeKey: "$default",
        stage: "$default",
        time: "19/Jul/2026:00:00:00 +0000",
        timeEpoch: Date.now(),
      } as unknown as APIGatewayProxyEventV2["requestContext"],
    });
    const res = await handler(event, context);
    expect(res.statusCode).toBe(401);
  });

  // Regression: a real Lambda Function URL event has NO requestContext.apiId
  // and a domainName containing "lambda-url". Helios's Function-URL normalizer
  // sets req.url to the full URL, so without the api-app.ts coercion the router
  // 404s every route. This event shape must still route to /api/auth/start.
  it("routes a Lambda Function URL event (apiId undefined, lambda-url host)", async () => {
    const host = "slgvpoiwdpzymrlg6iu4zbowea0yneyw.lambda-url.eu-west-1.on.aws";
    const event = makeEvent({
      headers: { host },
      requestContext: {
        accountId: "anonymous",
        domainName: host,
        domainPrefix: "slgvpoiwdpzymrlg6iu4zbowea0yneyw",
        http: {
          method: "GET",
          path: "/api/auth/start",
          protocol: "HTTP/1.1",
          sourceIp: "127.0.0.1",
          userAgent: "vitest",
        },
        requestId: "req-3",
        routeKey: "$default",
        stage: "$default",
        time: "01/Aug/2026:00:00:00 +0000",
        timeEpoch: Date.now(),
        // note: NO apiId — the discriminator for a Function URL event
      } as unknown as APIGatewayProxyEventV2["requestContext"],
    });
    const res = await handler(event, context);
    expect(res.statusCode).toBe(302);
    expect(res.headers?.location).toContain("accounts.google.com");
  });
});

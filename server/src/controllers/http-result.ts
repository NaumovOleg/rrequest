// Shared mapping from a service's `{ status, body? } | <success data>`
// discriminated result to the plain object a Helios controller method
// returns. Confirmed from @heliosjs/aws@10.0.0's compiled source
// (dist/lambda.js `toLambdaResponse`): the final HTTP status code is read
// from `response.data?.status` (falling back to 200), and the full returned
// object is JSON-serialized as the body -- so folding `status` into the
// returned object is both how errors AND success codes are communicated.
export function toHttpResult(result: unknown): unknown {
  if (
    typeof result === "object" &&
    result !== null &&
    "status" in result &&
    typeof (result as { status?: unknown }).status === "number"
  ) {
    const { status, body } = result as { status: number; body?: Record<string, unknown> };
    return { status, ...(body ?? {}) };
  }
  return result;
}

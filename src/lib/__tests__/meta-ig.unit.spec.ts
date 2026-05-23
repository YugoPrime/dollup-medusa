import {
  MetaIgError,
  getContainerStatus,
  isContainerStatusVisibilityError,
  pollContainerUntilReady,
  readMetaIgEnv,
} from "../meta-ig"

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  jest.restoreAllMocks()
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k]
  }
  Object.assign(process.env, ORIGINAL_ENV)
})

const cfg = {
  igUserId: "17841408363434805",
  pageAccessToken: "page-token",
  apiVersion: "v21.0",
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function visibilityErrorResponse(): Response {
  return jsonResponse(
    {
      error: {
        message: "Authorization Error",
        code: 100,
        type: "GraphMethodException",
        error_subcode: 33,
        fbtrace_id: "trace_123",
      },
    },
    400,
  )
}

describe("readMetaIgEnv", () => {
  it("returns null when required env vars are missing", () => {
    delete process.env.META_PAGE_ACCESS_TOKEN
    process.env.META_IG_BUSINESS_ACCOUNT_ID = "123"
    expect(readMetaIgEnv()).toBeNull()

    process.env.META_PAGE_ACCESS_TOKEN = "token"
    delete process.env.META_IG_BUSINESS_ACCOUNT_ID
    expect(readMetaIgEnv()).toBeNull()
  })

  it("returns config and defaults apiVersion to v21.0", () => {
    process.env.META_PAGE_ACCESS_TOKEN = "token"
    process.env.META_IG_BUSINESS_ACCOUNT_ID = "123"
    delete process.env.META_API_VERSION

    expect(readMetaIgEnv()).toEqual({
      pageAccessToken: "token",
      igUserId: "123",
      apiVersion: "v21.0",
    })
  })
})

describe("getContainerStatus", () => {
  it("maps Meta error code/subcode/fbtrace details", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce(visibilityErrorResponse())

    try {
      await getContainerStatus("creation_123", cfg)
      throw new Error("Expected getContainerStatus to throw")
    } catch (err) {
      expect(err).toBeInstanceOf(MetaIgError)
      const igErr = err as MetaIgError
      expect(igErr.message).toBe("Authorization Error")
      expect(igErr.status).toBe(400)
      expect(igErr.metaErrorCode).toBe(100)
      expect(igErr.metaErrorSubcode).toBe(33)
      expect(igErr.fbtraceId).toBe("trace_123")
      expect(isContainerStatusVisibilityError(igErr)).toBe(true)
    }
  })
})

describe("pollContainerUntilReady", () => {
  it("retries transient container visibility errors and resolves when status finishes", async () => {
    const fetchMock = jest.spyOn(global, "fetch")
    fetchMock
      .mockResolvedValueOnce(visibilityErrorResponse())
      .mockResolvedValueOnce(jsonResponse({ status_code: "FINISHED" }))

    await expect(
      pollContainerUntilReady(
        {
          creationId: "creation_123",
          timeoutMs: 1000,
          pollIntervalMs: 0,
          statusUnavailableFallbackMs: 1000,
        },
        cfg,
      ),
    ).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("falls back after repeated container visibility errors", async () => {
    const fetchMock = jest.spyOn(global, "fetch")
    fetchMock.mockResolvedValue(visibilityErrorResponse())

    await expect(
      pollContainerUntilReady(
        {
          creationId: "creation_123",
          timeoutMs: 1000,
          pollIntervalMs: 0,
          statusUnavailableFallbackMs: 0,
        },
        cfg,
      ),
    ).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("does not swallow unrelated Meta errors", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            message: "Bad token",
            code: 190,
            type: "OAuthException",
            fbtrace_id: "trace_bad_token",
          },
        },
        400,
      ),
    )

    await expect(
      pollContainerUntilReady(
        {
          creationId: "creation_123",
          timeoutMs: 1000,
          pollIntervalMs: 0,
          statusUnavailableFallbackMs: 0,
        },
        cfg,
      ),
    ).rejects.toMatchObject({
      message: "Bad token",
      metaErrorCode: 190,
      fbtraceId: "trace_bad_token",
    })
  })
})

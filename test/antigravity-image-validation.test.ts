import { describe, expect, it } from "bun:test"
import {
  convertOpenAIToGemini,
  ImagePayloadValidationError,
} from "../src/auth/antigravity/message-converter"
import { createAntigravityFetch } from "../src/auth/antigravity/fetch"

describe("antigravity image payload validation", () => {
  it("throws for empty base64 payloads", () => {
    const messages: Parameters<typeof convertOpenAIToGemini>[0] = [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64," },
          },
        ],
      },
    ]

    let thrown: unknown
    try {
      convertOpenAIToGemini(messages)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ImagePayloadValidationError)
    if (thrown instanceof ImagePayloadValidationError) {
      expect(thrown.code).toBe("IMAGE_URL_EMPTY_BASE64")
    }
  })

  it("throws for unsupported image mime types", () => {
    const messages: Parameters<typeof convertOpenAIToGemini>[0] = [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: "data:image/tiff;base64,AAAA" },
          },
        ],
      },
    ]

    let thrown: unknown
    try {
      convertOpenAIToGemini(messages)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ImagePayloadValidationError)
    if (thrown instanceof ImagePayloadValidationError) {
      expect(thrown.code).toBe("IMAGE_URL_UNSUPPORTED_MIME")
    }
  })
})

describe("antigravity fetch validation fail-fast", () => {
  it("returns a deterministic 400 input_validation_non_retryable error", async () => {
    const originalFetch = globalThis.fetch

    const mockFetch = Object.assign(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url

        if (url.includes("loadCodeAssist")) {
          return new Response(JSON.stringify({ cloudaicompanionProject: "test-project" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        }

        if (url.includes("onboardUser")) {
          return new Response(
            JSON.stringify({
              done: true,
              response: { cloudaicompanionProject: { id: "test-project" } },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        throw new Error(`Unexpected fetch: ${url}`)
      },
      { preconnect: originalFetch.preconnect }
    ) as typeof fetch

    globalThis.fetch = mockFetch

    try {
      const customFetch = createAntigravityFetch(
        async () => ({
          access: "access-token",
          refresh: "refresh-token|project-id|",
        }),
        { set: async () => {} },
        "google"
      )

      const response = await customFetch("https://api.example.com/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model: "gemini-test",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: "data:image/png;base64," },
                },
              ],
            },
          ],
        }),
      })

      const payload = await response.json()

      expect(response.status).toBe(400)
      expect(payload).toEqual({
        error: {
          message: "Image payload validation failed: IMAGE_URL_EMPTY_BASE64",
          type: "input_validation_error",
          code: "IMAGE_URL_EMPTY_BASE64",
          class: "input_validation_non_retryable",
        },
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

/**
 * OpenAI → Gemini message format converter
 * 
 * Converts OpenAI-style messages to Gemini contents format,
 * injecting thoughtSignature into functionCall parts.
 */

import { SKIP_THOUGHT_SIGNATURE_VALIDATOR } from "./constants"

function debugLog(message: string): void {
  if (process.env.ANTIGRAVITY_DEBUG === "1") {
    console.log(`[antigravity-converter] ${message}`)
  }
}

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
])

const DATA_URI_PATTERN = /^data:([^;]+);base64,(.*)$/i
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/

export type ImagePayloadValidationCode =
  | "IMAGE_URL_BAD_DATA_URI"
  | "IMAGE_URL_UNSUPPORTED_MIME"
  | "IMAGE_URL_EMPTY_BASE64"
  | "IMAGE_FILE_EMPTY"

export class ImagePayloadValidationError extends Error {
  code: ImagePayloadValidationCode
  type = "input_validation_error"
  classification = "input_validation_non_retryable"

  constructor(code: ImagePayloadValidationCode) {
    super(`Image payload validation failed: ${code}`)
    this.name = "ImagePayloadValidationError"
    this.code = code
  }
}

function isValidBase64Payload(payload: string): boolean {
  if (payload.length % 4 === 1) {
    return false
  }
  return BASE64_PATTERN.test(payload)
}

function parseImageDataUri(url: string): { mimeType: string; data: string } {
  const match = url.match(DATA_URI_PATTERN)
  if (!match) {
    throw new ImagePayloadValidationError("IMAGE_URL_BAD_DATA_URI")
  }

  const mimeType = match[1]?.trim().toLowerCase()
  if (!mimeType) {
    throw new ImagePayloadValidationError("IMAGE_URL_BAD_DATA_URI")
  }

  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new ImagePayloadValidationError("IMAGE_URL_UNSUPPORTED_MIME")
  }

  const payload = match[2] ?? ""
  const normalizedPayload = payload.trim()
  if (!normalizedPayload) {
    throw new ImagePayloadValidationError("IMAGE_URL_EMPTY_BASE64")
  }

  if (!isValidBase64Payload(normalizedPayload)) {
    throw new ImagePayloadValidationError("IMAGE_URL_BAD_DATA_URI")
  }

  const decoded = Buffer.from(normalizedPayload, "base64")
  if (decoded.length === 0) {
    throw new ImagePayloadValidationError("IMAGE_FILE_EMPTY")
  }

  return { mimeType, data: normalizedPayload }
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool"
  content?: string | OpenAIContentPart[]
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
  name?: string
}

interface OpenAIContentPart {
  type: string
  text?: string
  image_url?: { url: string }
  [key: string]: unknown
}

interface OpenAIToolCall {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

interface GeminiPart {
  text?: string
  functionCall?: {
    name: string
    args: Record<string, unknown>
  }
  functionResponse?: {
    name: string
    response: Record<string, unknown>
  }
  inlineData?: {
    mimeType: string
    data: string
  }
  thought_signature?: string
  [key: string]: unknown
}

interface GeminiContent {
  role: "user" | "model"
  parts: GeminiPart[]
}

export function convertOpenAIToGemini(
  messages: OpenAIMessage[],
  thoughtSignature?: string
): GeminiContent[] {
  debugLog(`Converting ${messages.length} messages, signature: ${thoughtSignature ? "present" : "none"}`)
  
  const contents: GeminiContent[] = []

  for (const msg of messages) {
    if (msg.role === "system") {
      contents.push({
        role: "user",
        parts: [{ text: typeof msg.content === "string" ? msg.content : "" }],
      })
      continue
    }

    if (msg.role === "user") {
      const parts = convertContentToParts(msg.content)
      contents.push({ role: "user", parts })
      continue
    }

    if (msg.role === "assistant") {
      const parts: GeminiPart[] = []

      if (msg.content) {
        parts.push(...convertContentToParts(msg.content))
      }

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const toolCall of msg.tool_calls) {
          let args: Record<string, unknown> = {}
          try {
            args = JSON.parse(toolCall.function.arguments)
          } catch {
            args = {}
          }

          const part: GeminiPart = {
            functionCall: {
              name: toolCall.function.name,
              args,
            },
          }

          // Always inject signature: use provided or default to skip validator (CLIProxyAPI approach)
          part.thoughtSignature = thoughtSignature || SKIP_THOUGHT_SIGNATURE_VALIDATOR
          debugLog(`Injected signature into functionCall: ${toolCall.function.name} (${thoughtSignature ? "provided" : "default"})`)

          parts.push(part)
        }
      }

      if (parts.length > 0) {
        contents.push({ role: "model", parts })
      }
      continue
    }

    if (msg.role === "tool") {
      let response: Record<string, unknown> = {}
      try {
        response = typeof msg.content === "string" 
          ? JSON.parse(msg.content) 
          : { result: msg.content }
      } catch {
        response = { result: msg.content }
      }

      const toolName = msg.name || "unknown"
      
      contents.push({
        role: "user",
        parts: [{
          functionResponse: {
            name: toolName,
            response,
          },
        }],
      })
      continue
    }
  }

  debugLog(`Converted to ${contents.length} content blocks`)
  return contents
}

function convertContentToParts(content: string | OpenAIContentPart[] | undefined): GeminiPart[] {
  if (!content) {
    return [{ text: "" }]
  }

  if (typeof content === "string") {
    return [{ text: content }]
  }

  const parts: GeminiPart[] = []
  for (const part of content) {
    if (part.type === "text" && part.text) {
      parts.push({ text: part.text })
    } else if (part.type === "image_url" && part.image_url?.url) {
      const url = part.image_url.url
      if (url.startsWith("data:")) {
        const parsed = parseImageDataUri(url)
        parts.push({
          inlineData: {
            mimeType: parsed.mimeType,
            data: parsed.data,
          },
        })
      }
    }
  }

  return parts.length > 0 ? parts : [{ text: "" }]
}

export function hasOpenAIMessages(body: Record<string, unknown>): boolean {
  return Array.isArray(body.messages) && body.messages.length > 0
}

export function convertRequestBody(
  body: Record<string, unknown>,
  thoughtSignature?: string
): Record<string, unknown> {
  if (!hasOpenAIMessages(body)) {
    debugLog("No messages array found, returning body as-is")
    return body
  }

  const messages = body.messages as OpenAIMessage[]
  const contents = convertOpenAIToGemini(messages, thoughtSignature)

  const converted = { ...body }
  delete converted.messages
  converted.contents = contents

  debugLog(`Converted body: messages → contents (${contents.length} blocks)`)
  return converted
}

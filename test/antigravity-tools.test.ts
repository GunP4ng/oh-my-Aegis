import { describe, expect, it } from "bun:test"
import {
  extractFunctionDeclarations,
  normalizeToolsForGemini,
  type OpenAITool,
} from "../src/auth/antigravity/tools"

describe("antigravity tool normalization", () => {
  it("fills default parameters for function tools without schema", () => {
    const tools: OpenAITool[] = [
      {
        type: "function",
        function: {
          name: "bash",
          description: "Execute shell command",
        },
      },
    ]

    const normalized = normalizeToolsForGemini(tools)
    expect(normalized).toBeDefined()
    expect(normalized?.functionDeclarations).toHaveLength(1)
    expect(normalized?.functionDeclarations[0]?.name).toBe("bash")
    expect(normalized?.functionDeclarations[0]?.parameters).toEqual({
      type: "object",
      properties: {},
    })
  })

  it("normalizes mixed tool shapes and guarantees parameters", () => {
    const mixed = [
      {
        name: "read",
        description: "Read a file",
      },
      {
        functionDeclarations: [
          {
            name: "write",
            input_schema: {
              type: "object",
              properties: {
                filePath: { type: "string" },
              },
            },
          },
          {
            name: "list",
          },
        ],
      },
      {
        type: "function",
        function: {
          name: "grep",
          inputSchema: {
            type: "object",
            properties: {
              pattern: { type: "string" },
            },
          },
        },
      },
      {
        type: "custom_tool",
        name: "unsupported",
      },
    ] as unknown as OpenAITool[]

    const normalized = normalizeToolsForGemini(mixed)
    expect(normalized).toBeDefined()
    expect(normalized?.functionDeclarations.map((tool) => tool.name)).toEqual([
      "read",
      "write",
      "list",
      "grep",
    ])

    for (const declaration of normalized?.functionDeclarations ?? []) {
      expect(declaration.parameters).toBeDefined()
      expect(typeof declaration.parameters).toBe("object")
      expect(Array.isArray(declaration.parameters)).toBe(false)
    }
  })

  it("extracts declarations from wrapped gemini tool arrays", () => {
    const declarations = extractFunctionDeclarations([
      {
        functionDeclarations: [
          {
            name: "status",
          },
        ],
      },
    ])

    expect(declarations).toHaveLength(1)
    expect(declarations[0]?.name).toBe("status")
    expect(declarations[0]?.parameters).toEqual({
      type: "object",
      properties: {},
    })
  })
})

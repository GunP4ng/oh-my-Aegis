export type OpenAIChatRole = "system" | "user" | "assistant" | "tool";
export type OpenAIChatMessage = {
    role: "system";
    content: string;
} | {
    role: "user";
    content: string;
} | {
    role: "assistant";
    content: string | null;
} | {
    role: "assistant";
    content: string | null;
    tool_calls?: Array<{
        id: string;
        type: "function";
        function: {
            name: string;
            arguments: string;
        };
    }>;
} | {
    role: "tool";
    content: string;
    tool_call_id?: string;
};
export type OpenAITool = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters?: Record<string, unknown>;
    };
};
export declare function modelIdFromOpenAIModel(raw: unknown): string;
export declare function asOpenAIMessages(value: unknown): OpenAIChatMessage[] | null;
export declare function asOpenAITools(value: unknown): OpenAITool[];
export declare function buildTranscript(messages: OpenAIChatMessage[]): string;
export type ToolEnvelope = {
    type: "final";
    content: string;
} | {
    type: "tool-calls";
    tool_calls: Array<{
        id: string;
        name: string;
        arguments: Record<string, unknown>;
    }>;
};
export declare function parseToolEnvelope(text: string): ToolEnvelope | null;
export declare function buildOpenAIChatCompletionResponse(params: {
    model: string;
    content: string;
}): Record<string, unknown>;
export declare function buildOpenAIChatCompletionToolCallsResponse(params: {
    model: string;
    toolCalls: Array<{
        id: string;
        name: string;
        arguments: Record<string, unknown>;
    }>;
}): Record<string, unknown>;
export declare function sseSingleChunk(payload: Record<string, unknown>): string;

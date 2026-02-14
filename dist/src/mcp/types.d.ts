import { z } from "zod";
export declare const BuiltinMcpNameSchema: z.ZodEnum<{
    context7: "context7";
    grep_app: "grep_app";
    websearch: "websearch";
}>;
export type BuiltinMcpName = z.infer<typeof BuiltinMcpNameSchema>;
export declare const AnyMcpNameSchema: z.ZodString;
export type AnyMcpName = z.infer<typeof AnyMcpNameSchema>;

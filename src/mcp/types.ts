import { z } from "zod";

export const BuiltinMcpNameSchema = z.enum(["context7", "grep_app"]);

export type BuiltinMcpName = z.infer<typeof BuiltinMcpNameSchema>;

export const AnyMcpNameSchema = z.string().min(1);

export type AnyMcpName = z.infer<typeof AnyMcpNameSchema>;

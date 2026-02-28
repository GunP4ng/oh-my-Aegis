import { z } from "zod";
declare const PlaybookRuleSchema: z.ZodObject<{
    id: z.ZodString;
    order: z.ZodNumber;
    lines: z.ZodArray<z.ZodString>;
    trigger: z.ZodObject<{
        pattern: z.ZodOptional<z.ZodObject<{
            modes: z.ZodOptional<z.ZodArray<z.ZodString>>;
            targets: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strict>>;
        states: z.ZodDefault<z.ZodArray<z.ZodObject<{
            field: z.ZodEnum<{
                mode: "mode";
                targetType: "targetType";
                decoySuspect: "decoySuspect";
                interactiveEnabled: "interactiveEnabled";
                sequentialThinkingActive: "sequentialThinkingActive";
                sequentialThinkingToolName: "sequentialThinkingToolName";
                contradictionPatchDumpDone: "contradictionPatchDumpDone";
                staleToolPatternLoops: "staleToolPatternLoops";
                noNewEvidenceLoops: "noNewEvidenceLoops";
                contradictionPivotDebt: "contradictionPivotDebt";
            }>;
            equals: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>;
        }, z.core.$strict>>>;
        counters: z.ZodDefault<z.ZodArray<z.ZodObject<{
            field: z.ZodEnum<{
                mode: "mode";
                targetType: "targetType";
                decoySuspect: "decoySuspect";
                interactiveEnabled: "interactiveEnabled";
                sequentialThinkingActive: "sequentialThinkingActive";
                sequentialThinkingToolName: "sequentialThinkingToolName";
                contradictionPatchDumpDone: "contradictionPatchDumpDone";
                staleToolPatternLoops: "staleToolPatternLoops";
                noNewEvidenceLoops: "noNewEvidenceLoops";
                contradictionPivotDebt: "contradictionPivotDebt";
            }>;
            gt: z.ZodOptional<z.ZodNumber>;
            gte: z.ZodOptional<z.ZodNumber>;
            lt: z.ZodOptional<z.ZodNumber>;
            lte: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>>;
    }, z.core.$strict>;
    state_mutation: z.ZodObject<{
        flags: z.ZodDefault<z.ZodArray<z.ZodString>>;
        events: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    mandatory_next_action: z.ZodObject<{
        tool: z.ZodOptional<z.ZodString>;
        route: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>;
declare const PlaybookRegistrySchema: z.ZodObject<{
    version: z.ZodNumber;
    base_rules: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        order: z.ZodNumber;
        lines: z.ZodArray<z.ZodString>;
        trigger: z.ZodObject<{
            pattern: z.ZodOptional<z.ZodObject<{
                modes: z.ZodOptional<z.ZodArray<z.ZodString>>;
                targets: z.ZodOptional<z.ZodArray<z.ZodString>>;
            }, z.core.$strict>>;
            states: z.ZodDefault<z.ZodArray<z.ZodObject<{
                field: z.ZodEnum<{
                    mode: "mode";
                    targetType: "targetType";
                    decoySuspect: "decoySuspect";
                    interactiveEnabled: "interactiveEnabled";
                    sequentialThinkingActive: "sequentialThinkingActive";
                    sequentialThinkingToolName: "sequentialThinkingToolName";
                    contradictionPatchDumpDone: "contradictionPatchDumpDone";
                    staleToolPatternLoops: "staleToolPatternLoops";
                    noNewEvidenceLoops: "noNewEvidenceLoops";
                    contradictionPivotDebt: "contradictionPivotDebt";
                }>;
                equals: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>;
            }, z.core.$strict>>>;
            counters: z.ZodDefault<z.ZodArray<z.ZodObject<{
                field: z.ZodEnum<{
                    mode: "mode";
                    targetType: "targetType";
                    decoySuspect: "decoySuspect";
                    interactiveEnabled: "interactiveEnabled";
                    sequentialThinkingActive: "sequentialThinkingActive";
                    sequentialThinkingToolName: "sequentialThinkingToolName";
                    contradictionPatchDumpDone: "contradictionPatchDumpDone";
                    staleToolPatternLoops: "staleToolPatternLoops";
                    noNewEvidenceLoops: "noNewEvidenceLoops";
                    contradictionPivotDebt: "contradictionPivotDebt";
                }>;
                gt: z.ZodOptional<z.ZodNumber>;
                gte: z.ZodOptional<z.ZodNumber>;
                lt: z.ZodOptional<z.ZodNumber>;
                lte: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strict>>>;
        }, z.core.$strict>;
        state_mutation: z.ZodObject<{
            flags: z.ZodDefault<z.ZodArray<z.ZodString>>;
            events: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strict>;
        mandatory_next_action: z.ZodObject<{
            tool: z.ZodOptional<z.ZodString>;
            route: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
    }, z.core.$strict>>;
    conditional_rules: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        order: z.ZodNumber;
        lines: z.ZodArray<z.ZodString>;
        trigger: z.ZodObject<{
            pattern: z.ZodOptional<z.ZodObject<{
                modes: z.ZodOptional<z.ZodArray<z.ZodString>>;
                targets: z.ZodOptional<z.ZodArray<z.ZodString>>;
            }, z.core.$strict>>;
            states: z.ZodDefault<z.ZodArray<z.ZodObject<{
                field: z.ZodEnum<{
                    mode: "mode";
                    targetType: "targetType";
                    decoySuspect: "decoySuspect";
                    interactiveEnabled: "interactiveEnabled";
                    sequentialThinkingActive: "sequentialThinkingActive";
                    sequentialThinkingToolName: "sequentialThinkingToolName";
                    contradictionPatchDumpDone: "contradictionPatchDumpDone";
                    staleToolPatternLoops: "staleToolPatternLoops";
                    noNewEvidenceLoops: "noNewEvidenceLoops";
                    contradictionPivotDebt: "contradictionPivotDebt";
                }>;
                equals: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>;
            }, z.core.$strict>>>;
            counters: z.ZodDefault<z.ZodArray<z.ZodObject<{
                field: z.ZodEnum<{
                    mode: "mode";
                    targetType: "targetType";
                    decoySuspect: "decoySuspect";
                    interactiveEnabled: "interactiveEnabled";
                    sequentialThinkingActive: "sequentialThinkingActive";
                    sequentialThinkingToolName: "sequentialThinkingToolName";
                    contradictionPatchDumpDone: "contradictionPatchDumpDone";
                    staleToolPatternLoops: "staleToolPatternLoops";
                    noNewEvidenceLoops: "noNewEvidenceLoops";
                    contradictionPivotDebt: "contradictionPivotDebt";
                }>;
                gt: z.ZodOptional<z.ZodNumber>;
                gte: z.ZodOptional<z.ZodNumber>;
                lt: z.ZodOptional<z.ZodNumber>;
                lte: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strict>>>;
        }, z.core.$strict>;
        state_mutation: z.ZodObject<{
            flags: z.ZodDefault<z.ZodArray<z.ZodString>>;
            events: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strict>;
        mandatory_next_action: z.ZodObject<{
            tool: z.ZodOptional<z.ZodString>;
            route: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type PlaybookRegistry = z.infer<typeof PlaybookRegistrySchema>;
export type PlaybookRule = z.infer<typeof PlaybookRuleSchema>;
export declare function resolvePlaybooksRoot(baseDir: string): string;
export declare function parsePlaybookFile(path: string): PlaybookRegistry;
export declare function parsePlaybookRegistry(input: unknown): PlaybookRegistry;
export declare function loadPlaybookRegistry(): PlaybookRegistry;
export declare function resetPlaybookRegistryCacheForTests(): void;
export {};

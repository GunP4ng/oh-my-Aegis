export declare function resolveDefaultOpencodeDirCandidates(environment?: NodeJS.ProcessEnv): string[];
export declare function resolveDefaultAegisUserConfigCandidates(environment?: NodeJS.ProcessEnv): string[];
export declare function resolveOpencodeConfigPathInDir(opencodeDir: string): string;
export declare function resolveProjectOpencodeConfigPath(projectDir: string, environment?: NodeJS.ProcessEnv): string | null;

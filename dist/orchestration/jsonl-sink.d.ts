export declare const JSONL_MAX_SIZE_BYTES: number;
export declare const JSONL_MAX_ROTATED_FILES = 3;
export declare function rotateJsonlIfNeeded(filePath: string): void;
export declare function appendJsonlRecord(filePath: string, record: Record<string, unknown>): void;
export declare function appendJsonlRecords(filePath: string, records: Record<string, unknown>[]): void;

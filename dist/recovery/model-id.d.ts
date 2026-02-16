export type ParsedModelId = {
    providerID: string;
    modelID: string;
};
export declare function parseModelId(model: string): ParsedModelId;

export interface DtoRiskItem {
    id: string;
    filePath: string;
    line: number;
    code: string;
    snippet: string;
}

export function scanGeneratedDtoRisks(scanRoot?: string): DtoRiskItem[];
export function readBaselineIds(filePath?: string): string[];

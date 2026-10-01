export function runFreshness(args?: string[]): { exitCode: number; stdout: string; stderr: string };
export function formatRelativeAge(dateStr: string | null, now: Date): string;
export function parseFreshnessArgs(argv: string[]): {
    sourceDir: string | null;
    thresholdDays: number;
    now: Date;
};

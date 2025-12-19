
export enum TestStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  PASSED = 'PASSED',
  FAILED = 'FAILED',
  ERROR = 'ERROR'
}

export enum MatchStrategy {
  CONTAINS = 'CONTAINS',
  EXACT = 'EXACT',
  STARTS_WITH = 'STARTS_WITH'
}

export interface TestCase {
  id: string;
  params: Record<string, string>;
  expectedResult: string;
  comparedValue?: string;
  actualResponse?: string;
  status: TestStatus;
  errorMessage?: string;
  executionTime?: number;
  finalUrl?: string; // Added for debugging 404s
  finalBody?: string | null; // Added for debugging
  statusCode?: number; // To track 404, 500, etc.
}

export interface CurlConfig {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface ComparisonConfig {
  jsonPath: string;
  strategy: MatchStrategy;
}

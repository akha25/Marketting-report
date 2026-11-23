export type Kind = "csv" | "booking" | "cc";
export type MetricKind = "count" | "duration" | "number" | "percent";
export type CellStatus = "met" | "below" | "na" | null;

export interface Threshold { enabled: boolean; value: number }
export interface Metric {
  key: string;
  label: string;
  kind: MetricKind;
  source: "csv" | "booking" | "cc" | "derived";
  threshold: Threshold;
  visible?: boolean;
  show_total?: boolean;
  show_average?: boolean;
  call_log?: "sum" | "count";
  formula?: { numerator: string; denominator: string; multiplier: number };
}

export interface Row {
  agent_id: number;
  name: string;
  role: "setter" | "closer" | "unassigned";
  rank: number;
  values: Record<string, number | null>;
  display: Record<string, string>;
  status: Record<string, CellStatus>;
  notes: Record<string, string>;
  found_in: Kind[];
  meets_all_targets: boolean;
  role_source?: string | null;
}

export interface Agg {
  total: number | null;
  average: number | null;
  count: number;
  total_display: string;
  average_display: string;
  average_status: CellStatus;
}

export interface Section { rows: Row[]; count: number; totals: Record<string, Agg> }
export interface Card { label: string; value: string; unit?: string | null; hint?: string; metric?: string }
export interface Formatting { below_bg: string; below_text: string; met_bg: string; met_text: string }
export interface FileInfo { kind: Kind; label: string; filename: string; uploaded_at: string; sha: string; provider?: string | null }

export interface Report {
  title: string;
  metrics: Metric[];
  setters: Section;
  closers: Section;
  unassigned: Row[];
  overall: Record<string, Agg>;
  summary: { cards: Card[]; target_metrics: string[] };
  booking: {
    label: string; total: string; setters: string; closers: string; target: number | null; at_target: number;
    top: { name: string; role: string; value: string }[];
  } | null;
  cc_metrics: { key: string; label: string; total: string }[];
  formatting: Formatting;
  sorting: { primary: string; secondary: string };
  session?: { id: number; date: string; slot: string; slot_label: string };
  version?: number | null;
  generated_at?: string | null;
  files?: FileInfo[];
  warnings?: string[];
}

export interface Issue {
  severity: "error" | "warning" | "info";
  source: string;
  code: string;
  message: string;
  upload_id?: number;
  row?: number;
  column?: number;
  key?: string;
  agent_id?: number;
  action?: string;
}

export interface Cell { text: string | null; original?: string | null; confidence: number | null; note?: string; verified?: boolean; edited?: boolean }
export interface MapEntry { field: string; unit: string | null; unit_confirmed: boolean; auto?: boolean; remembered?: boolean }
export interface FieldOption { value: string; label: string; system?: boolean; kind?: MetricKind; source?: string }

export interface UploadInfo {
  id: number;
  kind: Kind;
  label: string;
  filename: string;
  uploaded_at: string;
  size: number;
  sha: string;
  provider: string | null;
  extracted_at: string | null;
  error: string | null;
  options: { mode?: string; duplicate_policy?: string; ack_duplicate?: boolean; ignored_rows?: number[] };
  mapping: MapEntry[];
  meta: { mode?: string | null; mapped_metrics?: string[]; rows_read?: number; agents?: number; total_rows?: number };
  fields: FieldOption[];
  units: Record<string, string>;
  processed: boolean;
  headers?: string[];
  row_count?: number;
  sample_rows?: (string | null)[][];
  rows?: Cell[][];
  tables?: { title: string; rows: number; columns: number }[];
  table_index?: number;
  other_text?: string[];
  confidence_threshold?: number;
}

export interface Match {
  key: string;
  source: Kind;
  source_label: string;
  name: string;
  email: string | null;
  rows: number[];
  status: "auto" | "new" | "confirmed" | "suggested" | "unmatched" | "ignored";
  reason: string;
  score: number;
  candidates: { agent_id: number; name: string; score: number }[];
  agent_id: number | null;
  agent_name: string | null;
  role: string | null;
}

export interface SessionInfo {
  id: number;
  date: string;
  slot: string;
  slot_label: string;
  status: "draft" | "final";
  created_at: string;
  updated_at: string;
  snapshots: { id: number; version: number; generated_at: string }[];
}

export interface Preview {
  session: SessionInfo;
  uploads: Partial<Record<Kind, UploadInfo>>;
  matches: Match[];
  issues: Issue[];
  counts: { errors: number; warnings: number };
  report: Report;
  can_finalize: boolean;
  agents: { id: number; name: string; role: string | null }[];
}

export interface View { source: "snapshot" | "draft"; snapshot_id: number | null; report: Report; can_finalize?: boolean; counts?: { errors: number; warnings: number } }

export interface Settings {
  report_title: string;
  slots: { value: string; label: string }[];
  metrics: Metric[];
  aliases: Record<string, string[]>;
  classification: { setter_keywords: string[]; closer_keywords: string[] };
  absent_in_screenshot: { booking: "na" | "zero"; cc: "na" | "zero" };
  formatting: Formatting;
  sorting: { primary: string; secondary: string };
  duration_decimals: number;
  ocr: { confidence_threshold: number };
  matching: { suggest_min: number };
  column_memory: Record<string, Record<string, unknown>>;
}

export interface AgentInfo { id: number; name: string; email: string | null; role: string | null; role_source: string | null; aliases: string[]; created_at: string }

export interface SnapshotMeta {
  id: number; session_id: number; version: number; generated_at: string; date: string; slot: string; slot_label: string;
  setters: number; closers: number; total_bookings: string | null; files: FileInfo[]; latest: boolean;
  agents: { name: string; role: string }[];
}

export interface Comparison {
  a: { date: string; slot: string; slot_label: string; version: number; generated_at: string };
  b: { date: string; slot: string; slot_label: string; version: number; generated_at: string };
  metrics: Metric[];
  rows: { agent_id: number; name: string; role: string; in_a: boolean; in_b: boolean; a: Record<string, number | null>; b: Record<string, number | null>; delta: Record<string, number | null> }[];
  totals: Record<string, { a: number | null; b: number | null; delta: number | null }>;
}

export interface Health { ok: boolean; ocr_provider: string; anthropic_configured: boolean; database: string; timezone: string; today: string }

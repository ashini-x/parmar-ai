import type { D1Database } from "@cloudflare/workers-types";

export interface AiSearchChunk {
  id?: string;
  text?: string;
  score?: number;
  item?: { key?: string; metadata?: Record<string, unknown> };
  scoring_details?: { vector_score?: number; reranking_score?: number };
}

export interface AiSearchItem {
  id: string;
  key: string;
  status: string;
  error?: string;
}

export interface AiSearchInstance {
  info(): Promise<Record<string, unknown>>;
  search(args: {
    messages: Array<{ role: "user"; content: string }>;
    ai_search_options?: {
      retrieval?: {
        max_num_results?: number;
        retrieval_type?: "vector" | "keyword" | "hybrid";
      };
    };
  }): Promise<{ chunks?: AiSearchChunk[] }>;
  items: {
    uploadAndPoll(
      key: string,
      content: string,
      options?: {
        metadata?: Record<string, string | number | boolean>;
        pollIntervalMs?: number;
        timeoutMs?: number;
      },
    ): Promise<AiSearchItem>;
    list(options?: {
      page?: number;
      per_page?: number;
      search?: string;
      status?: string;
      source?: string;
    }): Promise<{ result: AiSearchItem[] }>;
  };
}

export interface AiSearchNamespace {
  get(name: string): AiSearchInstance;
  create(args: { id: string }): Promise<AiSearchInstance>;
}

export interface VrainWorkflowBinding {
  create(options: { id: string; params: { documentId: string } }): Promise<{ id: string }>;
  get(id: string): Promise<{ status(): Promise<{ status: string; error?: { message?: string } }> }>;
}

export interface Env {
  DB: D1Database;
  VRAIN_SEARCH: AiSearchNamespace;
  INGEST_WORKFLOW: VrainWorkflowBinding;
  ENVIRONMENT?: string;
  VRAIN_SEARCH_INSTANCE?: string;
  VRAIN_GCS_BUCKET?: string;
  VRAIN_MAX_PDF_BYTES?: string;
  VRAIN_MAX_PDF_PAGES?: string;
  VRAIN_MIN_RETRIEVAL_SCORE?: string;
  GCP_PROJECT_ID?: string;
  GCP_CLIENT_EMAIL?: string;
  GCP_PRIVATE_KEY?: string;
  GCP_PRIVATE_KEY_ID?: string;
  VRAIN_ADMIN_TOKEN?: string;
}

export interface VrainDocument {
  id: string;
  title: string;
  source_filename: string;
  source_sha256: string;
  expected_size: number;
  uploaded_bytes: number;
  gcs_object: string;
  gcs_upload_uri: string | null;
  page_count: number;
  indexed_pages: number;
  collection_id: string;
  language: string;
  status: string;
  vision_operation: string | null;
  workflow_instance_id: string | null;
  error_code: string | null;
  error_message: string | null;
  published_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface WorkflowEvent<T> {
  payload: T;
}

export interface VrainPassage {
  id: string;
  documentId: string;
  title: string;
  page: number;
  text: string;
  score: number;
}
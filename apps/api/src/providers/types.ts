export type MediaType = 'text' | 'image' | 'video';

export interface ProviderConstraints {
  name: string;
  maxTextLength?: number;
  supportsMedia: MediaType[];
}

export interface PublishInput {
  text: string;
  mediaUrls?: string[];
}

export interface PublishResult {
  platform: string;
  postId: string;
  url?: string;
}

export interface HealthStatus {
  ok: boolean;
  details?: string;
}

export interface ProviderAdapter {
  key: string; // e.g., 'instagram'
  displayName: string; // e.g., 'Instagram'
  constraints: ProviderConstraints;
  isEnabled(): boolean;
  healthCheck(): Promise<HealthStatus>;
  validateDraft(input: PublishInput): { ok: boolean; errors: string[] };
  publish(input: PublishInput): Promise<PublishResult>;
}

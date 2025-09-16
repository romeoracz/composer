import { ProviderAdapter, PublishInput, PublishResult } from './types';

const ENABLED = (process.env.ENABLE_TIKTOK || 'false').toLowerCase() === 'true';

export const tiktokAdapter: ProviderAdapter = {
  key: 'tiktok',
  displayName: 'TikTok',
  constraints: {
    name: 'TikTok',
    maxTextLength: 2200,
    supportsMedia: ['video', 'text'],
  },
  isEnabled() {
    return ENABLED;
  },
  async healthCheck() {
    return { ok: true, details: 'stub' };
  },
  validateDraft(input: PublishInput) {
    const errors: string[] = [];
    if (this.constraints.maxTextLength && input.text.length > this.constraints.maxTextLength) {
      errors.push(`Text exceeds ${this.constraints.maxTextLength} characters`);
    }
    return { ok: errors.length === 0, errors };
  },
  async publish(_input: PublishInput): Promise<PublishResult> {
    throw new Error('TikTok adapter not implemented - feature flag disabled or sandbox only');
  },
};

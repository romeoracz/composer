import { ProviderAdapter, PublishInput, PublishResult } from './types';

const ENABLED = (process.env.ENABLE_INSTAGRAM || 'false').toLowerCase() === 'true';

export const instagramAdapter: ProviderAdapter = {
  key: 'instagram',
  displayName: 'Instagram',
  constraints: {
    name: 'Instagram',
    maxTextLength: 2200,
    supportsMedia: ['image', 'video', 'text'],
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
    throw new Error('Instagram adapter not implemented - feature flag disabled or sandbox only');
  },
};

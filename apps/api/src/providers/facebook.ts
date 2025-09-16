import { ProviderAdapter, PublishInput, PublishResult } from './types';

const ENABLED = (process.env.ENABLE_FACEBOOK || 'false').toLowerCase() === 'true';

export const facebookAdapter: ProviderAdapter = {
  key: 'facebook',
  displayName: 'Facebook',
  constraints: {
    name: 'Facebook',
    maxTextLength: 63206,
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
    throw new Error('Facebook adapter not implemented - feature flag disabled or sandbox only');
  },
};

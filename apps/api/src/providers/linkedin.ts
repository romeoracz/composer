import { ProviderAdapter, PublishInput, PublishResult } from './types';

const ENABLED = (process.env.ENABLE_LINKEDIN || 'true').toLowerCase() === 'true';

export const linkedinAdapter: ProviderAdapter = {
  key: 'linkedin',
  displayName: 'LinkedIn',
  constraints: {
    name: 'LinkedIn',
    maxTextLength: 3000,
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
    throw new Error('LinkedIn adapter not implemented - sandbox only');
  },
};

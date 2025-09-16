import { ProviderAdapter, PublishInput, PublishResult } from './types';

const ENABLED = (process.env.ENABLE_X || 'true').toLowerCase() === 'true';

export const xAdapter: ProviderAdapter = {
  key: 'x',
  displayName: 'X',
  constraints: {
    name: 'X',
    maxTextLength: 280,
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
    throw new Error('X adapter not implemented - sandbox only');
  },
};

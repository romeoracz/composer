import { ProviderAdapter, PublishInput, PublishResult } from './types';

const ENABLED = (process.env.ENABLE_X || 'true').toLowerCase() === 'true';
const SANDBOX = (process.env.ENABLE_SANDBOX_PUBLISH || 'false').toLowerCase() === 'true';

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
    if (SANDBOX) {
      return { platform: 'x', postId: 'sandbox_' + Math.random().toString(36).slice(2, 8), url: 'https://x.com/sandbox' };
    }
    throw new Error('X adapter not implemented - sandbox only');
  },
};

import { ProviderAdapter } from './types';
import { instagramAdapter } from './instagram';
import { facebookAdapter } from './facebook';
import { tiktokAdapter } from './tiktok';

const allAdapters: ProviderAdapter[] = [instagramAdapter, facebookAdapter, tiktokAdapter];

export function getAllAdapters(): ProviderAdapter[] {
  return allAdapters;
}

export function getEnabledAdapters(): ProviderAdapter[] {
  return allAdapters.filter((a) => a.isEnabled());
}

export function getProvidersInfo() {
  return getAllAdapters().map((a) => ({
    key: a.key,
    displayName: a.displayName,
    constraints: a.constraints,
    enabled: a.isEnabled(),
  }));
}

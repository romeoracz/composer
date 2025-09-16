import { ProviderAdapter } from './types';
import { instagramAdapter } from './instagram';
import { facebookAdapter } from './facebook';
import { tiktokAdapter } from './tiktok';
import { linkedinAdapter } from './linkedin';
import { xAdapter } from './x';

const allAdapters: ProviderAdapter[] = [linkedinAdapter, xAdapter, instagramAdapter, facebookAdapter, tiktokAdapter];

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

export function getAdapterByKey(key: string): ProviderAdapter | undefined {
  return getAllAdapters().find((a) => a.key === key);
}

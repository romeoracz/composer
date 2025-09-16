export type Driver = 'memory' | 'prisma';

export function getDriver(): Driver {
  const d = (process.env.DB_DRIVER || 'memory').toLowerCase();
  return d === 'prisma' ? 'prisma' : 'memory';
}

// Placeholder to wire Prisma repositories later without breaking CI
export const repositories = {
  // For now we keep using in-memory modules directly in routes.
};

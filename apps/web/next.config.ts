import type { NextConfig } from 'next';

/**
 * RuangNode web application configuration.
 *
 * Phase 0 defines the application shell only. The public store, customer panel
 * and admin panel are added in later phases and must follow the Neo-Brutalist
 * design system in docs/DESIGN.md.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;

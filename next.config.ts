import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  redirects() {
    return [{ source: "/map", destination: "/", permanent: false }];
  },
};

export default nextConfig;

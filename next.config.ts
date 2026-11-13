import type { NextConfig } from "next";
import pkg from "./package.json";

// Fully static: the OFP is fetched and parsed in the browser, nothing runs on a server.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  // 1.15: the screens tell the Board page which version they run (a source not refreshed yet)
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
  // Lets the dev server's hot reload work when opened via the LAN IP (e.g. from a phone).
  allowedDevOrigins: ["192.168.70.1"],
};

export default nextConfig;

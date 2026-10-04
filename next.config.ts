import type { NextConfig } from "next";

// Fully static: the OFP is fetched and parsed in the browser, nothing runs on a server.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  // Lets the dev server's hot reload work when opened via the LAN IP (e.g. from a phone).
  allowedDevOrigins: ["192.168.70.1"],
};

export default nextConfig;

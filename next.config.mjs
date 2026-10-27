/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ship the pipeline's output (digest, research snapshots, LLM cache) with the API functions.
  outputFileTracingIncludes: {
    "/api/**/*": ["./data/**/*"],
  },
  serverExternalPackages: ["unpdf"],
};
export default nextConfig;

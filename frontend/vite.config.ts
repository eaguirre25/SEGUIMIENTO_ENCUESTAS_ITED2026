import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const repository = env.GITHUB_REPOSITORY?.split("/")[1];
  return {
    base: env.VITE_BASE_PATH || (repository ? `/${repository}/` : "/"),
    server: {
      proxy: env.VITE_WORKER_DEV_URL
        ? { "/api": { target: env.VITE_WORKER_DEV_URL, changeOrigin: true } }
        : undefined,
    },
  };
});


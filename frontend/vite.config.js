import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy the REST API and the race WebSocket to Django (Daphne) so no CORS setup is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/ws": {
        target: "ws://127.0.0.1:8000",
        ws: true,
        // a closed socket (e.g. the race ending) shows up as a harmless ECONNRESET; don't spam the log
        configure: (proxy) => proxy.on("error", () => {}),
      },
    },
  },
});

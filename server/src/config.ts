import path from "node:path";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  tmuxSocketName: process.env.TMUX_SOCKET_NAME ?? "webterm",
  adminPasswordHash: required("ADMIN_PASSWORD_HASH"),
  sessionSecret: required("SESSION_SECRET"),
  sessionCookieName: "webterm_session",
  sessionMaxAgeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  // Defaults to the client's Vite build output, served straight from the
  // sibling client/ directory -- no separate copy step needed on the host.
  staticDir: process.env.STATIC_DIR ?? path.join(__dirname, "..", "..", "client", "dist"),
};

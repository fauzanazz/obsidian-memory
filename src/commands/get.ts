import { findConfig, openStore } from "../lib/config";

export async function runGet(
  cwd: string,
  sessionId: string,
): Promise<string> {
  const found = await findConfig(cwd);
  if (!found) {
    throw new Error("No .obsidian-memory config found. Run `obsidian-memory init` first.");
  }

  const store = openStore(found.dir, found.config);
  const session = store.getSession(sessionId);
  store.close();

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  return session.content;
}

/** Configuration must pass before this server instance accepts visitor requests. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { readEnv } = await import("./lib/config");
    readEnv();
  }
}

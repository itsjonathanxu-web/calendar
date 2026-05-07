// Next.js instrumentation hook — runs once on server startup.
// We use it to start the background reminder cron loop.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startCron } = await import("./lib/scheduler/cron");
    startCron();
  }
}

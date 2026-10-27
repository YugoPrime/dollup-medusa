/**
 * Runs one step of a scheduled job. A throw is turned into a single alert
 * naming the step (instead of silently ending the job) and the next step still
 * runs. A failing alert is swallowed: it must never mask the original error.
 */
export async function alertOnThrow<T>(
  step: string,
  fn: () => Promise<T>,
  alert: (text: string) => Promise<void>,
): Promise<T | undefined> {
  try {
    return await fn()
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err)
    try {
      await alert(`${step} failed: ${msg}`)
    } catch {
      // nothing more we can do; the scheduler logs the job run
    }
    return undefined
  }
}

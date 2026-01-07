/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

/**
 * Formats milliseconds into a human-readable duration string.
 */
export function formatDuration(ms: number): string {
  if (ms < 0) return 'Infinite'

  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) {
    return days === 1 ? '1 day' : `${days} days`
  }
  if (hours > 0) {
    return hours === 1 ? '1 hour' : `${hours} hours`
  }
  if (minutes > 0) {
    return minutes === 1 ? '1 minute' : `${minutes} minutes`
  }
  return seconds === 1 ? '1 second' : `${seconds} seconds`
}

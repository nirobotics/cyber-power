export function formatNumber(value: number | undefined, digits = 1) {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatDuration(seconds: number | undefined) {
  if (seconds === undefined || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${formatNumber(seconds, 2)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${formatNumber(seconds - minutes * 60, 1)}s`;
}

export function formatBytes(bytes: number | undefined) {
  if (bytes === undefined || !Number.isFinite(bytes)) return "未知大小";
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${formatNumber(value, unit === 0 ? 0 : 2)} ${units[unit]}`;
}

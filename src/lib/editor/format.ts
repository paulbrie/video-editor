export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** Duration as m:ss.cc (or h:mm:ss.cc). */
export function fmt(t: number) {
  if (!Number.isFinite(t)) return "--";
  t = Math.max(0, t);
  const h = Math.floor(t / 3600);
  const m = Math.floor(t / 60) % 60;
  const ss = (t % 60).toFixed(2).padStart(5, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** SMPTE-style HH:MM:SS:FF timecode. */
export function tc(t: number, fps: number) {
  t = Math.max(0, t);
  const secs = Math.floor(t + 1e-6);
  const ff = Math.min(Math.ceil(fps) - 1, Math.floor((t - secs) * fps + 1e-3));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(secs / 3600))}:${p(Math.floor(secs / 60) % 60)}:${p(secs % 60)}:${p(Math.max(0, ff))}`;
}

export function niceStep(minSec: number) {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  return steps.find((s) => s >= minSec) ?? 7200;
}

export function rulerLabel(x: number, step: number) {
  const m = Math.floor(x / 60);
  const s = x % 60;
  const h = Math.floor(m / 60);
  const ss = step < 1 ? s.toFixed(1).padStart(4, "0") : String(Math.round(s)).padStart(2, "0");
  return h ? `${h}:${String(m % 60).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function fmtBytes(n: number) {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

/** e.g. "beach.mp4", 123 → "beach-frame-000123.png" */
export const frameFileName = (videoName: string, frame: number) =>
  `${videoName.replace(/\.[^.]+$/, "")}-frame-${String(frame).padStart(6, "0")}.png`;

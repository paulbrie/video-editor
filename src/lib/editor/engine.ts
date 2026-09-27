"use client";

import { Subject } from "subjecto";
import { toast } from "sonner";
import type { AudioClip, Frame, Project, Timeline, TimelineSeg, Transition, TrashItem, Video } from "@/db/schema";
import { clamp, fmt, frameFileName, stamp } from "./format";

export type Seg = TimelineSeg;
export type { AudioClip, Transition, TrashItem };
/** Where a transition sits on the edit's timeline (durations already clamped to what fits). */
export type TransitionWindow = {
  kind: "dissolve" | "dip" | "fadein" | "fadeout";
  /** Index of the clip it belongs to (the incoming clip for cuts). */
  i: number;
  start: number;
  end: number;
  /** Effective duration */
  d: number;
  /** The cut point (fade in: 0, fade out: end of edit). */
  cut: number;
};
export const DEFAULT_TRANSITION: Transition = { type: "dissolve", duration: 0.5 };

export type Source = {
  id: string;
  kind: "video" | "audio";
  name: string;
  mimeType: string;
  size: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
  thumbnail: string | null;
  color: string;
  status: "uploading" | "ready" | "error";
  /** Upload progress 0..1 */
  progress: number;
  /** In the project's Trash: hidden from Media, file still on disk. */
  trashed: boolean;
};

/** Timeline with the optional (backward-compatible) fields filled in, plus the selected clip id. */
export type EditState = Required<Timeline> & { sel: string | null };
export type ViewState = { zoom: number; loop: boolean; rate: number; volume: number; muted: boolean };
export type PlayState = { t: number; playing: boolean; cur: number };
export type ProjectState = { id: string; name: string; notes: string; save: "saved" | "dirty" | "saving" | "error" };
export type ExportOptions = {
  range: "all" | "marks";
  format: ExportFormat;
  height: number; // 0 = source
  fps: number;
  bitrate: number;
  monitor: boolean;
};
export type ExportFormat = { mime: string; label: string; ext: string };
export type ExportState = { progress: number; detail: string; status: string };

type ExportJob = {
  rec: MediaRecorder;
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  start: number;
  end: number;
  done: boolean;
  aborted: boolean;
  chunks: Blob[];
  dest: MediaStreamAudioDestinationNode;
  monitor: boolean;
  saved: { loop: boolean; rate: number };
  ext: string;
  t0: number;
};

const COLORS = ["#f5b93d", "#5bc0eb", "#9bc53d", "#e55934", "#b388eb", "#fa7921", "#4ecdc4", "#ff6b9d"];
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|ogv|avi)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|weba|aif|aiff)$/i;
/** Number of audio tracks (A1, A2, …) under the video track. */
export const AUDIO_TRACKS = 2;
const clipLen = (c: AudioClip) => c.out - c.in;
/** Clips on one track may not overlap. */
function fits(clips: AudioClip[], track: number, start: number, len: number, ignore?: string) {
  return !clips.some(
    (c) => c.id !== ignore && c.track === track && start < c.start + clipLen(c) - 1e-6 && c.start < start + len - 1e-6,
  );
}
function normalize(t: Timeline, has: (id: string) => boolean): Omit<EditState, "sel"> {
  return {
    segs: t.segs.filter((s) => has(s.src)),
    markIn: t.markIn,
    markOut: t.markOut,
    audio: (t.audio ?? []).filter((c) => has(c.src)),
    videoMuted: !!t.videoMuted,
    audioMuted: Array.from({ length: AUDIO_TRACKS }, (_, i) => !!t.audioMuted?.[i]),
    fadeOut: t.fadeOut ?? null,
    trash: (t.trash ?? []).filter((i) => has(i.clip.src)),
  };
}
/** Copy of a clip without its transition (splits and duplicates create cuts that start plain). */
const plain = (s: Seg): Seg => {
  const c = { ...s };
  delete c.transition;
  return c;
};
const snapF = (x: number, fps: number) => Math.round(x * fps) / fps;
const frameOf = (x: number, fps: number) => Math.floor(x * fps + 1e-3);
const dur = (s: Seg) => s.out - s.in;
const uid = () => crypto.randomUUID();

function seeked(v: HTMLVideoElement) {
  return new Promise<void>((r) => {
    if (!v.seeking) return r();
    v.addEventListener("seeked", () => r(), { once: true });
    setTimeout(r, 1500);
  });
}

function snapFps(f: number) {
  const common = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 119.88, 120];
  let best: number | null = null;
  for (const c of common)
    if (Math.abs(f - c) / c < 0.015 && (best == null || Math.abs(f - c) < Math.abs(f - best))) best = c;
  return best ?? Math.round(f * 100) / 100;
}

export function exportFormats(): ExportFormat[] {
  const list: ExportFormat[] = [
    { mime: "video/mp4;codecs=avc3.640028,mp4a.40.2", label: "MP4 (H.264 + AAC)", ext: "mp4" },
    { mime: "video/mp4;codecs=avc1.640028,mp4a.40.2", label: "MP4 (H.264 + AAC)", ext: "mp4" },
    { mime: "video/mp4;codecs=avc1,opus", label: "MP4 (H.264 + Opus)", ext: "mp4" },
    { mime: "video/mp4", label: "MP4", ext: "mp4" },
    { mime: "video/webm;codecs=vp9,opus", label: "WebM (VP9 + Opus)", ext: "webm" },
    { mime: "video/webm;codecs=vp8,opus", label: "WebM (VP8 + Opus)", ext: "webm" },
    { mime: "video/webm", label: "WebM", ext: "webm" },
  ];
  if (typeof MediaRecorder === "undefined") return [];
  const ok = list.filter((f) => MediaRecorder.isTypeSupported(f.mime));
  return ok.filter((f, i) => ok.findIndex((g) => g.label === f.label) === i);
}

export class Editor {
  // ---- observable state (subjecto) ----
  readonly sources$ = new Subject<Source[]>([], { name: "sources" });
  readonly edit$: Subject<EditState>;
  readonly view$ = new Subject<ViewState>({ zoom: 60, loop: false, rate: 1, volume: 1, muted: false }, { name: "view" });
  readonly play$ = new Subject<PlayState>({ t: 0, playing: false, cur: 0 }, { name: "play" });
  readonly history$ = new Subject({ undo: 0, redo: 0 }, { name: "history" });
  readonly project$: Subject<ProjectState>;
  readonly export$ = new Subject<ExportState | null>(null, { name: "export" });
  /** Every exported frame, newest first. */
  readonly frames$: Subject<Frame[]>;

  // ---- internal ----
  private srcMap = new Map<string, Source>();
  private colorN = 0;
  private videos = new Map<string, HTMLVideoElement>();
  private objectUrls = new Map<string, string>();
  private stage: HTMLElement | null = null;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private _t = 0;
  private _playing = false;
  private _cur = 0;
  private active: string | null = null;
  private prepFor: string | null = null;
  private raf = 0;
  private job: ExportJob | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSaved = "";
  private uploads = new Map<string, XMLHttpRequest>();
  private uploadChain: Promise<void> = Promise.resolve();
  /**
   * Web Audio graph, created on the first play (it needs a user gesture). Once it exists every
   * media element is routed through it: element → its own gain → mix → master → speakers.
   * Export taps `mix`, so per-clip volume and track mutes are baked in, the preview volume isn't.
   */
  private graph: { ctx: AudioContext; mix: GainNode; master: GainNode; nodes: Map<HTMLMediaElement, GainNode> } | null = null;
  /** One <audio> element per audio clip (clips can overlap in time, even from the same file). */
  private clipEls = new Map<string, HTMLAudioElement>();
  /**
   * How far ahead to start audio clips, in seconds: <audio> takes a few tens of ms to actually
   * start, so starting at the exact position leaves it lagging the picture. Measured and adapted.
   */
  private audioLead = 0.04;
  private leadCheck = new Map<HTMLAudioElement, number>();
  /** Preview canvas: every frame is composited here (so transitions look like the export). */
  private canvas: HTMLCanvasElement | null = null;
  private resize: ResizeObserver | null = null;
  /** What to draw this frame, bottom to top. */
  private layers: { el: HTMLVideoElement; alpha: number }[] = [];
  /** Second video playing during a dissolve (the other side of the cut). */
  private partner: HTMLVideoElement | null = null;
  /** Extra element per source, for dissolves between two parts of the same file. */
  private alts = new Map<string, HTMLVideoElement>();
  /** Video elements currently being probed (played muted to measure fps). */
  private probing = new Set<HTMLMediaElement>();

  constructor(init: { videos: Video[]; project: Project; frames: Frame[] }) {
    this.frames$ = new Subject<Frame[]>(init.frames, { name: "frames" });
    for (const v of init.videos) this.srcMap.set(v.id, this.fromRow(v, this.colorN++));
    this.sources$.next([...this.srcMap.values()]);
    this.edit$ = new Subject<EditState>(
      { ...normalize(init.project.timeline, (id) => this.srcMap.has(id)), sel: null },
      { name: "edit" },
    );
    this.project$ = new Subject<ProjectState>(
      { id: init.project.id, name: init.project.name, notes: init.project.notes, save: "saved" },
      { name: "project" },
    );
    this.lastSaved = this.saveBody();
  }

  // =============== lifecycle ===============
  attach(stage: HTMLElement) {
    this.stage = stage;
    const canvas = document.createElement("canvas");
    stage.prepend(canvas);
    this.canvas = canvas;
    this.resize = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(stage.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(stage.clientHeight * dpr));
    });
    this.resize.observe(stage);
    for (const s of this.srcMap.values()) if (s.kind === "video" && !s.trashed) stage.appendChild(this.video(s.id));
    this.syncClipEls();
    this.seek(this._t);
    const loop = () => {
      this.tick();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  detach() {
    cancelAnimationFrame(this.raf);
    this.pause();
    this.resize?.disconnect();
    this.canvas?.remove();
    this.canvas = null;
    this.stage = null;
  }
  /** True while there is something that would be lost by closing the tab. */
  hasPendingWork() {
    return this.uploads.size > 0 || this.project$.getValue().save !== "saved" || !!this.job;
  }
  /** Best-effort save when the tab closes. */
  flushOnUnload() {
    if (this.saveBody() === this.lastSaved) return;
    fetch(`/api/projects/${this.project$.getValue().id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: this.saveBody(),
      keepalive: true,
    });
  }

  // =============== accessors ===============
  get segs() {
    return this.edit$.getValue().segs;
  }
  get edit() {
    return this.edit$.getValue();
  }
  get view() {
    return this.view$.getValue();
  }
  src(id: string) {
    return this.srcMap.get(id);
  }
  fpsOf(id: string) {
    return this.srcMap.get(id)?.fps || 30;
  }
  starts() {
    const a: number[] = [];
    let acc = 0;
    for (const s of this.segs) {
      a.push(acc);
      acc += dur(s);
    }
    return a;
  }
  /** Length of the edit: the video track. Audio past this point is not played or exported. */
  total() {
    let acc = 0;
    for (const s of this.segs) acc += dur(s);
    return acc;
  }
  /** Rightmost point with any content (audio can run past the end of the video). */
  extent() {
    let end = this.total();
    for (const c of this.edit.audio) end = Math.max(end, c.start + clipLen(c));
    return end;
  }
  selectedAudio() {
    const { sel, audio } = this.edit;
    return sel ? audio.find((c) => c.id === sel) : undefined;
  }
  private curSeg(): Seg | undefined {
    return this.segs[this._cur];
  }
  private curV() {
    const s = this.curSeg();
    return s ? this.video(s.src) : null;
  }

  // =============== sources & media elements ===============
  private fromRow(v: Video, index: number): Source {
    return {
      id: v.id,
      kind: v.kind,
      name: v.name,
      mimeType: v.mimeType,
      size: v.size,
      duration: v.duration,
      width: v.width,
      height: v.height,
      fps: v.fps,
      thumbnail: v.thumbnail,
      color: COLORS[index % COLORS.length],
      status: "ready",
      progress: 1,
      trashed: v.deletedAt != null,
    };
  }
  private video(id: string) {
    let v = this.videos.get(id);
    if (!v) {
      v = document.createElement("video");
      v.preload = "auto";
      v.playsInline = true;
      v.src = this.objectUrls.get(id) ?? `/api/videos/${id}/file`;
      this.videos.set(id, v);
      this.stage?.appendChild(v);
      this.route(v);
      this.applyLevels();
    }
    return v;
  }
  private altVideo(id: string) {
    let v = this.alts.get(id);
    if (!v) {
      v = document.createElement("video");
      v.preload = "auto";
      v.playsInline = true;
      v.src = this.mediaUrl(id);
      this.alts.set(id, v);
      this.stage?.appendChild(v);
      this.route(v);
    }
    return v;
  }
  private allVideos() {
    return [...this.videos.values(), ...this.alts.values()];
  }
  private mediaUrl(id: string) {
    return this.objectUrls.get(id) ?? `/api/videos/${id}/file`;
  }
  private clipEl(c: AudioClip) {
    let el = this.clipEls.get(c.id);
    if (!el) {
      el = new Audio();
      el.preload = "auto";
      el.src = this.mediaUrl(c.src);
      this.clipEls.set(c.id, el);
      this.route(el);
    }
    return el;
  }
  /** Create elements for new audio clips, drop the ones whose clip is gone. */
  private syncClipEls() {
    const live = new Set(this.edit.audio.map((c) => c.id));
    for (const [id, el] of this.clipEls) {
      if (live.has(id)) continue;
      el.pause();
      el.removeAttribute("src");
      el.load();
      this.graph?.nodes.get(el)?.disconnect();
      this.graph?.nodes.delete(el);
      this.clipEls.delete(id);
    }
    for (const c of this.edit.audio) this.clipEl(c);
    this.applyLevels();
  }

  // =============== audio graph & levels ===============
  private ensureGraph() {
    if (!this.graph) {
      const ctx = new AudioContext();
      const mix = ctx.createGain();
      const master = ctx.createGain();
      mix.connect(master).connect(ctx.destination);
      this.graph = { ctx, mix, master, nodes: new Map() };
      for (const v of this.allVideos()) this.route(v);
      for (const el of this.clipEls.values()) this.route(el);
      this.applyLevels();
    }
    return this.graph;
  }
  private route(el: HTMLMediaElement) {
    const g = this.graph;
    if (!g || g.nodes.has(el)) return;
    try {
      const gain = g.ctx.createGain();
      g.ctx.createMediaElementSource(el).connect(gain).connect(g.mix);
      g.nodes.set(el, gain);
    } catch {
      // already routed elsewhere or not routable; it keeps playing directly
    }
  }
  /** Push mute/volume state into the graph (or into the elements before the graph exists). */
  private applyLevels() {
    const { muted, volume } = this.view;
    const { videoMuted, audioMuted, audio } = this.edit;
    const g = this.graph;
    if (g) g.master.gain.value = this.job ? (this.job.monitor ? 1 : 0) : muted ? 0 : volume;
    const set = (el: HTMLMediaElement, level: number) => {
      const node = g?.nodes.get(el);
      if (node) {
        node.gain.value = level;
        el.muted = false;
        el.volume = 1;
      } else {
        el.muted = muted || level === 0;
        el.volume = clamp(level * volume, 0, 1);
      }
    };
    for (const v of this.allVideos()) if (!this.probing.has(v)) set(v, videoMuted ? 0 : 1);
    for (const c of audio) {
      const el = this.clipEls.get(c.id);
      if (el) set(el, audioMuted[c.track] ? 0 : c.volume);
    }
  }
  /** Keep every audio clip's element playing in step with the video clock. */
  private syncAudio() {
    const t = this._t;
    const rate = this.view.rate;
    for (const c of this.edit.audio) {
      const el = this.clipEl(c);
      const len = clipLen(c);
      const local = c.in + (t - c.start);
      const active = this._playing && t >= c.start - 1e-3 && t < c.start + len;
      if (active) {
        if (el.playbackRate !== rate) el.playbackRate = rate;
        const restart = () => {
          el.currentTime = Math.min(c.out, local + this.audioLead * rate);
          this.leadCheck.set(el, performance.now());
        };
        if (el.paused) {
          restart();
          el.play().catch(() => {});
        } else {
          const drift = el.currentTime - local;
          const since = this.leadCheck.get(el);
          if (since != null && performance.now() - since > 400) {
            // once it has settled, learn the start latency from the remaining offset
            this.leadCheck.delete(el);
            if (Math.abs(drift) < 0.2) this.audioLead = clamp(this.audioLead - (0.5 * drift) / rate, 0, 0.25);
          }
          if (Math.abs(drift) > 0.2) restart();
        }
      } else {
        if (!el.paused) el.pause();
        // pre-roll: park the element on its first sample just before the clip starts
        if (this._playing && c.start - t > 0 && c.start - t < 0.6 && Math.abs(el.currentTime - c.in) > 0.05) el.currentTime = c.in;
      }
    }
  }
  private setSources(list: Source[]) {
    this.srcMap = new Map(list.map((s) => [s.id, s]));
    this.sources$.next(list);
  }
  private patchSource(id: string, patch: Partial<Source>) {
    const s = this.srcMap.get(id);
    if (!s) return;
    this.setSources(this.sources$.getValue().map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  /** Rename a media file (its display name in the library, and the default label of its clips). */
  async renameSource(id: string, name: string) {
    const s = this.src(id);
    name = name.trim();
    if (!s || !name || name === s.name) return;
    const prev = s.name;
    this.patchSource(id, { name });
    this.emitPlay(); // timecode line shows the clip's name
    const res = await fetch(`/api/videos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok && this.src(id)?.status === "ready") {
      this.patchSource(id, { name: prev });
      toast.error("Could not rename the file");
    }
  }
  /** Label shown for a timeline clip: its own name, else its file's. */
  clipLabel(c: { src: string; name?: string }) {
    return c.name ?? this.src(c.src)?.name ?? "missing";
  }
  /** Give a video or audio clip its own name; an empty name goes back to the file's name. */
  renameClip(id: string, name: string) {
    const next = name.trim() ? name.trim().slice(0, 200) : undefined;
    const rename = <T extends { id: string; name?: string }>(c: T): T => {
      if (c.id !== id) return c;
      const copy = { ...c, name: next };
      if (!next) delete copy.name; // no custom name: keep the saved JSON free of `name: undefined`
      return copy;
    };
    const seg = this.segs.find((s) => s.id === id);
    const clip = this.edit.audio.find((c) => c.id === id);
    if (!seg && !clip) return;
    if ((seg ?? clip)!.name === next) return;
    this.commit();
    if (seg) this.setEdit({ segs: this.segs.map(rename) });
    else this.setEdit({ audio: this.edit.audio.map(rename) });
    this.emitPlay();
  }
  /** Select a clip and move the playhead into it (used before acting on it from a menu). */
  focusClip(id: string) {
    this.select(id);
    const i = this.segs.findIndex((s) => s.id === id);
    if (i >= 0 && (this._cur !== i || this._t < this.starts()[i])) this.seek(this.starts()[i]);
  }

  async setFps(id: string, fps: number) {
    if (!(fps >= 1 && fps <= 1000)) return;
    this.patchSource(id, { fps });
    this.emitPlay();
    const res = await fetch(`/api/videos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fps }),
    });
    if (!res.ok && this.src(id)?.status === "ready") toast.error("Could not save the frame rate");
  }

  /** Probe files locally, add them to the timeline right away, and upload them in the background. */
  async addFiles(fileList: FileList | File[]) {
    const files = [...fileList].filter(
      (f) => f.type.startsWith("video/") || f.type.startsWith("audio/") || VIDEO_EXT.test(f.name) || AUDIO_EXT.test(f.name),
    );
    if (!files.length) {
      toast.error("No video or audio files found in that selection");
      return;
    }
    const tid = toast.loading(`Reading ${files.length} file${files.length > 1 ? "s" : ""}…`);
    const probes = files.map((f) => this.probe(f));
    let added = 0;
    let audioAt = this._t; // several audio files dropped together go one after another
    const wasEmpty = !this.segs.length;
    for (const p of probes) {
      const r = await p;
      if (!r) continue;
      const { source, file } = r;
      if (!added) this.commit();
      this.setSources([...this.sources$.getValue(), source]);
      if (source.kind === "video") {
        this.setEdit({ segs: [...this.segs, { id: uid(), src: source.id, in: 0, out: source.duration }] });
      } else {
        const c = this.placeAudio(source, audioAt);
        audioAt = c.start + clipLen(c);
      }
      added++;
      // register right away (so frames can reference it); only the byte uploads are queued
      const registered = this.register(source);
      this.uploadChain = this.uploadChain.then(async () => {
        if (await registered) await this.upload(source, file);
      });
    }
    toast.dismiss(tid);
    if (added) {
      if (wasEmpty) this.seek(0);
      else this.afterEdit();
      toast.success(`Added ${added} file${added > 1 ? "s" : ""} — uploading to the library`);
      if (!this.segs.length && this.edit.audio.length) toast("Add a video too: the edit is as long as its video track");
    }
  }

  private async probe(file: File): Promise<{ source: Source; file: File } | null> {
    const id = uid();
    const url = URL.createObjectURL(file);
    this.objectUrls.set(id, url);
    if (file.type.startsWith("audio/") || AUDIO_EXT.test(file.name)) {
      try {
        return { file, source: await this.probeAudio(file, id, url) };
      } catch {
        URL.revokeObjectURL(url);
        this.objectUrls.delete(id);
        toast.error(`Can't play "${file.name}" in this browser (unsupported codec?)`);
        return null;
      }
    }
    const v = this.video(id);
    this.probing.add(v);
    try {
      await new Promise<void>((res, rej) => {
        v.addEventListener("loadeddata", () => res(), { once: true });
        v.addEventListener("error", () => rej(new Error("decode")), { once: true });
      });
      if (!v.videoWidth) {
        // a container with sound only (e.g. an audio-only .webm/.mp4): treat it as audio
        this.probing.delete(v);
        v.remove();
        this.videos.delete(id);
        return { file, source: await this.probeAudio(file, id, url) };
      }
      // MediaRecorder-made webm files often report Infinity until you seek to the end.
      if (!Number.isFinite(v.duration)) {
        v.currentTime = 1e101;
        await new Promise((r) => v.addEventListener("durationchange", r, { once: true }));
        v.currentTime = 0;
        await seeked(v);
      }
      const fps = (await this.detectFps(v)) || 30;
      v.currentTime = Math.min(v.duration * 0.1, 2);
      await seeked(v);
      const c = document.createElement("canvas");
      c.height = 90;
      c.width = Math.round(90 * (v.videoWidth / v.videoHeight || 16 / 9));
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      v.currentTime = 0;
      this.probing.delete(v);
      this.applyLevels();
      return {
        file,
        source: {
          id,
          kind: "video",
          name: file.name,
          mimeType: file.type || "video/mp4",
          size: file.size,
          duration: v.duration,
          width: v.videoWidth,
          height: v.videoHeight,
          fps,
          thumbnail: c.toDataURL("image/jpeg", 0.7),
          color: COLORS[this.colorN++ % COLORS.length],
          status: "uploading",
          progress: 0,
          trashed: false,
        },
      };
    } catch {
      this.probing.delete(v);
      v.remove();
      this.videos.delete(id);
      URL.revokeObjectURL(url);
      this.objectUrls.delete(id);
      toast.error(`Can't play "${file.name}" in this browser (unsupported codec?)`);
      return null;
    }
  }

  private async probeAudio(file: File, id: string, url: string): Promise<Source> {
    const a = new Audio();
    a.preload = "metadata";
    a.src = url;
    await new Promise<void>((res, rej) => {
      a.addEventListener("loadedmetadata", () => res(), { once: true });
      a.addEventListener("error", () => rej(new Error("decode")), { once: true });
    });
    if (!Number.isFinite(a.duration)) {
      a.currentTime = 1e101;
      await new Promise((r) => a.addEventListener("durationchange", r, { once: true }));
    }
    const duration = a.duration;
    a.removeAttribute("src");
    a.load();
    const thumbnail = await this.waveform(file, duration).catch(() => null);
    return {
      id,
      kind: "audio",
      name: file.name,
      mimeType: file.type || "audio/mpeg",
      size: file.size,
      duration,
      width: 0,
      height: 0,
      fps: 30,
      thumbnail,
      color: COLORS[this.colorN++ % COLORS.length],
      status: "uploading",
      progress: 0,
      trashed: false,
    };
  }
  /** Draws the file's waveform into a PNG data URL (decoded at 3 kHz to keep memory low). */
  private async waveform(file: File, duration: number) {
    if (file.size > 300 * 1024 * 1024) return null;
    const buf = await new OfflineAudioContext(1, 1, 3000).decodeAudioData(await file.arrayBuffer());
    const W = Math.round(clamp(duration * 40, 400, 4000));
    const H = 64;
    const channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
    const per = buf.length / W;
    const peaks = new Float32Array(W);
    let max = 0;
    for (let x = 0; x < W; x++) {
      let m = 0;
      const end = Math.min(buf.length, Math.floor((x + 1) * per));
      for (const d of channels) for (let i = Math.floor(x * per); i < end; i++) m = Math.max(m, Math.abs(d[i]));
      peaks[x] = m;
      max = Math.max(max, m);
    }
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d")!;
    g.fillStyle = "rgba(255,255,255,0.8)";
    for (let x = 0; x < W; x++) {
      const h = max ? (peaks[x] / max) * (H / 2 - 1) : 0;
      g.fillRect(x, H / 2 - h, 1, Math.max(1, h * 2));
    }
    return c.toDataURL("image/png");
  }

  private async detectFps(v: HTMLVideoElement) {
    if (!("requestVideoFrameCallback" in HTMLVideoElement.prototype)) return null;
    const times: number[] = [];
    v.muted = true;
    try {
      await v.play();
    } catch {
      return null;
    }
    await new Promise<void>((done) => {
      const t0 = performance.now();
      const cb: VideoFrameRequestCallback = (_now, md) => {
        times.push(md.mediaTime);
        if (times.length < 24 && performance.now() - t0 < 2000) v.requestVideoFrameCallback(cb);
        else done();
      };
      v.requestVideoFrameCallback(cb);
      setTimeout(done, 2600);
    });
    v.pause();
    let min = Infinity;
    for (let i = 1; i < times.length; i++) {
      const d = times[i] - times[i - 1];
      if (d > 0.002 && d < min) min = d;
    }
    return Number.isFinite(min) ? snapFps(1 / min) : null;
  }

  /** Creates the video row. Resolves false (and marks the source failed) if the server refuses it. */
  private async register(s: Source) {
    try {
      const meta = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: s.id,
          projectId: this.project$.getValue().id,
          kind: s.kind,
          name: s.name,
          mimeType: s.mimeType,
          size: s.size,
          duration: s.duration,
          width: s.width,
          height: s.height,
          fps: s.fps,
          thumbnail: s.thumbnail,
        }),
      });
      if (!meta.ok) throw new Error((await meta.json().catch(() => ({}))).error ?? meta.statusText);
      return true;
    } catch (e) {
      this.patchSource(s.id, { status: "error" });
      toast.error(`Could not add "${s.name}" to the library: ${(e as Error).message}`);
      return false;
    }
  }

  private async upload(s: Source, file: File) {
    if (!this.srcMap.has(s.id)) return; // removed before its turn
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        this.uploads.set(s.id, xhr);
        xhr.open("PUT", `/api/videos/${s.id}/file`);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        let last = 0;
        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) return;
          const p = e.loaded / e.total;
          if (p - last >= 0.01 || p === 1) {
            last = p;
            this.patchSource(s.id, { progress: p });
          }
        };
        xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(xhr.responseText || xhr.statusText)));
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.onabort = () => reject(new Error("aborted"));
        xhr.send(file);
      });
      this.patchSource(s.id, { status: "ready", progress: 1 });
      this.scheduleSave(); // timeline now references a stored video
    } catch (e) {
      if ((e as Error).message === "aborted") return;
      this.patchSource(s.id, { status: "error" });
      toast.error(`Upload of "${s.name}" failed: ${(e as Error).message}`);
    } finally {
      this.uploads.delete(s.id);
    }
  }

  /**
   * Move a media file to the Trash. Its clips go with it (remembered with `media`), so restoring the
   * file puts them back. Uploads that never finished can't be kept, so they are deleted outright.
   */
  async removeSource(id: string) {
    const s = this.src(id);
    if (!s) return;
    if (s.status !== "ready") return this.deleteSourceForever(id);
    if (this._playing) this.pause();
    this.commit();
    const now = Date.now();
    const items: TrashItem[] = [];
    this.segs.forEach((clip, index) => {
      if (clip.src === id) items.push({ kind: "video", clip, index, deletedAt: now, media: id });
    });
    for (const clip of this.edit.audio) if (clip.src === id) items.push({ kind: "audio", clip, deletedAt: now, media: id });
    this.patchSource(id, { trashed: true });
    this.setEdit({
      segs: this.segs.filter((c) => c.src !== id),
      audio: this.edit.audio.filter((c) => c.src !== id),
      trash: [...items, ...this.edit.trash],
    });
    this.afterEdit();
    toast(`Moved “${s.name}” to the Trash${items.length ? ` with ${items.length} clip${items.length > 1 ? "s" : ""}` : ""}`);
    const res = await fetch(`/api/videos/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      this.patchSource(id, { trashed: false });
      toast.error(`Could not move "${s.name}" to the Trash`);
    }
  }
  /** Take a media file out of the Trash (server + local), without touching the timeline. */
  private untrash(id: string) {
    const s = this.src(id);
    if (!s?.trashed) return;
    this.patchSource(id, { trashed: false });
    fetch(`/api/videos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: false }),
    }).then((r) => {
      if (!r.ok) {
        this.patchSource(id, { trashed: true });
        toast.error(`Could not restore "${s.name}"`);
      }
    });
  }
  /** Restore a trashed media file and put back the clips that went to the Trash with it. */
  restoreSource(id: string) {
    const s = this.src(id);
    if (!s?.trashed) return;
    this.commit();
    this.untrash(id);
    const items = this.edit.trash.filter((i) => i.media === id);
    let state = { segs: this.segs, audio: this.edit.audio };
    // original indexes are positions in the timeline before removal, so re-insert in ascending order
    const ordered = [...items].sort((a, b) => (a.kind === "video" ? a.index : 1e9) - (b.kind === "video" ? b.index : 1e9));
    for (const item of ordered) state = this.putBack(state, item, "original");
    this.setEdit({ ...state, trash: this.edit.trash.filter((i) => i.media !== id) });
    this.afterEdit();
    toast(`Restored “${s.name}”${items.length ? ` and ${items.length} clip${items.length > 1 ? "s" : ""}` : ""}`);
  }

  /** Delete a media file for good: its element, clips, trash entries, the row and the file on disk. */
  async deleteSourceForever(id: string) {
    const s = this.src(id);
    if (!s) return;
    this.uploads.get(id)?.abort();
    if (this.active === id) this.active = null;
    const v = this.videos.get(id);
    if (v) {
      v.pause();
      v.remove();
      this.videos.delete(id);
    }
    const url = this.objectUrls.get(id);
    if (url) URL.revokeObjectURL(url);
    this.objectUrls.delete(id);
    if (v) {
      this.graph?.nodes.get(v)?.disconnect();
      this.graph?.nodes.delete(v);
    }
    this.setSources(this.sources$.getValue().filter((x) => x.id !== id));
    const segs = this.segs.filter((sg) => sg.src !== id);
    const audio = this.edit.audio.filter((c) => c.src !== id);
    const alt = this.alts.get(id);
    if (alt) {
      alt.pause();
      alt.remove();
      this.graph?.nodes.get(alt)?.disconnect();
      this.graph?.nodes.delete(alt);
      this.alts.delete(id);
    }
    const trash = this.edit.trash.filter((i) => i.clip.src !== id);
    if (trash.length !== this.edit.trash.length) this.setEdit({ trash });
    if (segs.length !== this.segs.length || audio.length !== this.edit.audio.length) {
      // history may reference the deleted file; drop it rather than restore broken clips
      this.undoStack = [];
      this.redoStack = [];
      this.emitHistory();
      this.setEdit({ segs, audio });
    }
    this.afterEdit();
    const res = await fetch(`/api/videos/${id}?permanent=1`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) toast.error(`Could not delete "${s.name}"`);
  }

  // =============== project persistence ===============
  private saveBody() {
    const { segs, markIn, markOut, audio, videoMuted, audioMuted, fadeOut, trash } = this.edit;
    const p = this.project$.getValue();
    const ok = (id: string) => this.src(id)?.status !== "error";
    const timeline: Timeline = {
      segs: segs.filter((s) => ok(s.src)),
      markIn,
      markOut,
      audio: audio.filter((c) => ok(c.src)),
      videoMuted,
      audioMuted,
      fadeOut,
      trash: trash.filter((i) => ok(i.clip.src)),
    };
    return JSON.stringify({ name: p.name, notes: p.notes, timeline });
  }
  private scheduleSave() {
    if (this.saveBody() === this.lastSaved) return;
    this.project$.nextAssign({ save: "dirty" });
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 800);
  }
  async saveNow() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const body = this.saveBody();
    const id = this.project$.getValue().id;
    if (body === this.lastSaved) {
      this.project$.nextAssign({ save: "saved" });
      return true;
    }
    this.project$.nextAssign({ save: "saving" });
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
      if (this.project$.getValue().id !== id) return true; // switched project meanwhile
      this.lastSaved = body;
      this.project$.nextAssign({ save: this.saveBody() === body ? "saved" : "dirty" });
      if (this.saveBody() !== body) this.scheduleSave();
      return true;
    } catch (e) {
      this.project$.nextAssign({ save: "error" });
      toast.error("Could not save the project: " + (e as Error).message);
      return false;
    }
  }
  /** The project's notepad; saved with the project (debounced like every other change). */
  setNotes(notes: string) {
    if (notes === this.project$.getValue().notes) return;
    this.project$.nextAssign({ notes });
    this.scheduleSave();
  }
  renameProject(name: string) {
    name = name.trim();
    if (!name || name === this.project$.getValue().name) return;
    this.project$.nextAssign({ name });
    document.title = `${name} · Cutroom`;
    this.scheduleSave();
  }
  /** Projects live at /p/<id>; switching saves this one and navigates (so each tab holds one project). */
  async openProject(id: string) {
    if (id === this.project$.getValue().id) return;
    await this.saveNow();
    // a full load on purpose: the new project gets a fresh engine (media elements, audio graph)
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/p/${id}`);
  }
  async newProject(name = "Untitled project") {
    await this.saveNow();
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return void toast.error("Could not create a project");
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/p/${(await res.json()).id}`);
  }

  // =============== undo ===============
  private snapshot() {
    const { segs, markIn, markOut, audio, fadeOut, trash } = this.edit;
    return JSON.stringify({ segs, markIn, markOut, audio, fadeOut, trash });
  }
  private emitHistory() {
    this.history$.next({ undo: this.undoStack.length, redo: this.redoStack.length });
  }
  commit(snap = this.snapshot()) {
    this.undoStack.push(snap);
    if (this.undoStack.length > 300) this.undoStack.shift();
    this.redoStack = [];
    this.emitHistory();
  }
  private restore(json: string) {
    const o = JSON.parse(json) as Timeline;
    const has = (id: string) => this.srcMap.has(id);
    this.setEdit({
      segs: o.segs.filter((s) => has(s.src)),
      markIn: o.markIn,
      markOut: o.markOut,
      audio: (o.audio ?? []).filter((c) => has(c.src)),
      fadeOut: o.fadeOut ?? null,
      trash: (o.trash ?? []).filter((i) => has(i.clip.src)),
    });
    for (const c of [...this.segs, ...this.edit.audio]) if (this.src(c.src)?.trashed) this.untrash(c.src);
    this.afterEdit();
  }
  undo() {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.snapshot());
    this.restore(s);
    this.emitHistory();
  }
  redo() {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snapshot());
    this.restore(s);
    this.emitHistory();
  }

  private setEdit(patch: Partial<EditState>) {
    this.edit$.next({ ...this.edit, ...patch });
    if ("audio" in patch) this.syncClipEls();
    else if ("videoMuted" in patch || "audioMuted" in patch) this.applyLevels();
    if (["segs", "markIn", "markOut", "audio", "videoMuted", "audioMuted", "fadeOut", "trash"].some((k) => k in patch))
      this.scheduleSave();
  }
  select(id: string | null) {
    if (this.edit.sel !== id) this.setEdit({ sel: id });
  }
  private afterEdit() {
    const { sel, markIn, markOut, segs, audio } = this.edit;
    const T = this.total();
    const patch: Partial<EditState> = {};
    if (sel && !segs.some((s) => s.id === sel) && !audio.some((c) => c.id === sel)) patch.sel = null;
    if (markIn != null && markIn > T) patch.markIn = null;
    if (markOut != null && markOut > T) patch.markOut = null;
    if (Object.keys(patch).length) this.setEdit(patch);
    this.seek(Math.min(this._t, T));
  }

  // =============== playback engine ===============
  private emitPlay() {
    this.play$.next({ t: this._t, playing: this._playing, cur: this._cur });
  }
  /** The clip under the playhead's video; during playback compose() pauses every other element. */
  private setActive(id: string | null) {
    this.active = id;
  }
  locate(t: number) {
    const segs = this.segs;
    let acc = 0;
    for (let i = 0; i < segs.length; i++) {
      const d = dur(segs[i]);
      if (t < acc + d - 1e-6 || i === segs.length - 1) return { i, local: segs[i].in + clamp(t - acc, 0, d) };
      acc += d;
    }
    return null;
  }
  seek(t: number) {
    if (!this.segs.length) {
      this._t = 0;
      this._cur = 0;
      this.setActive(null);
      if (this._playing) this.pause();
      this.emitPlay();
      return;
    }
    t = clamp(t, 0, this.total());
    const L = this.locate(t)!;
    this._cur = L.i;
    this._t = t;
    this.prepFor = null;
    const sg = this.segs[L.i];
    const v = this.video(sg.src);
    this.setActive(sg.src);
    const show = Math.min(L.local, sg.out - 0.001); // at a clip's end, show its last frame
    if (Math.abs(v.currentTime - show) > 1e-4) v.currentTime = show;
    if (this._playing) {
      v.playbackRate = this.view.rate;
      v.play().catch(() => {});
    }
    this.emitPlay();
  }
  region(): [number, number] {
    const { markIn, markOut } = this.edit;
    if (markIn != null && markOut != null && markOut > markIn) return [markIn, markOut];
    return [0, this.total()];
  }
  play() {
    if (!this.segs.length) return;
    const [a, b] = this.view.loop ? this.region() : [0, this.total()];
    if (this._t >= b - 0.01 || (this.view.loop && this._t < a)) this.seek(a);
    this._playing = true;
    const g = this.ensureGraph();
    if (g.ctx.state !== "running") g.ctx.resume();
    const v = this.curV()!;
    v.playbackRate = this.view.rate;
    v.play().catch((e) => {
      this._playing = false;
      this.emitPlay();
      toast.error("Playback failed: " + e.message);
    });
    this.emitPlay();
  }
  pause() {
    const sg = this.curSeg();
    if (this._playing && sg) {
      const v = this.video(sg.src);
      this._t = this.starts()[this._cur] + clamp(v.currentTime - sg.in, 0, dur(sg));
    }
    this._playing = false;
    for (const v of this.videos.values()) v.pause();
    for (const el of this.clipEls.values()) el.pause();
    this.emitPlay();
  }
  togglePlay() {
    if (this._playing) this.pause();
    else this.play();
  }
  private advance() {
    const prev = this.curSeg()!;
    const pv = this.video(prev.src);
    const ni = this._cur + 1;
    if (ni >= this.segs.length) {
      this._t = this.total();
      return;
    }
    const next = this.segs[ni];
    const nv = this.video(next.src);
    const contiguous = next.src === prev.src && Math.abs(next.in - pv.currentTime) < 0.06;
    const prepared = this.prepFor === next.id;
    this._cur = ni;
    this._t = this.starts()[ni];
    this.prepFor = null;
    // a dissolve may already be playing the next clip right at its in-point
    const running = !nv.paused && Math.abs(nv.currentTime - next.in) < 0.15;
    if (!contiguous && !prepared && !running) nv.currentTime = next.in;
    if (nv !== pv) {
      this.setActive(next.src);
      nv.playbackRate = this.view.rate;
      nv.play().catch(() => {});
    }
  }
  /** Pre-seek the next clip's video so the switch is seamless. */
  private prepNext(sg: Seg, local: number) {
    const next = this.segs[this._cur + 1];
    if (!next || next.src === sg.src || this.prepFor === next.id || sg.out - local > 0.6) return;
    if (next.transition?.type === "dissolve") return; // compose() is already running it as the partner
    this.video(next.src).currentTime = next.in;
    this.prepFor = next.id;
  }
  private tick() {
    if (this._playing && this.segs.length) {
      const sg = this.curSeg()!;
      const v = this.video(sg.src);
      const local = v.currentTime;
      if (local >= sg.out - 0.004 || v.ended) this.advance();
      else {
        this._t = this.starts()[this._cur] + Math.max(0, local - sg.in);
        this.prepNext(sg, local);
      }
      const stopAt = this.job ? this.job.end : this.view.loop ? this.region()[1] : this.total();
      if (this._t >= stopAt - 0.002) {
        if (this.job) this.finishExport();
        else if (this.view.loop) this.seek(this.region()[0]);
        else {
          this.pause();
          this.seek(stopAt);
        }
      }
      if (this._playing) this.syncAudio();
      this.emitPlay();
    }
    this.compose();
    if (this.canvas) this.paint(this.canvas.getContext("2d")!, this.canvas.width, this.canvas.height);
    if (this.job && !this.job.done) this.drawExport();
  }

  // =============== transitions & compositing ===============
  /** Every transition on the edit, with durations clamped so neighbouring windows never overlap. */
  transitionWindows(): TransitionWindow[] {
    const segs = this.segs;
    const st = this.starts();
    const out: TransitionWindow[] = [];
    segs.forEach((s, i) => {
      if (!s.transition) return;
      if (i === 0) {
        const d = Math.min(s.transition.duration, dur(s) / 2);
        out.push({ kind: "fadein", i, start: 0, end: d, d, cut: 0 });
        return;
      }
      const d = Math.min(s.transition.duration, dur(segs[i - 1]), dur(s));
      out.push({ kind: s.transition.type, i, start: st[i] - d / 2, end: st[i] + d / 2, d, cut: st[i] });
    });
    const fo = this.edit.fadeOut;
    if (fo && segs.length) {
      const T = this.total();
      const d = Math.min(fo, dur(segs[segs.length - 1]) / 2);
      out.push({ kind: "fadeout", i: segs.length - 1, start: T - d, end: T, d, cut: T });
    }
    return out;
  }
  /** Decide what is on screen at the playhead (and at what volume), driving the partner video for dissolves. */
  private compose() {
    const sg = this.curSeg();
    let partner: HTMLVideoElement | null = null;
    let layers: { el: HTMLVideoElement; alpha: number }[] = [];
    if (sg) {
      const master = this.video(sg.src);
      const t = this._t;
      const w = this.transitionWindows().find((x) => t >= x.start - 1e-6 && t < x.end);
      let masterGain = 1;
      let partnerGain = 0;
      if (w && w.kind === "dissolve") {
        const p = clamp((t - w.start) / w.d, 0, 1);
        const A = this.segs[w.i - 1];
        const B = this.segs[w.i];
        const beforeCut = this._cur === w.i - 1;
        const other = beforeCut ? B : A;
        // the other side of the cut plays its handle: frames just before B's in / just after A's out
        const want = beforeCut ? B.in - (w.cut - t) : A.out + (t - w.cut);
        const srcDur = this.src(other.src)?.duration ?? other.out;
        const time = clamp(want, 0, srcDur - 0.001);
        partner = other.src === sg.src ? this.altVideo(other.src) : this.video(other.src);
        this.syncPartner(partner, time, this._playing && time === want);
        layers = beforeCut ? [{ el: master, alpha: 1 }, { el: partner, alpha: p }] : [{ el: partner, alpha: 1 }, { el: master, alpha: p }];
        masterGain = beforeCut ? 1 - p : p;
        partnerGain = beforeCut ? p : 1 - p;
      } else if (w) {
        const a =
          w.kind === "fadein" ? (t - w.start) / w.d : w.kind === "fadeout" ? (w.end - t) / w.d : Math.abs(t - w.cut) / (w.d / 2);
        masterGain = clamp(a, 0, 1);
        layers = [{ el: master, alpha: masterGain }];
      } else layers = [{ el: master, alpha: 1 }];

      // prime the incoming side of an upcoming dissolve: a seek takes a moment, during which
      // the element has no frame to draw, so park it on its first frame before the window opens
      const next = this.segs[this._cur + 1];
      if (!partner && next?.transition?.type === "dissolve") {
        const up = this.transitionWindows().find((x) => x.i === this._cur + 1);
        if (up && up.start - t > 0 && up.start - t < 0.8) {
          const el = next.src === sg.src ? this.altVideo(next.src) : this.video(next.src);
          const at = clamp(next.in - up.d / 2, 0, (this.src(next.src)?.duration ?? next.out) - 0.001);
          if (el.paused && !el.seeking && Math.abs(el.currentTime - at) > 0.02) el.currentTime = at;
          partner = el; // keep the housekeeping below from pausing/fighting it
          partnerGain = 0;
        }
      }

      if (this._playing)
        for (const v of this.allVideos())
          if (v !== master && v !== partner && !v.paused && !this.probing.has(v)) v.pause();
      const g = this.graph;
      if (g) {
        const base = this.edit.videoMuted ? 0 : 1;
        for (const v of this.allVideos()) {
          const node = g.nodes.get(v);
          if (node && !this.probing.has(v))
            node.gain.value = base * (v === master ? masterGain : v === partner ? partnerGain : 1);
        }
      }
    }
    if (this.partner && this.partner !== partner && !this._playing) this.partner.pause();
    this.partner = partner;
    this.layers = layers;
  }
  private syncPartner(el: HTMLVideoElement, time: number, play: boolean) {
    if (el.playbackRate !== this.view.rate) el.playbackRate = this.view.rate;
    if (play) {
      if (el.paused) {
        el.currentTime = time;
        el.play().catch(() => {});
      } else if (Math.abs(el.currentTime - time) > 0.12) el.currentTime = time;
    } else {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - time) > 0.02) el.currentTime = time;
    }
  }
  /** Draw the current layers into any 2D context (preview, export, frame capture). */
  private paint(ctx: CanvasRenderingContext2D, W: number, H: number) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    for (const { el, alpha } of this.layers) {
      if (alpha <= 0.001 || el.readyState < 2 || !el.videoWidth) continue;
      const r = Math.min(W / el.videoWidth, H / el.videoHeight);
      const w = el.videoWidth * r;
      const h = el.videoHeight * r;
      ctx.globalAlpha = alpha;
      ctx.drawImage(el, (W - w) / 2, (H - h) / 2, w, h);
    }
    ctx.globalAlpha = 1;
  }
  /** Set (or clear, with null) the transition into a clip. On the first clip it is a fade in from black. */
  setTransition(segId: string, t: Transition | null) {
    const i = this.segs.findIndex((s) => s.id === segId);
    if (i < 0) return;
    const next = t && { type: i === 0 ? ("dip" as const) : t.type, duration: clamp(t.duration, 0.04, 10) };
    if (JSON.stringify(this.segs[i].transition ?? null) === JSON.stringify(next)) return;
    this.commit();
    const segs = [...this.segs];
    segs[i] = next ? { ...segs[i], transition: next } : plain(segs[i]);
    this.setEdit({ segs });
  }
  /** Apply one transition (or none) to every cut. */
  setAllTransitions(t: Transition | null) {
    if (this.segs.length < 2) return;
    this.commit();
    this.setEdit({ segs: this.segs.map((s, i) => (i === 0 ? s : t ? { ...s, transition: { ...t } } : plain(s))) });
  }
  setFadeOut(d: number | null) {
    const next = d == null ? null : clamp(d, 0.04, 10);
    if (next === this.edit.fadeOut) return;
    this.commit();
    this.setEdit({ fadeOut: next });
  }
  /** `T`: toggle a cross-dissolve on the cut nearest the playhead. */
  toggleNearestTransition() {
    const st = this.starts();
    let best = -1;
    for (let i = 1; i < st.length; i++) if (best < 0 || Math.abs(st[i] - this._t) < Math.abs(st[best] - this._t)) best = i;
    if (best < 0 || Math.abs(st[best] - this._t) > 1.5) return void toast("Move the playhead near a cut between two clips");
    const sg = this.segs[best];
    this.setTransition(sg.id, sg.transition ? null : DEFAULT_TRANSITION);
    toast(sg.transition ? "Transition removed" : "Cross-dissolve added (0.5 s)");
  }

  /** Info about the frame under the playhead. */
  frameInfo() {
    const sg = this.curSeg();
    if (!sg) return null;
    const st = this.starts()[this._cur];
    const fps = this.fpsOf(sg.src);
    const local = sg.in + (this._t - st);
    const f = frameOf(Math.min(local, sg.out - 0.001), fps);
    return {
      sg,
      i: this._cur,
      fps,
      f,
      st,
      seqStart: st + Math.max(0, f / fps - sg.in),
      seqEnd: st + Math.min(dur(sg), (f + 1) / fps - sg.in),
    };
  }
  step(dir: 1 | -1) {
    if (this._playing) this.pause();
    const fi = this.frameInfo();
    if (!fi) return;
    const { sg, fps, f, st } = fi;
    const nl = (f + dir) / fps;
    if (dir > 0 && nl >= sg.out - 1e-4) {
      if (this._cur + 1 < this.segs.length) this.seek(this.starts()[this._cur + 1]);
      return;
    }
    if (dir < 0 && nl < sg.in - 1e-4) {
      if (this._cur > 0) {
        const p = this.segs[this._cur - 1];
        const pf = this.fpsOf(p.src);
        const last = Math.ceil(p.out * pf - 1e-3) - 1;
        this.seek(this.starts()[this._cur - 1] + Math.max(0, last / pf - p.in));
      }
      return;
    }
    this.seek(st + Math.max(0, nl - sg.in));
  }
  jump(sec: number) {
    this.seek(this._t + sec);
  }
  private editPoints() {
    const st = this.starts();
    st.push(this.total());
    return st;
  }
  prevEdit() {
    const e = this.editPoints().filter((x) => x < this._t - 1e-3);
    this.seek(e.length ? e[e.length - 1] : 0);
  }
  nextEdit() {
    this.seek(this.editPoints().find((x) => x > this._t + 1e-3) ?? this.total());
  }
  toStart() {
    this.seek(0);
  }
  toEnd() {
    this.seek(this.total());
  }

  // =============== view settings ===============
  setRate(rate: number) {
    this.view$.nextAssign({ rate });
    const v = this.curV();
    if (v) v.playbackRate = rate;
  }
  toggleLoop() {
    this.view$.nextAssign({ loop: !this.view.loop });
  }
  setMuted(muted: boolean) {
    this.view$.nextAssign({ muted });
    this.applyLevels();
  }
  setVolume(volume: number) {
    this.view$.nextAssign({ volume });
    if (this.view.muted && volume > 0) this.view$.nextAssign({ muted: false });
    this.applyLevels();
  }
  /** Mute the video clips' own sound (`"video"`) or an audio track (0-based). */
  toggleTrackMute(track: "video" | number) {
    if (track === "video") this.setEdit({ videoMuted: !this.edit.videoMuted });
    else this.setEdit({ audioMuted: this.edit.audioMuted.map((m, i) => (i === track ? !m : m)) });
  }
  setZoom(zoom: number) {
    this.view$.nextAssign({ zoom: clamp(zoom, 2, 800) });
  }

  // =============== editing ===============
  /** Split at sequence time t; returns the new segs and the index of the clip that starts at t. */
  private splitAt(segs: Seg[], t: number): { segs: Seg[]; index: number } {
    const T = segs.reduce((a, s) => a + dur(s), 0);
    if (t <= 1e-6) return { segs, index: 0 };
    if (t >= T - 1e-6) return { segs, index: segs.length };
    let acc = 0;
    let i = 0;
    for (; i < segs.length - 1; i++) {
      if (t < acc + dur(segs[i]) - 1e-6) break;
      acc += dur(segs[i]);
    }
    const sg = segs[i];
    const fps = this.fpsOf(sg.src);
    const local = snapF(sg.in + (t - acc), fps);
    if (local - sg.in < 0.5 / fps) return { segs, index: i };
    if (sg.out - local < 0.5 / fps) return { segs, index: i + 1 };
    const next = [...segs];
    next.splice(i, 1, { ...sg, id: uid(), out: local }, { ...plain(sg), id: uid(), in: local });
    return { segs: next, index: i + 1 };
  }
  /** Playhead time for audio edits: the start of the frame on screen. */
  private editTime() {
    return this.frameInfo()?.seqStart ?? this._t;
  }
  split() {
    const ac = this.selectedAudio();
    if (ac) {
      if (this._playing) this.pause();
      const t = this.editTime();
      const at = ac.in + (t - ac.start);
      if (at <= ac.in + 0.01 || at >= ac.out - 0.01) return void toast("Move the playhead inside the selected audio clip to split it");
      this.commit();
      const right = { ...ac, id: uid(), start: t, in: at };
      this.setEdit({ audio: this.edit.audio.flatMap((c) => (c.id === ac.id ? [{ ...c, out: at }, right] : [c])), sel: right.id });
      return;
    }
    if (!this.segs.length) return;
    if (this._playing) this.pause();
    const fi = this.frameInfo()!;
    const r = this.splitAt(this.segs, fi.seqStart);
    if (r.segs === this.segs) return void toast("Already a cut here");
    this.commit();
    this.setEdit({ segs: r.segs, sel: r.segs[r.index].id });
    this.seek(this.starts()[r.index]);
  }
  private targetIndex() {
    const { sel } = this.edit;
    if (sel) {
      const i = this.segs.findIndex((s) => s.id === sel);
      if (i >= 0) return i;
    }
    return this.segs.length ? this._cur : -1;
  }
  /** Move the selected clip to the Trash (restorable from the Trash tab, and undoable). */
  deleteSelected() {
    const ac = this.selectedAudio();
    if (ac) {
      this.commit();
      const item: TrashItem = { kind: "audio", clip: ac, deletedAt: Date.now() };
      this.setEdit({ audio: this.edit.audio.filter((c) => c.id !== ac.id), trash: [item, ...this.edit.trash], sel: null });
      toast(`Moved “${this.clipLabel(ac)}” to the Trash`);
      return;
    }
    const i = this.edit.sel ? this.segs.findIndex((s) => s.id === this.edit.sel) : -1;
    if (i < 0) return void toast("Select a clip first (click it on the timeline)");
    this.commit();
    const st = this.starts()[i];
    const item: TrashItem = { kind: "video", clip: this.segs[i], index: i, deletedAt: Date.now() };
    const segs = this.segs.filter((_, k) => k !== i);
    this.setEdit({ segs, trash: [item, ...this.edit.trash], sel: segs[i]?.id ?? segs[i - 1]?.id ?? null });
    this._t = st;
    this.afterEdit();
    toast(`Moved “${this.clipLabel(item.clip)}” to the Trash`);
  }
  /** Put a trashed clip back: where it was (`original`) or at the playhead. */
  restoreFromTrash(id: string, where: "original" | "playhead" = "original") {
    const item = this.edit.trash.find((i) => i.clip.id === id);
    if (!item) return;
    this.commit();
    if (this.src(item.clip.src)?.trashed) {
      this.untrash(item.clip.src);
      toast(`Also restored its media file “${this.src(item.clip.src)?.name}”`);
    }
    const state = this.putBack({ segs: this.segs, audio: this.edit.audio }, item, where);
    this.setEdit({ ...state, trash: this.edit.trash.filter((i) => i !== item), sel: item.clip.id });
    if (item.kind === "video") {
      const index = state.segs.findIndex((s) => s.id === item.clip.id);
      this._t = this.starts()[index];
    }
    this.afterEdit();
  }
  /** Insert a trashed clip into (copies of) the timeline lists. */
  private putBack(state: { segs: Seg[]; audio: AudioClip[] }, item: TrashItem, where: "original" | "playhead") {
    if (item.kind === "video") {
      let segs = state.segs;
      let index = Math.min(item.index, segs.length);
      if (where === "playhead" && segs.length) {
        const r = this.splitAt(segs, this.editTime());
        segs = r.segs;
        index = r.index;
      }
      segs = [...segs];
      segs.splice(index, 0, item.clip);
      return { ...state, segs };
    }
    const c = item.clip;
    const len = clipLen(c);
    const at = where === "playhead" ? this._t : c.start;
    const tracks = [c.track, ...Array.from({ length: AUDIO_TRACKS }, (_, i) => i)];
    let track = tracks.find((tr) => fits(state.audio, tr, at, len));
    let start = at;
    if (track == null) {
      track = c.track;
      start = Math.max(0, ...state.audio.filter((x) => x.track === track).map((x) => x.start + clipLen(x)));
      toast("Its old spot is taken — placed after the last clip on its track");
    }
    return { ...state, audio: [...state.audio, { ...c, track, start }] };
  }
  /** Permanently remove one trashed clip (the media file stays). */
  purgeFromTrash(id: string) {
    this.commit();
    this.setEdit({ trash: this.edit.trash.filter((i) => i.clip.id !== id) });
  }
  /** Clear the Trash: clips go, and trashed media files are deleted from disk. */
  async emptyTrash() {
    const files = this.sources$.getValue().filter((s) => s.trashed);
    if (!this.edit.trash.length && !files.length) return;
    this.setEdit({ trash: [] });
    await Promise.all(files.map((f) => this.deleteSourceForever(f.id)));
  }
  duplicate() {
    const ac = this.selectedAudio();
    if (ac) {
      const start = ac.start + clipLen(ac);
      const track = [ac.track, ...Array.from({ length: AUDIO_TRACKS }, (_, i) => i)].find((tr) =>
        fits(this.edit.audio, tr, start, clipLen(ac)),
      );
      if (track == null) return void toast("No free room right after this clip");
      this.commit();
      const copy = { ...ac, id: uid(), start, track };
      this.setEdit({ audio: [...this.edit.audio, copy], sel: copy.id });
      return;
    }
    const i = this.targetIndex();
    if (i < 0) return;
    this.commit();
    const copy = { ...plain(this.segs[i]), id: uid() };
    const segs = [...this.segs];
    segs.splice(i + 1, 0, copy);
    this.setEdit({ segs, sel: copy.id });
    this._t = this.starts()[i + 1];
    this.afterEdit();
  }
  private replaceSeg(i: number, patch: Partial<Seg>) {
    const segs = [...this.segs];
    segs[i] = { ...segs[i], ...patch };
    this.setEdit({ segs });
    return segs[i];
  }
  /** `[` / `]` on a selected audio clip: cut it at the playhead. */
  private trimAudio(ac: AudioClip, edge: "in" | "out") {
    if (this._playing) this.pause();
    const t = edge === "in" ? this.editTime() : (this.frameInfo()?.seqEnd ?? this._t);
    const at = ac.in + (t - ac.start);
    if (at <= ac.in + 0.01 || at >= ac.out - 0.01) return void toast("Move the playhead inside the selected audio clip");
    this.commit();
    this.replaceClip(ac.id, edge === "in" ? { start: t, in: at } : { out: at });
  }
  private replaceClip(id: string, patch: Partial<AudioClip>) {
    this.setEdit({ audio: this.edit.audio.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  }
  trimIn() {
    const ac = this.selectedAudio();
    if (ac) return this.trimAudio(ac, "in");
    if (this._playing) this.pause();
    const fi = this.frameInfo();
    if (!fi) return;
    const newIn = fi.f / fi.fps;
    if (newIn <= fi.sg.in + 1e-4) return void toast("Playhead is at the clip start");
    this.commit();
    this.replaceSeg(fi.i, { in: newIn });
    this.select(fi.sg.id);
    this._t = fi.st;
    this.afterEdit();
  }
  trimOut() {
    const ac = this.selectedAudio();
    if (ac) return this.trimAudio(ac, "out");
    if (this._playing) this.pause();
    const fi = this.frameInfo();
    if (!fi) return;
    const newOut = Math.min(this.src(fi.sg.src)!.duration, (fi.f + 1) / fi.fps);
    if (newOut >= fi.sg.out - 1e-4) return void toast("Playhead is on the clip’s last frame");
    this.commit();
    this.replaceSeg(fi.i, { out: newOut });
    this.select(fi.sg.id);
    this._t = fi.st + (newOut - fi.sg.in) - 0.5 / fi.fps;
    this.afterEdit();
  }
  markIn() {
    if (this._playing) this.pause();
    const fi = this.frameInfo();
    if (!fi) return;
    this.commit();
    const markOut = this.edit.markOut != null && this.edit.markOut <= fi.seqStart ? null : this.edit.markOut;
    this.setEdit({ markIn: fi.seqStart, markOut });
  }
  markOut() {
    if (this._playing) this.pause();
    const fi = this.frameInfo();
    if (!fi) return;
    this.commit();
    const markIn = this.edit.markIn != null && this.edit.markIn >= fi.seqEnd ? null : this.edit.markIn;
    this.setEdit({ markOut: fi.seqEnd, markIn });
  }
  clearMarks() {
    if (this.edit.markIn == null && this.edit.markOut == null) return;
    this.commit();
    this.setEdit({ markIn: null, markOut: null });
  }
  private needRange(): [number, number] | null {
    const { markIn, markOut } = this.edit;
    if (markIn == null && markOut == null) {
      toast("Set In (I) and/or Out (O) first");
      return null;
    }
    const a = markIn ?? 0;
    const b = markOut ?? this.total();
    if (b - a < 1e-3) {
      toast("Marked range is empty");
      return null;
    }
    return [a, b];
  }
  cutRange() {
    const r = this.needRange();
    if (!r) return;
    if (this._playing) this.pause();
    this.commit();
    let segs = this.splitAt(this.segs, r[1]).segs;
    const cut = this.splitAt(segs, r[0]);
    segs = cut.segs;
    let acc = 0;
    let end = segs.length;
    for (let k = 0; k < segs.length; k++) {
      if (acc >= r[1] - 1e-4) {
        end = k;
        break;
      }
      acc += dur(segs[k]);
    }
    segs = [...segs.slice(0, cut.index), ...segs.slice(end)];
    // same range comes out of the audio tracks; later audio slides left with the video
    const [a, b] = r;
    const audio = this.edit.audio.flatMap((c) => {
      const cs = c.start;
      const ce = cs + clipLen(c);
      if (ce <= a + 1e-6) return [c];
      if (cs >= b - 1e-6) return [{ ...c, start: cs - (b - a) }];
      const parts: AudioClip[] = [];
      if (cs < a) parts.push({ ...c, out: c.in + (a - cs) });
      if (ce > b) parts.push({ ...c, id: cs < a ? uid() : c.id, start: a, in: c.in + (b - cs) });
      return parts.filter((p) => clipLen(p) > 0.01);
    });
    this.setEdit({ segs, audio, markIn: null, markOut: null, sel: null });
    this._t = r[0];
    this.afterEdit();
    toast(`Cut ${fmt(r[1] - r[0])}`);
  }
  keepRange() {
    const r = this.needRange();
    if (!r) return;
    if (this._playing) this.pause();
    this.commit();
    const a = this.splitAt(this.segs, r[1]);
    let segs = a.segs.slice(0, a.index);
    const b = this.splitAt(segs, r[0]);
    segs = b.segs.slice(b.index);
    const audio = this.edit.audio.flatMap((c) => {
      const cs = c.start;
      const ce = cs + clipLen(c);
      if (ce <= r[0] + 1e-6 || cs >= r[1] - 1e-6) return [];
      const ns = Math.max(cs, r[0]);
      const ne = Math.min(ce, r[1]);
      return [{ ...c, start: ns - r[0], in: c.in + (ns - cs), out: c.in + (ne - cs) }];
    });
    this.setEdit({ segs, audio, markIn: null, markOut: null, sel: null });
    this._t = 0;
    this.afterEdit();
  }
  /** Put an audio file on the first track with room at `at`, or after the last clip on A1. */
  private placeAudio(s: Source, at: number) {
    const len = s.duration;
    const clips = this.edit.audio;
    let track = Array.from({ length: AUDIO_TRACKS }, (_, i) => i).find((tr) => fits(clips, tr, at, len));
    let start = at;
    if (track == null) {
      track = 0;
      start = Math.max(0, ...clips.filter((c) => c.track === 0).map((c) => c.start + clipLen(c)));
    }
    const clip: AudioClip = { id: uid(), src: s.id, track, start, in: 0, out: len, volume: 1 };
    this.setEdit({ audio: [...clips, clip], sel: clip.id });
    return clip;
  }
  appendSource(id: string) {
    const s = this.src(id);
    if (!s) return;
    this.commit();
    if (s.kind === "audio") {
      this.placeAudio(s, this._t);
      return;
    }
    this.setEdit({ segs: [...this.segs, { id: uid(), src: id, in: 0, out: s.duration }] });
    this.seek(this.starts()[this.segs.length - 1]);
  }
  moveSeg(from: number, to: number) {
    if (from === to) return;
    this.commit();
    const segs = [...this.segs];
    const [m] = segs.splice(from, 1);
    segs.splice(to, 0, m);
    this.setEdit({ segs, sel: m.id });
    this._t = this.starts()[to];
    this.afterEdit();
  }
  setClipVolume(id: string, volume: number) {
    this.replaceClip(id, { volume: clamp(volume, 0, 2) });
  }
  /** Drag an audio clip in time (seconds delta) and between tracks. */
  beginAudioMove(id: string) {
    if (this._playing) this.pause();
    const snap0 = this.snapshot();
    const orig = this.edit.audio.find((c) => c.id === id)!;
    this.select(id);
    return {
      move: (d: number, track: number) =>
        this.replaceClip(id, { start: Math.max(0, orig.start + d), track: clamp(track, 0, AUDIO_TRACKS - 1) }),
      end: () => this.endAudioDrag(id, orig, snap0),
    };
  }
  /** Drag an audio clip's edge (seconds delta). */
  beginAudioTrim(id: string, edge: "in" | "out") {
    if (this._playing) this.pause();
    const snap0 = this.snapshot();
    const orig = this.edit.audio.find((c) => c.id === id)!;
    const duration = this.src(orig.src)?.duration ?? orig.out;
    this.select(id);
    return {
      move: (d: number) => {
        if (edge === "out") return this.replaceClip(id, { out: clamp(orig.out + d, orig.in + 0.05, duration) });
        // the left edge moves the clip's start and its in-point together
        const newIn = clamp(orig.in + d, Math.max(0, orig.in - orig.start), orig.out - 0.05);
        this.replaceClip(id, { in: newIn, start: orig.start + (newIn - orig.in) });
      },
      end: () => this.endAudioDrag(id, orig, snap0),
    };
  }
  private endAudioDrag(id: string, orig: AudioClip, snap0: string) {
    const c = this.edit.audio.find((x) => x.id === id);
    if (!c) return;
    if (!fits(this.edit.audio, c.track, c.start, clipLen(c), id)) {
      this.replaceClip(id, orig);
      toast("Clips can't overlap on the same track");
      return;
    }
    if (c.start !== orig.start || c.track !== orig.track || c.in !== orig.in || c.out !== orig.out) this.commit(snap0);
  }

  /** Drag-trim a clip edge. Returns handlers for pointer move (delta in seconds) and release. */
  beginTrim(i: number, edge: "in" | "out") {
    if (this._playing) this.pause();
    const snap0 = this.snapshot();
    const orig = { ...this.segs[i] };
    const s = this.src(orig.src)!;
    const fps = s.fps;
    this.select(orig.id);
    return {
      move: (d: number) => {
        const sg =
          edge === "in"
            ? this.replaceSeg(i, { in: clamp(snapF(orig.in + d, fps), 0, orig.out - 1 / fps) })
            : this.replaceSeg(i, { out: clamp(snapF(orig.out + d, fps), orig.in + 1 / fps, s.duration) });
        this._cur = i;
        this._t = this.starts()[i] + (edge === "in" ? 0 : dur(sg) - 0.5 / fps);
        this.setActive(sg.src);
        this.video(sg.src).currentTime = edge === "in" ? sg.in : sg.out - 0.5 / fps;
        this.emitPlay();
      },
      end: () => {
        const sg = this.segs[i];
        if (sg.in !== orig.in || sg.out !== orig.out) this.commit(snap0);
        this.afterEdit();
      },
    };
  }

  // =============== export ===============
  /**
   * Save the frame under the playhead: downloads a PNG at the clip's native resolution and
   * stores it on the server so it shows up in the Frames view.
   */
  async exportFrame() {
    if (this._playing) this.pause();
    const fi = this.frameInfo();
    if (!fi) return void toast("Nothing to export — the timeline is empty");
    const src = this.src(fi.sg.src)!;
    if (src.status === "error") return void toast.error(`"${src.name}" failed to upload, so its frames can't be saved`);
    const v = this.video(fi.sg.src);
    await seeked(v);
    if (v.readyState < 2 || !v.videoWidth) {
      await Promise.race([
        new Promise((r) => v.addEventListener("loadeddata", r, { once: true })),
        new Promise((r) => setTimeout(r, 5000)),
      ]);
      if (v.readyState < 2 || !v.videoWidth) return void toast.error("The video hasn't loaded yet — try again in a moment");
    }
    this.compose(); // what is on screen, transitions included
    if (this.partner) await seeked(this.partner);
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    this.paint(c.getContext("2d")!, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
    if (!blob) return void toast.error("Could not encode the frame");
    this.download(blob, frameFileName(src.name, fi.f));

    const t = document.createElement("canvas");
    t.height = 180;
    t.width = Math.max(1, Math.round((180 * c.width) / c.height));
    t.getContext("2d")!.drawImage(c, 0, 0, t.width, t.height);
    const form = new FormData();
    form.append("image", blob, "frame.png");
    form.append(
      "meta",
      JSON.stringify({
        videoId: src.id,
        frameNumber: fi.f,
        time: fi.f / fi.fps,
        thumbnail: t.toDataURL("image/jpeg", 0.75),
      }),
    );
    try {
      const res = await fetch("/api/frames", { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
      const row = (await res.json()) as Frame;
      this.frames$.next([row, ...this.frames$.getValue()]);
      toast.success(`Saved frame ${fi.f} (${c.width}×${c.height})`, { description: "Downloaded, and added to the Frames tab" });
    } catch (e) {
      toast.error(`Frame downloaded, but not saved to Frames: ${(e as Error).message}`);
    }
  }
  async deleteFrame(id: string) {
    const prev = this.frames$.getValue();
    this.frames$.next(prev.filter((f) => f.id !== id));
    const res = await fetch(`/api/frames/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      this.frames$.next(prev);
      toast.error("Could not delete the frame");
    }
  }
  /** Move the playhead to a saved frame, if its clip is on the current timeline. */
  goToFrame(f: Frame) {
    const fps = f.videoId ? this.fpsOf(f.videoId) : 30;
    const st = this.starts();
    const i = this.segs.findIndex((s) => s.src === f.videoId && f.time >= s.in - 0.5 / fps && f.time < s.out);
    if (i < 0) {
      toast(f.videoId && this.src(f.videoId) ? "That part of the video isn't on this timeline" : "That video is no longer in the library");
      return false;
    }
    if (this._playing) this.pause();
    const sg = this.segs[i];
    this.seek(st[i] + clamp(f.time - sg.in, 0, sg.out - sg.in));
    return true;
  }
  private download(blob: Blob, name: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  async startExport(o: ExportOptions) {
    const { markIn, markOut } = this.edit;
    const [a, b] = o.range === "marks" ? [markIn ?? 0, markOut ?? this.total()] : [0, this.total()];
    if (b - a < 0.05) return void toast.error("Nothing to export");
    this.pause();
    const s0 = this.src(this.segs[this.locate(a)!.i].src)!;
    let H = o.height || s0.height;
    let W = Math.round((H * s0.width) / s0.height);
    W += W % 2;
    H += H % 2;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    const graph = this.ensureGraph();
    await graph.ctx.resume();
    const dest = graph.ctx.createMediaStreamDestination();
    graph.mix.connect(dest); // video sound + audio tracks, with clip volumes and track mutes
    const saved = { loop: this.view.loop, rate: this.view.rate };
    this.view$.nextAssign({ loop: false, rate: 1 });

    const stream = new MediaStream([
      ...canvas.captureStream(o.fps).getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);
    const rec = new MediaRecorder(stream, {
      mimeType: o.format.mime,
      videoBitsPerSecond: o.bitrate,
      audioBitsPerSecond: 192000,
    });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    this.job = { rec, ctx, W, H, start: a, end: b, done: false, aborted: false, chunks, dest, monitor: o.monitor, saved, ext: o.format.ext, t0: performance.now() };
    this.applyLevels(); // master follows the "monitor" option while rendering
    this.export$.next({ progress: 0, detail: "", status: `Rendering ${W}×${H} @ ${o.fps} fps…` });
    this.seek(a);
    await seeked(this.curV()!);
    this.compose();
    this.drawExport();
    rec.onstop = () => this.onExportStopped();
    rec.start(500);
    this.play();
  }
  private drawExport() {
    const E = this.job!;
    this.paint(E.ctx, E.W, E.H);
    const el = (performance.now() - E.t0) / 1000;
    this.export$.nextAssign({
      progress: clamp((this._t - E.start) / (E.end - E.start), 0, 1),
      detail: `${fmt(this._t - E.start)} of ${fmt(E.end - E.start)} · elapsed ${fmt(el)}${document.hidden ? " · TAB HIDDEN: export paused/stuttering" : ""}`,
    });
  }
  finishExport(aborted = false) {
    const E = this.job;
    if (!E || E.done) return;
    E.done = true;
    E.aborted = aborted;
    this.pause();
    if (E.rec.state !== "inactive") E.rec.stop();
    else this.onExportStopped();
  }
  private onExportStopped() {
    const E = this.job;
    if (!E) return;
    try {
      this.graph?.mix.disconnect(E.dest);
    } catch {}
    this.view$.nextAssign(E.saved);
    this.job = null;
    this.applyLevels();
    this.export$.next(null);
    if (E.aborted) return void toast("Export discarded");
    const blob = new Blob(E.chunks, { type: E.rec.mimeType || "video/webm" });
    this.download(blob, `cutroom-${stamp()}.${E.ext}`);
    toast.success(`Exported ${(blob.size / 1048576).toFixed(1)} MB`);
  }
}

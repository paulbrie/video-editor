"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSubject } from "subjecto/react";
import { CopyIcon, PencilIcon, Redo2Icon, RotateCcwIcon, ScissorsIcon, Trash2Icon, Undo2Icon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { fmt, niceStep, rulerLabel } from "@/lib/editor/format";
import { AUDIO_TRACKS } from "@/lib/editor/engine";
import { cn } from "@/lib/utils";
import { useEditor } from "./context";
import { RenameDialog, type RenameTarget } from "./rename-dialog";
import { TransitionHandle } from "./transition-handle";

const zoomFromSlider = (v: number) => 2 * Math.pow(400, v / 1000); // 2 … 800 px/s
const sliderFromZoom = (z: number) => Math.round((1000 * Math.log(z / 2)) / Math.log(400));

type Drag = { i: number; dx: number; target: number; dropX: number } | null;

// vertical layout of the lanes (px from the top of the scroll area)
const V_TOP = 30;
const V_H = 64;
const A_H = 40;
const A_GAP = 6;
const laneTop = (track: number) => V_TOP + V_H + 8 + track * (A_H + A_GAP);
const LANES_BOTTOM = laneTop(AUDIO_TRACKS);

export function Timeline() {
  const editor = useEditor();
  const [edit] = useSubject(editor.edit$);
  const [view] = useSubject(editor.view$);
  const [sources] = useSubject(editor.sources$);
  const [history] = useSubject(editor.history$);
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [viewportW, setViewportW] = useState(1000);
  const [drag, setDrag] = useState<Drag>(null);

  const z = view.zoom;
  const T = edit.segs.reduce((a, s) => a + s.out - s.in, 0);
  const starts: number[] = [];
  edit.segs.reduce((acc, s) => (starts.push(acc), acc + s.out - s.in), 0);
  const extent = edit.audio.reduce((m, c) => Math.max(m, c.start + c.out - c.in), T);
  const width = Math.max(extent * z + 400, viewportW);
  const selAudio = edit.audio.find((c) => c.id === edit.sel);
  const windows = editor.transitionWindows(); // re-rendered on every edit, so always current

  // ---- right-click menu & renaming ----
  const [menu, setMenu] = useState<{ id: string; kind: "video" | "audio"; t: number } | null>(null);
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);
  const menuClip = menu && (edit.segs.find((c) => c.id === menu.id) ?? edit.audio.find((c) => c.id === menu.id));
  const openRename = useCallback(
    (id: string) => {
      const clip = editor.segs.find((c) => c.id === id) ?? editor.edit.audio.find((c) => c.id === id);
      if (!clip) return;
      const fileName = editor.src(clip.src)?.name ?? "";
      setRenaming({
        title: "Rename clip",
        value: editor.clipLabel(clip),
        placeholder: fileName,
        hint: `Only this clip changes. Leave it empty to use the file's name (“${fileName}”).`,
        allowEmpty: true,
        // keeping the file's name means "no custom name", so it follows later file renames
        onSave: (v) => editor.renameClip(id, v.trim() === fileName ? "" : v),
      });
    },
    [editor, setRenaming],
  );
  useEffect(() => {
    const onRename = () => {
      const sel = editor.edit.sel;
      if (sel) openRename(sel);
      else toast("Select a clip to rename it");
    };
    window.addEventListener("cutroom:rename", onRename);
    return () => window.removeEventListener("cutroom:rename", onRename);
  }, [editor, openRename]);
  const onContextMenu = (e: React.MouseEvent) => {
    if (!innerRef.current?.contains(e.target as Node)) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-seg],[data-aclip]");
    const id = el?.dataset.aclip ?? (el ? editor.segs[Number(el.dataset.seg)]?.id : undefined);
    if (!el || !id) {
      e.preventDefault(); // no menu on empty space (Radix skips opening when prevented)
      return;
    }
    const t = Math.max(0, (e.clientX - innerRef.current!.getBoundingClientRect().left) / editor.view.zoom);
    editor.select(id);
    setMenu({ id, kind: el.dataset.aclip ? "audio" : "video", t });
  };
  const srcById = new Map(sources.map((s) => [s.id, s]));

  // ---- viewport width ----
  useEffect(() => {
    const sc = scrollRef.current!;
    const ro = new ResizeObserver(() => setViewportW(sc.clientWidth));
    ro.observe(sc);
    return () => ro.disconnect();
  }, []);

  // ---- fit ----
  const fit = useCallback(() => {
    const total = editor.extent();
    if (!total) return;
    editor.setZoom((scrollRef.current!.clientWidth - 40) / total);
    requestAnimationFrame(() => scrollRef.current && (scrollRef.current.scrollLeft = 0));
  }, [editor]);
  useEffect(() => {
    window.addEventListener("cutroom:fit", fit);
    return () => window.removeEventListener("cutroom:fit", fit);
  }, [fit]);
  const hadSegs = useRef(false);
  useEffect(() => {
    // fit when the timeline goes from empty to non-empty (first load, first files, project switch)
    const has = edit.segs.length + edit.audio.length > 0;
    if (has && !hadSegs.current) fit();
    hadSegs.current = has;
  }, [edit.segs.length, edit.audio.length, fit]);

  // ---- keep the playhead where it was on screen when zooming ----
  const prevZoom = useRef(z);
  useLayoutEffect(() => {
    const sc = scrollRef.current!;
    const t = editor.play$.getValue().t;
    if (prevZoom.current !== z) {
      const off = t * prevZoom.current - sc.scrollLeft;
      sc.scrollLeft = t * z - off;
      prevZoom.current = z;
    }
  }, [z, editor]);

  // ---- playhead: updated straight on the DOM, every frame ----
  useEffect(() => {
    const h = editor.play$.subscribe(({ t, playing }) => {
      const zoom = editor.view.zoom;
      const x = t * zoom;
      if (playheadRef.current) playheadRef.current.style.transform = `translateX(${x}px)`;
      const sc = scrollRef.current;
      if (playing && sc && (x > sc.scrollLeft + sc.clientWidth - 40 || x < sc.scrollLeft)) sc.scrollLeft = x - 60;
    });
    return () => h.unsubscribe();
  }, [editor]);
  useLayoutEffect(() => {
    if (playheadRef.current) playheadRef.current.style.transform = `translateX(${editor.play$.getValue().t * z}px)`;
  });

  // ---- pointer interactions ----
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || editor.export$.getValue()) return;
    // React bubbles events from portals (popovers) through the component tree; only handle the timeline's own DOM
    if (!innerRef.current?.contains(e.target as Node)) return;
    const inner = innerRef.current!;
    const timeAt = (ev: { clientX: number }) => Math.max(0, (ev.clientX - inner.getBoundingClientRect().left) / editor.view.zoom);
    const target = e.target as HTMLElement;
    const segEl = target.closest<HTMLElement>("[data-seg]");
    const clipEl = target.closest<HTMLElement>("[data-aclip]");
    try {
      inner.setPointerCapture(e.pointerId);
    } catch {
      // synthetic events have no active pointer; dragging still works while over the timeline
    }
    let onMove: (ev: PointerEvent) => void;
    let onUp: (ev: PointerEvent) => void;
    const trackAt = (ev: { clientY: number }) => {
      const y = ev.clientY - inner.getBoundingClientRect().top;
      return Math.max(0, Math.min(AUDIO_TRACKS - 1, Math.floor((y - laneTop(0) + A_GAP / 2) / (A_H + A_GAP))));
    };

    if (clipEl && target.dataset.edge) {
      // trim an audio clip by its edge
      const x0 = e.clientX;
      const trim = editor.beginAudioTrim(clipEl.dataset.aclip!, target.dataset.edge as "in" | "out");
      onMove = (ev) => trim.move((ev.clientX - x0) / editor.view.zoom);
      onUp = () => trim.end();
    } else if (clipEl) {
      // click = select + seek, drag = move in time and between audio tracks
      const id = clipEl.dataset.aclip!;
      const x0 = e.clientX;
      const y0 = e.clientY;
      let mover: ReturnType<typeof editor.beginAudioMove> | null = null;
      editor.select(id);
      onMove = (ev) => {
        if (!mover && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 4) mover = editor.beginAudioMove(id);
        mover?.move((ev.clientX - x0) / editor.view.zoom, trackAt(ev));
      };
      onUp = (ev) => {
        if (mover) mover.end();
        else editor.seek(timeAt(ev));
      };
    } else if (segEl && target.dataset.edge) {
      // trim by dragging an edge
      const i = Number(segEl.dataset.seg);
      const x0 = e.clientX;
      const trim = editor.beginTrim(i, target.dataset.edge as "in" | "out");
      onMove = (ev) => trim.move((ev.clientX - x0) / editor.view.zoom);
      onUp = () => trim.end();
    } else if (segEl) {
      // click = select + seek, drag = reorder
      const i = Number(segEl.dataset.seg);
      const x0 = e.clientX;
      const segs = editor.segs;
      const st = editor.starts();
      const others = segs.map((_, k) => k).filter((k) => k !== i);
      let dragging = false;
      let dropTarget = i;
      onMove = (ev) => {
        const dx = ev.clientX - x0;
        if (!dragging && Math.abs(dx) > 6) dragging = true;
        if (!dragging) return;
        const t = timeAt(ev);
        dropTarget = others.filter((k) => st[k] + (segs[k].out - segs[k].in) / 2 < t).length;
        const k = others[dropTarget - 1];
        const dropX = dropTarget === 0 ? 0 : (st[k] + segs[k].out - segs[k].in) * editor.view.zoom;
        setDrag({ i, dx, target: dropTarget, dropX });
      };
      onUp = (ev) => {
        setDrag(null);
        editor.select(segs[i].id);
        if (dragging) editor.moveSeg(i, dropTarget);
        else editor.seek(timeAt(ev));
      };
    } else {
      // scrub on ruler / empty space
      if (!target.closest("[data-ruler]")) editor.select(null);
      editor.seek(timeAt(e));
      onMove = (ev) => editor.seek(timeAt(ev));
      onUp = () => {};
    }
    const up = (ev: PointerEvent) => {
      inner.removeEventListener("pointermove", onMove);
      inner.removeEventListener("pointerup", up);
      inner.removeEventListener("pointercancel", up);
      onUp(ev);
    };
    inner.addEventListener("pointermove", onMove);
    inner.addEventListener("pointerup", up);
    inner.addEventListener("pointercancel", up);
  };

  useEffect(() => {
    const sc = scrollRef.current!;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      editor.setZoom(editor.view.zoom * Math.exp(-e.deltaY * 0.01));
    };
    sc.addEventListener("wheel", wheel, { passive: false });
    return () => sc.removeEventListener("wheel", wheel);
  }, [editor]);

  // ---- ruler ----
  const step = niceStep(90 / z);
  const ticks: number[] = [];
  for (let x = 0; x <= width / z; x += step) ticks.push(x);

  const has = edit.segs.length > 0;
  const marks = edit.markIn != null || edit.markOut != null;

  return (
    <section className="flex min-h-0 flex-col border-t bg-card">
      <div className="flex items-center gap-1.5 overflow-x-auto border-b px-2.5 py-1.5 whitespace-nowrap [&_button]:h-7 [&_button]:text-xs">
        <Tool disabled={!has} onClick={() => editor.split()} k="S">Split</Tool>
        <Tool disabled={!has} onClick={() => editor.trimIn()} k="[">Trim start</Tool>
        <Tool disabled={!has} onClick={() => editor.trimOut()} k="]">Trim end</Tool>
        <Tool disabled={!edit.sel} onClick={() => editor.deleteSelected()} k="⌫">Delete clip</Tool>
        <Tool disabled={!has} onClick={() => editor.duplicate()} k="D">Duplicate</Tool>
        <Separator orientation="vertical" className="mx-1 !h-5" />
        <Tool disabled={!has} onClick={() => editor.markIn()} k="I">In</Tool>
        <Tool disabled={!has} onClick={() => editor.markOut()} k="O">Out</Tool>
        <Tool disabled={!marks} onClick={() => editor.cutRange()} k="C">Cut range</Tool>
        <Tool disabled={!marks} onClick={() => editor.keepRange()} k="K">Keep range</Tool>
        <Tool disabled={!marks} onClick={() => editor.clearMarks()} k="X">Clear</Tool>
        <Separator orientation="vertical" className="mx-1 !h-5" />
        <Button variant="outline" size="sm" disabled={!history.undo} onClick={() => editor.undo()} title="Undo (⌘Z)">
          <Undo2Icon /> Undo
        </Button>
        <Button variant="outline" size="sm" disabled={!history.redo} onClick={() => editor.redo()} title="Redo (⇧⌘Z)">
          <Redo2Icon /> Redo
        </Button>
        {selAudio && (
          <>
            <Separator orientation="vertical" className="mx-1 !h-5" />
            <span className="text-muted-foreground">Clip volume</span>
            <Slider
              className="w-[110px]"
              min={0}
              max={200}
              value={[Math.round(selAudio.volume * 100)]}
              onPointerDown={() => editor.commit()}
              onValueChange={([v]) => editor.setClipVolume(selAudio.id, v / 100)}
              aria-label="Selected audio clip volume"
            />
            <span className="w-9 text-muted-foreground tabular-nums">{Math.round(selAudio.volume * 100)}%</span>
          </>
        )}
        <span className="flex-1" />
        <span className="text-muted-foreground">Zoom</span>
        <Slider
          className="w-[120px]"
          min={0}
          max={1000}
          value={[sliderFromZoom(z)]}
          onValueChange={([v]) => editor.setZoom(zoomFromSlider(v))}
          aria-label="Timeline zoom"
        />
        <Button variant="outline" size="sm" onClick={fit} title="Fit timeline (Z)">Fit</Button>
        <span className="ml-1.5 text-muted-foreground tabular-nums">
          {edit.segs.length} clip{edit.segs.length === 1 ? "" : "s"} · {fmt(T)}
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
      <TrackHeaders />
      <div ref={scrollRef} className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
        <ContextMenu onOpenChange={(open) => !open && setMenu(null)}>
        <ContextMenuTrigger asChild>
        <div
          ref={innerRef}
          className="relative h-full min-w-full cursor-text"
          style={{ width }}
          onPointerDown={onPointerDown}
          onContextMenu={onContextMenu}
        >
          {/* ruler */}
          <div
            data-ruler
            className="tl-ruler absolute inset-x-0 top-0 h-6 cursor-ew-resize border-b"
            style={{ backgroundSize: `${(step * z) / 5}px 7px` }}
          >
            {ticks.map((x) => (
              <div key={x} className="absolute top-0 h-6 border-l border-[#4a4c53]" style={{ left: x * z }}>
                <span className="absolute top-[3px] left-1 text-[10px] whitespace-nowrap text-muted-foreground tabular-nums">
                  {rulerLabel(Math.round(x * 10) / 10, step)}
                </span>
              </div>
            ))}
          </div>

          {/* lane backgrounds */}
          <div className="pointer-events-none absolute inset-x-0 bg-white/[0.02]" style={{ top: V_TOP, height: V_H }} />
          {Array.from({ length: AUDIO_TRACKS }, (_, tr) => (
            <div key={tr} className="pointer-events-none absolute inset-x-0 bg-white/[0.02]" style={{ top: laneTop(tr), height: A_H }} />
          ))}

          {/* video clips */}
          <div className="absolute inset-x-0" style={{ top: V_TOP, height: V_H }}>
            {!has && (
              <div className="pointer-events-none absolute top-5 left-3.5 text-muted-foreground">
                Timeline is empty. Add videos (and audio for the tracks below) — they appear here in order.
              </div>
            )}
            {edit.segs.map((sg, i) => {
              const s = srcById.get(sg.src);
              const d = sg.out - sg.in;
              return (
                <div
                  key={sg.id}
                  data-seg={i}
                  data-sel={sg.id === edit.sel}
                  data-dragging={drag?.i === i}
                  className="tl-seg"
                  style={
                    {
                      left: starts[i] * z,
                      width: Math.max(3, d * z),
                      "--c": s?.color ?? "#888",
                      backgroundImage: s?.thumbnail ? `url(${s.thumbnail})` : undefined,
                      transform: drag?.i === i ? `translateX(${drag.dx}px)` : undefined,
                    } as React.CSSProperties
                  }
                >
                  <div data-edge="in" className="tl-handle left-0" />
                  <div className="pointer-events-none absolute inset-x-2.5 top-1.5 truncate text-[11px] font-semibold [text-shadow:0_1px_2px_#000]">
                    {sg.name ?? s?.name ?? "missing"}
                    <small className="block font-normal text-[#ccc] tabular-nums">
                      {fmt(d)} · {fmt(sg.in)}–{fmt(sg.out)}
                    </small>
                  </div>
                  <div data-edge="out" className="tl-handle right-0" />
                </div>
              );
            })}
          </div>

          {/* transitions: shaded bands where they run, and a handle on every cut and at both ends */}
          {windows.map((w) => (
            <div
              key={`band-${w.kind}-${w.i}`}
              className="pointer-events-none absolute z-[3] rounded-sm"
              style={{
                left: w.start * z,
                width: Math.max(2, w.d * z),
                top: V_TOP,
                height: V_H,
                background:
                  w.kind === "dissolve"
                    ? "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.35), rgba(255,255,255,0))"
                    : w.kind === "dip"
                      ? "linear-gradient(90deg, rgba(0,0,0,0), rgba(0,0,0,.85), rgba(0,0,0,0))"
                      : w.kind === "fadein"
                        ? "linear-gradient(90deg, rgba(0,0,0,.85), rgba(0,0,0,0))"
                        : "linear-gradient(90deg, rgba(0,0,0,0), rgba(0,0,0,.85))",
                outline: "1px dashed rgba(245,185,61,.6)",
              }}
            />
          ))}
          {edit.segs.map((sg, i) => {
            return (
              <TransitionHandle
                key={`tr-${sg.id}`}
                kind={i === 0 ? "fadein" : "cut"}
                segId={sg.id}
                value={sg.transition ?? null}
                window={windows.find((w) => w.i === i && w.kind !== "fadeout")}
                x={starts[i] * z + (i === 0 ? 10 : 0)}
                top={V_TOP}
                height={V_H}
              />
            );
          })}
          {has && (
            <TransitionHandle
              kind="fadeout"
              segId={edit.segs[edit.segs.length - 1].id}
              value={edit.fadeOut ? { type: "dip", duration: edit.fadeOut } : null}
              window={windows.find((w) => w.kind === "fadeout")}
              x={T * z - 10}
              top={V_TOP}
              height={V_H}
            />
          )}

          {/* audio clips */}
          {edit.audio.map((c) => {
            const s = srcById.get(c.src);
            const len = c.out - c.in;
            return (
              <div
                key={c.id}
                data-aclip={c.id}
                data-sel={c.id === edit.sel}
                className={cn("tl-seg tl-aclip", edit.audioMuted[c.track] && "opacity-45")}
                style={
                  {
                    left: c.start * z,
                    top: laneTop(c.track),
                    height: A_H,
                    width: Math.max(3, len * z),
                    "--c": s?.color ?? "#888",
                    backgroundColor: `color-mix(in oklab, ${s?.color ?? "#888"} 30%, #0b0c0e)`,
                    backgroundImage: s?.thumbnail ? `url(${s.thumbnail})` : undefined,
                    backgroundSize: s ? `${s.duration * z}px 100%` : undefined,
                    backgroundPosition: `${-c.in * z}px 0`,
                    backgroundRepeat: "no-repeat",
                  } as React.CSSProperties
                }
              >
                <div data-edge="in" className="tl-handle left-0" />
                <div className="pointer-events-none absolute inset-x-2.5 top-0.5 truncate text-[10px] font-semibold [text-shadow:0_1px_2px_#000]">
                  {c.name ?? s?.name ?? "missing"}
                  {c.volume !== 1 && <span className="ml-1.5 font-normal text-[#ddd]">{Math.round(c.volume * 100)}%</span>}
                </div>
                <div data-edge="out" className="tl-handle right-0" />
              </div>
            );
          })}

          {/* past the end of the video: not played or exported */}
          {extent > T + 1e-3 && (
            <div
              className="pointer-events-none absolute z-[3] bg-[repeating-linear-gradient(135deg,rgba(0,0,0,.45)_0_6px,rgba(0,0,0,.25)_6px_12px)]"
              style={{ left: T * z, width: (extent - T) * z, top: V_TOP, height: LANES_BOTTOM - V_TOP }}
              title="Past the end of the video: not played or exported"
            />
          )}

          {/* marked range */}
          {marks && (
            <div
              className="pointer-events-none absolute inset-y-0"
              style={
                edit.markIn != null && edit.markOut != null
                  ? { left: edit.markIn * z, width: (edit.markOut - edit.markIn) * z, background: "var(--mark)", borderLeft: "2px solid var(--primary)", borderRight: "2px solid var(--primary)" }
                  : edit.markIn != null
                    ? { left: edit.markIn * z, borderLeft: "2px solid var(--primary)" }
                    : { left: edit.markOut! * z - 2, borderRight: "2px solid var(--primary)" }
              }
            />
          )}

          {/* reorder drop indicator */}
          {drag && (
            <div className="pointer-events-none absolute z-[6] -ml-px w-[3px] rounded-sm bg-primary" style={{ left: drag.dropX, top: V_TOP - 4, height: V_H + 8 }} />
          )}

          <div ref={playheadRef} className="tl-playhead pointer-events-none absolute inset-y-0 left-0 z-[8] w-px bg-[#ff4d4d]" />
        </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          {menu && menuClip && (
            <>
              <ContextMenuLabel className="truncate text-xs text-muted-foreground">
                {menu.kind === "audio" ? "Audio clip" : "Video clip"} · {editor.clipLabel(menuClip)}
              </ContextMenuLabel>
              <ContextMenuItem onSelect={() => openRename(menu.id)}>
                <PencilIcon /> Rename…<ContextMenuShortcut>F2</ContextMenuShortcut>
              </ContextMenuItem>
              {menuClip.name && (
                <ContextMenuItem onSelect={() => editor.renameClip(menu.id, "")}>
                  <RotateCcwIcon /> Use file name
                </ContextMenuItem>
              )}
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={() => {
                  editor.select(menu.id);
                  editor.seek(menu.t);
                  editor.split();
                }}
              >
                <ScissorsIcon /> Split here
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => {
                  editor.select(menu.id);
                  editor.duplicate();
                }}
              >
                <CopyIcon /> Duplicate<ContextMenuShortcut>D</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onSelect={() => {
                  editor.select(menu.id);
                  editor.deleteSelected();
                }}
              >
                <Trash2Icon /> Move to Trash<ContextMenuShortcut>⌫</ContextMenuShortcut>
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
        </ContextMenu>
      </div>
      </div>
      <RenameDialog target={renaming} onClose={() => setRenaming(null)} />
    </section>
  );
}

function Tool({ k, children, ...props }: React.ComponentProps<typeof Button> & { k: string }) {
  return (
    <Button variant="outline" size="sm" title={`${children} (${k})`} {...props}>
      {children} <Kbd className="hidden h-4 min-w-4 text-[10px] min-[1800px]:inline-flex">{k}</Kbd>
    </Button>
  );
}

/** Fixed column on the left: track names and their mute toggles. */
function TrackHeaders() {
  const editor = useEditor();
  const [edit] = useSubject(editor.edit$);
  const rows = [
    { label: "V1", title: "Video clips' own sound", top: V_TOP, h: V_H, muted: edit.videoMuted, toggle: () => editor.toggleTrackMute("video") },
    ...Array.from({ length: AUDIO_TRACKS }, (_, tr) => ({
      label: `A${tr + 1}`,
      title: `Audio track ${tr + 1}`,
      top: laneTop(tr),
      h: A_H,
      muted: edit.audioMuted[tr],
      toggle: () => editor.toggleTrackMute(tr),
    })),
  ];
  return (
    <div className="relative w-[58px] shrink-0 border-r">
      {rows.map((r) => (
        <div key={r.label} className="absolute inset-x-0 flex items-center justify-between px-1.5" style={{ top: r.top, height: r.h }}>
          <span className="text-[11px] font-semibold text-muted-foreground">{r.label}</span>
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn(r.muted && "text-destructive")}
            onClick={r.toggle}
            title={`${r.muted ? "Unmute" : "Mute"}: ${r.title}`}
            aria-pressed={r.muted}
          >
            {r.muted ? <VolumeXIcon /> : <Volume2Icon />}
          </Button>
        </div>
      ))}
    </div>
  );
}

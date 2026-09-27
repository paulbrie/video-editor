"use client";

import { useEffect, useRef, useState } from "react";
import { useSubject } from "subjecto/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { exportFormats } from "@/lib/editor/engine";
import { useEditor } from "./context";

const FPS = [24, 25, 30, 50, 60];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-3">
      <Label className="font-normal text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

export function ExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const editor = useEditor();
  const [job] = useSubject(editor.export$);
  const running = !!job;

  // close the dialog once a render finishes (the download has started)
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !job) onOpenChange(false);
    wasRunning.current = !!job;
  }, [job, onOpenChange]);

  return (
    <Dialog open={open || running} onOpenChange={(v) => !running && onOpenChange(v)}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={!running}
        onInteractOutside={(e) => running && e.preventDefault()}
        onEscapeKeyDown={(e) => running && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Export video</DialogTitle>
          <DialogDescription>
            The browser renders the edit in real time, so a 2-minute cut takes about 2 minutes. Keep this tab
            visible while it runs.
          </DialogDescription>
        </DialogHeader>
        {job ? (
          <div className="grid gap-3">
            <div>{job.status}</div>
            <Progress value={job.progress * 100} />
            <div className="text-xs text-muted-foreground">{job.detail}</div>
            <DialogFooter>
              <Button variant="destructive" onClick={() => editor.finishExport(true)}>
                Stop and discard
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <ExportForm onCancel={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Mounted each time the dialog opens, so its defaults reflect the current timeline. */
function ExportForm({ onCancel }: { onCancel: () => void }) {
  const editor = useEditor();
  const [edit] = useSubject(editor.edit$);
  const hasMarks = edit.markIn != null || edit.markOut != null;
  const [formats] = useState(exportFormats);
  const [range, setRange] = useState<"all" | "marks">(hasMarks ? "marks" : "all");
  const [format, setFormat] = useState(0);
  const [height, setHeight] = useState("0");
  const [fps, setFps] = useState(() => {
    const f0 = (edit.segs[0] && editor.src(edit.segs[0].src)?.fps) || 30;
    return String(FPS.reduce((a, b) => (Math.abs(b - f0) < Math.abs(a - f0) ? b : a)));
  });
  const [bitrate, setBitrate] = useState("10000000");
  const [monitor, setMonitor] = useState(false);

  const start = async () => {
    if (!formats.length) return toast.error("This browser cannot record video (MediaRecorder missing). Use Chrome.");
    try {
      await editor.startExport({
        range,
        format: formats[format],
        height: Number(height),
        fps: Number(fps),
        bitrate: Number(bitrate),
        monitor,
      });
    } catch (e) {
      toast.error("Export failed: " + (e as Error).message);
      editor.finishExport(true);
    }
  };

  return (
    <div className="grid gap-3">
      <Row label="Range">
        <Select value={range} onValueChange={(v) => setRange(v as "all" | "marks")}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Whole timeline</SelectItem>
            <SelectItem value="marks" disabled={!hasMarks}>Marked range (In → Out)</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      <Row label="Format">
        <Select value={String(format)} onValueChange={(v) => setFormat(Number(v))}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Not supported" /></SelectTrigger>
          <SelectContent>
            {formats.map((f, i) => (
              <SelectItem key={f.mime} value={String(i)}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <Row label="Resolution">
        <Select value={height} onValueChange={setHeight}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Source (first clip)</SelectItem>
            {["2160", "1080", "720", "480"].map((h) => (
              <SelectItem key={h} value={h}>{h}p</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <Row label="Frame rate">
        <Select value={fps} onValueChange={setFps}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {FPS.map((f) => (
              <SelectItem key={f} value={String(f)}>{f}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <Row label="Quality">
        <Select value={bitrate} onValueChange={setBitrate}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="20000000">Very high (20 Mbps)</SelectItem>
            <SelectItem value="10000000">High (10 Mbps)</SelectItem>
            <SelectItem value="5000000">Medium (5 Mbps)</SelectItem>
            <SelectItem value="2500000">Small (2.5 Mbps)</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      <Row label="Monitor">
        <Label className="font-normal">
          <Checkbox checked={monitor} onCheckedChange={(v) => setMonitor(v === true)} />
          Hear audio while exporting
        </Label>
      </Row>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={start} disabled={!formats.length}>Start export</Button>
      </DialogFooter>
    </div>
  );
}

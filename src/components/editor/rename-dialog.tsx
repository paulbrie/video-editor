"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export type RenameTarget = {
  title: string;
  value: string;
  /** Shown when the field is empty (e.g. the name it falls back to). */
  placeholder?: string;
  hint?: string;
  /** Allow saving an empty name (clips fall back to their file's name). */
  allowEmpty?: boolean;
  onSave: (value: string) => void;
};

export function RenameDialog({ target, onClose }: { target: RenameTarget | null; onClose: () => void }) {
  return (
    <Dialog open={!!target} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">{target && <RenameForm target={target} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

/** Mounted per open, so the field starts from the current name. */
function RenameForm({ target, onClose }: { target: RenameTarget; onClose: () => void }) {
  const [value, setValue] = useState(target.value);
  const canSave = target.allowEmpty || value.trim().length > 0;
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSave) return;
        target.onSave(value);
        onClose();
      }}
    >
      <DialogHeader>
        <DialogTitle>{target.title}</DialogTitle>
        {target.hint && <DialogDescription>{target.hint}</DialogDescription>}
      </DialogHeader>
      <Input
        autoFocus
        value={value}
        placeholder={target.placeholder}
        maxLength={200}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        aria-label="Name"
      />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSave}>
          Rename
        </Button>
      </DialogFooter>
    </form>
  );
}

import { lazy } from "solid-js";
import { withPromiseModalHost } from "../../../components/promise-modal-host.ts";
import { t } from "../../../lib/reactive/i18n.ts";
import { showToast } from "../../../lib/toast.ts";
import { uploadsEnabled } from "../../../lib/uploads.ts";
import type { ChatAttachmentControlsProps } from "./chat-attachment-controls.types.ts";
import { attachChatSketch } from "./chat-sketch.ts";

const SketchDialog = lazy(() => import("./chat-sketch-dialog.tsx"), { export: "SketchDialog" });

export async function openChatSketch(
  readControls: () => ChatAttachmentControlsProps,
): Promise<void> {
  const initial = readControls();
  const signal = initial.readSignal ?? initial.attachmentReads?.readSignal;
  if (initial.disabled || !uploadsEnabled(initial.uploadConfig) || signal?.aborted) {
    return;
  }
  try {
    await SketchDialog.preload();
    const ready = readControls();
    if (
      ready.disabled ||
      !uploadsEnabled(ready.uploadConfig) ||
      signal?.aborted ||
      signal !== (ready.readSignal ?? ready.attachmentReads?.readSignal)
    ) {
      return;
    }
    const result = await withPromiseModalHost<string | null>({ signal, value: null }, (modal) =>
      modal.render(() => <SketchDialog onFinish={modal.finish} />),
    );
    const current = readControls();
    if (
      result &&
      !signal?.aborted &&
      signal === (current.readSignal ?? current.attachmentReads?.readSignal)
    ) {
      attachChatSketch(result, current);
    }
  } catch {
    if (!signal?.aborted) {
      showToast({ message: t("chat.composer.sketchFailed"), severity: "error" });
    }
  }
}

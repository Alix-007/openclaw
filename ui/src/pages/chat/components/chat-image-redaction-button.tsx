import type { ChatAttachment } from "../../../lib/chat/chat-types.ts";
import { t } from "../../../lib/reactive/i18n.ts";
import { showToast } from "../../../lib/toast.ts";
import { getChatAttachmentBlob } from "../attachment-payload-store.ts";
import type { ChatAttachmentControlsProps } from "./chat-attachment-controls.types.ts";
import { showImageRedaction } from "./chat-image-redaction-dialog.tsx";
import { replaceRedactedAttachment } from "./chat-image-redaction.ts";

export function ImageRedactionButton(props: {
  attachment: ChatAttachment;
  controls: ChatAttachmentControlsProps;
}) {
  let editing = false;
  const redact = async () => {
    if (editing || props.controls.disabled) {
      return;
    }
    const original = props.attachment;
    const signal = props.controls.readSignal ?? props.controls.attachmentReads?.readSignal;
    const blob = getChatAttachmentBlob(original);
    if (!blob) {
      return;
    }
    editing = true;
    try {
      const result = await showImageRedaction(blob, signal);
      if (
        result &&
        !signal?.aborted &&
        signal === (props.controls.readSignal ?? props.controls.attachmentReads?.readSignal)
      ) {
        replaceRedactedAttachment(original, result, props.controls);
      }
    } catch {
      if (!signal?.aborted) {
        showToast({ message: t("chat.attachments.redactionFailed"), severity: "error" });
      }
    } finally {
      editing = false;
    }
  };
  return (
    <button
      type="button"
      class="chat-attachment-redact"
      disabled={props.controls.disabled}
      aria-label={t("chat.attachments.redactImage")}
      title={t("chat.attachments.redactImage")}
      onClick={() => void redact()}
    >
      {t("chat.attachments.redactImage")}
    </button>
  );
}

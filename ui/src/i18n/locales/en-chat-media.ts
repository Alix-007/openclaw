import type { TranslationMap } from "../lib/types.ts";
import { en } from "./en.ts";

const enChatMedia = {
  chat: {
    imageLightbox: {
      compare: "Compare images",
      compareTitle: "Compare image: {title}",
      compareHint:
        "Compare same-size images as rendered by this browser. Magenta marks changed pixels after browser color and transparency normalization. Your reference stays local; this is not a source-file equality test.",
      compareChoose: "Choose reference image",
      compareOriginal: "Chat image",
      compareReference: "Local reference",
      compareDifference: "Pixel difference",
      compareDownload: "Download difference PNG",
      compareCount: "{count} of {total} pixels differ ({percent}%)",
      compareDimensions: "Images must have the same pixel dimensions. Choose another reference.",
      compareTooLarge: "Choose images with at most 16 million pixels for comparison.",
      compareFailed:
        "Could not compare these images. Choose a valid PNG, JPEG, or WebP image and try again.",
      loadingDetail: "Loading sharper image…",
      detailFailed: "Preview shown. Sharper image could not load.",
      actions: "Image actions",
      previous: "Previous image",
      next: "Next image",
      position: "{current} / {total}",
      label: "Image preview: {title}",
      open: "Open image {title}",
      openOriginal: "Open in new tab",
      copy: "Copy image",
      download: "Download image",
      copyFailed: "Could not copy this image. Check clipboard access and try again.",
      downloadFailed: "Could not download this image. Try again.",
      loadFailed: "Could not load this image. Try again.",
      zoomIn: "Zoom in",
      zoomOut: "Zoom out",
      resetZoom: "Reset zoom",
      close: "Close image preview",
      untitled: "Image",
    },
    mediaPlayer: {
      play: "Play",
      pause: "Pause",
      seek: "Seek media",
      mute: "Mute",
      unmute: "Unmute",
      volume: "Volume",
      download: "Download {filename}",
      preparing: "Preparing playback…",
      openVideo: "Expand {filename} in the media overlay",
      videoPreview: "Video preview: {title}",
      closeVideoPreview: "Close video preview",
    },
  },
} satisfies TranslationMap;

export const registerChatMediaEnglish = Object.assign(
  () => {
    Object.assign(en.chat.imageLightbox, enChatMedia.chat.imageLightbox);
    Object.assign(en.chat.mediaPlayer, enChatMedia.chat.mediaPlayer);
  },
  { catalog: enChatMedia },
);

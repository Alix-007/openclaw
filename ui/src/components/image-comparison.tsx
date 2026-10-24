import { lazy } from "solid-js";
import { withPromiseModalHost } from "./promise-modal-host.ts";

const ImageComparison = lazy(() => import("./image-comparison-dialog.tsx"), {
  export: "ImageComparison",
});

/** A user action captures its authorized source; both image surfaces share the same dialog. */
export async function showImageComparison(
  readOriginalBlob: () => Promise<Blob>,
  title: string,
  signal: AbortSignal,
): Promise<void> {
  await ImageComparison.preload();
  await withPromiseModalHost<void>({ signal, value: undefined }, (modal) =>
    modal.render(() => (
      <ImageComparison
        readOriginalBlob={readOriginalBlob}
        title={title}
        onClose={() => modal.finish()}
      />
    )),
  );
}

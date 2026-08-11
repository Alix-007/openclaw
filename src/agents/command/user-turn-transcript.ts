import { createUserTurnTranscriptRecorder } from "../../sessions/user-turn-transcript.js";
import type { UserTurnTranscriptTarget } from "../../sessions/user-turn-transcript.types.js";
import { runAgentHarnessBeforeMessageWriteHook } from "../harness/hook-helpers.js";
import type { AgentCommandOpts } from "./types.js";

export function prepareAgentCommandUserTurnTranscript(params: {
  opts: AgentCommandOpts;
  target: UserTurnTranscriptTarget;
  transcriptBody: string;
  useProvidedRecorder: boolean;
}) {
  const transcriptMedia = params.opts.transcriptMedia ?? [];
  const hasTranscriptMedia = transcriptMedia.length > 0;
  const suppressUserTurnPersistence =
    params.opts.suppressPromptPersistence === true ||
    (params.opts.transcriptMessage === "" && !hasTranscriptMedia);
  const recorderTranscriptText = params.transcriptBody || undefined;
  const userTurnTranscriptRecorder =
    (params.useProvidedRecorder ? params.opts.userTurnTranscriptRecorder : undefined) ??
    createUserTurnTranscriptRecorder({
      ...(!suppressUserTurnPersistence && (recorderTranscriptText || hasTranscriptMedia)
        ? {
            input: {
              text: recorderTranscriptText,
              ...(hasTranscriptMedia ? { media: transcriptMedia } : {}),
              senderIsOwner: params.opts.senderIsOwner,
              ...(params.opts.inputProvenance ? { provenance: params.opts.inputProvenance } : {}),
            },
          }
        : {}),
      target: params.target,
      beforeMessageWrite: runAgentHarnessBeforeMessageWriteHook,
      errorContext: "agent command user turn transcript",
    });
  if (suppressUserTurnPersistence) {
    userTurnTranscriptRecorder.markBlocked();
  }
  return { suppressUserTurnPersistence, userTurnTranscriptRecorder };
}

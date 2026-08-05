import type { ChatType } from "../../channels/chat-type.js";
import { resolveStorePath } from "../../config/sessions/paths.js";
import type { SessionTranscriptRuntimeTarget } from "../../config/sessions/session-accessor.types.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import {
  hasCompletedBootstrapTurn,
  makeBootstrapWarn,
  resolveBootstrapContextForRun,
  resolveContextInjectionMode,
  type BootstrapContextMode,
} from "../bootstrap-files.js";
import {
  isHeartbeatLifecycleRunKind,
  type BootstrapContextRunKind,
  type BootstrapMode,
} from "../bootstrap-mode.js";
import { isPrimaryBootstrapRun, resolveWorkspaceBootstrapRouting } from "../bootstrap-routing.js";
import type { EmbeddedContextFile } from "../embedded-agent-helpers.js";
import { resolveAttemptBootstrapContext } from "../embedded-agent-runner/run/attempt.context-engine-helpers.js";
import type { EmbeddedRunTrigger } from "../embedded-agent-runner/run/params.js";
import { isWorkspaceBootstrapPending, type WorkspaceBootstrapFile } from "../workspace.js";

type CliBootstrapContextDeps = {
  hasCompletedBootstrapTurn: typeof hasCompletedBootstrapTurn;
  isWorkspaceBootstrapPending: typeof isWorkspaceBootstrapPending;
  makeBootstrapWarn: typeof makeBootstrapWarn;
  resolveBootstrapContextForRun: typeof resolveBootstrapContextForRun;
};

type PreparedCliBootstrapContext = {
  bootstrapFiles: WorkspaceBootstrapFile[];
  contextFiles: EmbeddedContextFile[];
  bootstrapMode: BootstrapMode;
  includeBootstrapInSystemContext: boolean;
  sessionTarget: SessionTranscriptRuntimeTarget;
  shouldRecordCompletedBootstrapTurn: boolean;
};

/** Applies the shared bootstrap injection policy to a CLI-backed run. */
export async function prepareCliBootstrapContext(params: {
  bootstrapContextMode?: BootstrapContextMode;
  bootstrapContextRunKind?: BootstrapContextRunKind;
  canTransportSystemPrompt: boolean;
  chatType?: ChatType;
  config?: OpenClawConfig;
  deps: CliBootstrapContextDeps;
  hasBootstrapFileAccess: boolean;
  isCanonicalWorkspace: boolean;
  isSideQuestion: boolean;
  resolvedWorkspace: string;
  sessionAgentId: string;
  sessionId: string;
  sessionKey?: string;
  sessionTarget?: SessionTranscriptRuntimeTarget;
  storePath?: string;
  trigger?: EmbeddedRunTrigger;
  warn: (message: string) => void;
  workspaceDir: string;
}): Promise<PreparedCliBootstrapContext> {
  const sessionTarget =
    params.sessionTarget ??
    ({
      agentId: params.sessionAgentId,
      sessionId: params.sessionId,
      sessionKey: params.sessionKey?.trim() || params.sessionId,
      storePath:
        params.storePath ??
        resolveStorePath(params.config?.session?.store, {
          agentId: params.sessionAgentId,
        }),
    } as const);
  const contextInjectionMode = resolveContextInjectionMode(params.config, params.sessionAgentId);
  let completedBootstrapTurn: boolean | undefined;
  const hasCompletedBootstrapTurnForRun = async () => {
    completedBootstrapTurn ??= await params.deps.hasCompletedBootstrapTurn(sessionTarget);
    return completedBootstrapTurn;
  };
  let resolvedBootstrapContext:
    | Awaited<ReturnType<typeof params.deps.resolveBootstrapContextForRun>>
    | undefined;
  const resolveBootstrapContext = async () =>
    (resolvedBootstrapContext ??= await params.deps.resolveBootstrapContextForRun({
      workspaceDir: params.workspaceDir,
      config: params.config,
      sessionKey: params.sessionKey,
      sessionId: params.sessionId,
      chatType: params.chatType,
      agentId: params.sessionAgentId,
      contextMode: params.bootstrapContextMode,
      runKind: params.bootstrapContextRunKind,
      warn: params.deps.makeBootstrapWarn({
        sessionLabel: params.sessionKey ?? params.sessionId,
        workspaceDir: params.workspaceDir,
        warn: params.warn,
      }),
    }));
  const canRouteBootstrap = params.canTransportSystemPrompt && !params.isSideQuestion;
  const shouldProbeContinuationSkip =
    canRouteBootstrap &&
    contextInjectionMode === "continuation-skip" &&
    !isHeartbeatLifecycleRunKind(params.bootstrapContextRunKind) &&
    (await hasCompletedBootstrapTurnForRun());
  if (!params.isSideQuestion && !shouldProbeContinuationSkip && contextInjectionMode !== "never") {
    await resolveBootstrapContext();
  }
  const bootstrapRouting = !canRouteBootstrap
    ? undefined
    : await resolveWorkspaceBootstrapRouting({
        isWorkspaceBootstrapPending: params.deps.isWorkspaceBootstrapPending,
        bootstrapFiles: resolvedBootstrapContext?.bootstrapFiles,
        bootstrapFilesProvideAccess: false,
        bootstrapContextRunKind: params.bootstrapContextRunKind,
        trigger: params.trigger,
        sessionKey: params.sessionKey,
        isPrimaryRun: isPrimaryBootstrapRun(params.sessionKey),
        isCanonicalWorkspace: params.isCanonicalWorkspace,
        effectiveWorkspace: params.workspaceDir,
        resolvedWorkspace: params.resolvedWorkspace,
        hasBootstrapFileAccess: params.hasBootstrapFileAccess,
      });
  const bootstrapMode = bootstrapRouting?.bootstrapMode ?? "none";
  const bootstrapContext = params.isSideQuestion
    ? {
        bootstrapFiles: [],
        contextFiles: [],
        shouldRecordCompletedBootstrapTurn: false,
      }
    : await resolveAttemptBootstrapContext({
        contextInjectionMode,
        bootstrapContextMode: params.bootstrapContextMode,
        bootstrapContextRunKind: params.bootstrapContextRunKind ?? "default",
        bootstrapMode,
        isPrimaryInteractiveRun: bootstrapRouting?.isPrimaryInteractiveRun ?? false,
        hasCompletedBootstrapTurn: hasCompletedBootstrapTurnForRun,
        resolveBootstrapContextForRun: resolveBootstrapContext,
      });

  return {
    bootstrapFiles: bootstrapContext.bootstrapFiles,
    contextFiles: bootstrapContext.contextFiles,
    bootstrapMode,
    includeBootstrapInSystemContext: bootstrapRouting?.includeBootstrapInSystemContext ?? true,
    sessionTarget,
    shouldRecordCompletedBootstrapTurn:
      bootstrapRouting !== undefined && bootstrapContext.shouldRecordCompletedBootstrapTurn,
  };
}

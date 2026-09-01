type SlackDraftConversation = {
  accountId?: string;
  teamId?: string;
  channelId: string;
  threadTs?: string;
};

type ActiveSlackReply = {
  messageTs?: string;
  latestHumanMessageTs?: string;
  onInterveningMessage: () => void;
};

export type SlackMessageBoundaryTracker = {
  setMessageTs: (messageTs: string) => void;
  stop: () => void;
};

const activeRepliesByConversation = new Map<string, Set<ActiveSlackReply>>();

function conversationKey(conversation: SlackDraftConversation): string {
  return [
    conversation.accountId ?? "default",
    conversation.teamId ?? "",
    conversation.channelId,
    conversation.threadTs ?? "",
  ].join(":");
}

function isLaterSlackMessage(candidate: string, current: string): boolean {
  const candidateTimestamp = Number(candidate);
  const currentTimestamp = Number(current);
  return (
    Number.isFinite(candidateTimestamp) &&
    Number.isFinite(currentTimestamp) &&
    candidateTimestamp > currentTimestamp
  );
}

/** Keeps an in-flight reply attached to its actual place in the Slack conversation. */
export function trackSlackConversationMessage(
  conversation: SlackDraftConversation & ActiveSlackReply,
): SlackMessageBoundaryTracker {
  const key = conversationKey(conversation);
  const activeReply: ActiveSlackReply = {
    messageTs: conversation.messageTs,
    onInterveningMessage: conversation.onInterveningMessage,
  };
  const replies = activeRepliesByConversation.get(key) ?? new Set<ActiveSlackReply>();
  replies.add(activeReply);
  activeRepliesByConversation.set(key, replies);

  const stop = () => {
    const currentReplies = activeRepliesByConversation.get(key);
    currentReplies?.delete(activeReply);
    if (currentReplies?.size === 0) {
      activeRepliesByConversation.delete(key);
    }
  };

  return {
    setMessageTs: (messageTs) => {
      activeReply.messageTs = messageTs;
      if (
        activeReply.latestHumanMessageTs &&
        isLaterSlackMessage(activeReply.latestHumanMessageTs, messageTs)
      ) {
        activeReply.onInterveningMessage();
      }
    },
    stop,
  };
}

/** A later human message means subsequent assistant output belongs below it. */
export function noteSlackConversationMessage(
  conversation: SlackDraftConversation & {
    messageTs?: string;
    userId?: string;
    botUserId?: string;
    botId?: string;
    subtype?: string;
  },
): void {
  if (
    !conversation.messageTs ||
    !conversation.userId ||
    conversation.userId === conversation.botUserId ||
    conversation.botId ||
    conversation.subtype === "bot_message"
  ) {
    return;
  }

  const replies = activeRepliesByConversation.get(conversationKey(conversation));
  if (!replies) {
    return;
  }

  for (const reply of replies) {
    if (!reply.messageTs) {
      if (
        !reply.latestHumanMessageTs ||
        isLaterSlackMessage(conversation.messageTs, reply.latestHumanMessageTs)
      ) {
        // Slack can deliver the next message before chat.postMessage returns its timestamp.
        reply.latestHumanMessageTs = conversation.messageTs;
      }
      continue;
    }
    if (isLaterSlackMessage(conversation.messageTs, reply.messageTs)) {
      reply.onInterveningMessage();
    }
  }
}

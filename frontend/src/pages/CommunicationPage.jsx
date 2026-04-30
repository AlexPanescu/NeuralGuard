import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import apiClient, { API_URL } from "../api/client";
import useMediaQuery from "../hooks/useMediaQuery";
import { useCrisisMode } from "../context/CrisisModeContext";
import { getRealtimeSocket } from "../lib/realtimeSocket";
import { useLanguage } from "../i18n/LanguageContext";
import {
  QUEUED_CRISIS_MESSAGES_CHANGED_EVENT,
  addQueuedCrisisMessage,
  clearSentQueuedMessages,
  getQueuedCrisisMessages,
  markQueuedMessageFailed,
  markQueuedMessageSending,
  markQueuedMessageSent,
  removeQueuedCrisisMessage,
} from "../utils/crisisMode";
import "../styles/pages/CommunicationPage.css";

function getChatUserId() {
  try {
    const currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");
    const id = currentUser?.id || currentUser?._id;
    if (id) return String(id);
  } catch {
    // ignore
  }
  let guestId = localStorage.getItem("userId");
  if (!guestId) {
    guestId = `guest_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem("userId", guestId);
  }
  return guestId;
}

function getChatAvatar() {
  try {
    const currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");
    const avatar = currentUser?.profilePicture || currentUser?.avatar || currentUser?.photo || "";
    return typeof avatar === "string" ? avatar : "";
  } catch {
    return "";
  }
}

function getSocketSafeAvatar(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed.slice(0, 2000);
  return "";
}

function getChatDisplayName() {
  try {
    const currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");
    const raw =
      currentUser?.name
      || currentUser?.username
      || currentUser?.fullName
      || currentUser?.email
      || "";
    const name = String(raw).trim();
    if (name) return name.slice(0, 40);
  } catch {
    // ignore
  }
  return "Anonymous";
}

function getChatProfile() {
  return {
    userId: getChatUserId(),
    name: getChatDisplayName(),
    avatar: getChatAvatar(),
  };
}

function dmChannelId(peerUserId) {
  const a = String(getChatUserId());
  const b = String(peerUserId);
  return `dm:${[a, b].sort().join(":")}`;
}

function normalizeMessage(message, locale) {
  return {
    ...message,
    channelId: message.channelId || "global",
    avatar: String(message.author || "?").slice(0, 2).toUpperCase(),
    avatarUrl: typeof message.authorAvatar === "string" ? message.authorAvatar : "",
    time: new Date(message.timestamp).toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
    }),
    reactedBy: Array.isArray(message.reactedBy) ? message.reactedBy : [],
    reactedByCount: message.reactedBy?.length ?? 0,
    replyTo: message.replyTo || null,
  };
}

function renderMessageText(text) {
  if (!text) return null;
  const parts = String(text).split(/(@[\w._-]{2,40})/g);
  return parts.map((part, index) =>
    part.startsWith("@") ? (
      <span key={`${index}-${part}`} className="chat-mention">
        {part}
      </span>
    ) : (
      <span key={`${index}-text`}>{part}</span>
    ),
  );
}

const buildQuickMessages = (t) => [
  t("communication.quick.messages.safe"),
  t("communication.quick.messages.help"),
  t("communication.quick.messages.teamArea"),
  t("communication.quick.messages.taskDone"),
  t("communication.quick.messages.confirm"),
];

function formatQueuedMessageTime(value, locale, fallback = "") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  }).format(date);
}

const CommunicationPage = () => {
  const { t, locale } = useLanguage();
  const { isOffline } = useCrisisMode();
  const [socket] = useState(() => getRealtimeSocket());
  const [isSocketConnected, setIsSocketConnected] = useState(() => getRealtimeSocket().connected);
  const [hasConnectedOnce, setHasConnectedOnce] = useState(() => getRealtimeSocket().connected);
  const [queuedNotice, setQueuedNotice] = useState("");
  const [queuedMessages, setQueuedMessages] = useState(() => getQueuedCrisisMessages());
  const [messages, setMessages] = useState([]);
  const [currentInput, setCurrentInput] = useState("");
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [chatProfile, setChatProfile] = useState(() => getChatProfile());
  const [channelId, setChannelId] = useState("global");
  const [dmPeer, setDmPeer] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [mobilePanel, setMobilePanel] = useState("chat");
  const isMobileLayout = useMediaQuery("(max-width: 767px)");
  const messagesEndRef = useRef(null);
  const channelIdRef = useRef(channelId);
  const chatProfileRef = useRef(chatProfile);

  const refreshQueuedMessages = useCallback(() => {
    setQueuedMessages(getQueuedCrisisMessages());
  }, []);

  useEffect(() => {
    channelIdRef.current = channelId;
  }, [channelId, locale]);

  useEffect(() => {
    chatProfileRef.current = chatProfile;
  }, [chatProfile]);

  useEffect(() => {
    const handleQueueChanged = () => refreshQueuedMessages();
    window.addEventListener("storage", handleQueueChanged);
    window.addEventListener(QUEUED_CRISIS_MESSAGES_CHANGED_EVENT, handleQueueChanged);
    return () => {
      window.removeEventListener("storage", handleQueueChanged);
      window.removeEventListener(QUEUED_CRISIS_MESSAGES_CHANGED_EVENT, handleQueueChanged);
    };
  }, [refreshQueuedMessages]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    let cancelled = false;
    const loadMessages = async () => {
      if (!channelId) {
        if (!cancelled) setMessages([]);
        return;
      }
      try {
        const response = await fetch(`${API_URL}/api/chat/messages?channel=${encodeURIComponent(channelId)}`);
        const data = await response.json();
        if (!cancelled) {
          setMessages(Array.isArray(data) ? data.map((message) => normalizeMessage(message, locale)) : []);
        }
      } catch {
        if (!cancelled) setMessages([]);
      }
    };

    loadMessages();
    return () => {
      cancelled = true;
    };
  }, [channelId, locale]);

  useEffect(() => {
    let cancelled = false;
    const syncProfileFromStorage = () => {
      if (!cancelled) setChatProfile(getChatProfile());
    };

    const refreshProfileFromApi = async () => {
      try {
        const response = await apiClient.get("/api/me");
        const user = response?.data?.user;
        if (!user || cancelled) return;
        const current = JSON.parse(localStorage.getItem("currentUser") || "null") || {};
        localStorage.setItem("currentUser", JSON.stringify({ ...current, ...user }));
        setChatProfile(getChatProfile());
      } catch {
        // ignore when not authenticated
      }
    };

    syncProfileFromStorage();
    refreshProfileFromApi();

    window.addEventListener("storage", syncProfileFromStorage);
    window.addEventListener("loginSuccess", syncProfileFromStorage);
    window.addEventListener("profilePictureUpdated", syncProfileFromStorage);

    return () => {
      cancelled = true;
      window.removeEventListener("storage", syncProfileFromStorage);
      window.removeEventListener("loginSuccess", syncProfileFromStorage);
      window.removeEventListener("profilePictureUpdated", syncProfileFromStorage);
    };
  }, []);

  useEffect(() => {
    const nextSocket = getRealtimeSocket();

    const handleConnect = () => {
      setIsSocketConnected(true);
      setHasConnectedOnce(true);
      nextSocket.emit("join", {
        name: chatProfileRef.current.name,
        userId: chatProfileRef.current.userId,
        avatar: getSocketSafeAvatar(chatProfileRef.current.avatar),
      });
      if (channelIdRef.current) {
        nextSocket.emit("joinChatChannel", { channelId: channelIdRef.current });
      }
    };

    const handleDisconnect = () => {
      setIsSocketConnected(false);
    };

    nextSocket.on("connect", handleConnect);
    nextSocket.on("disconnect", handleDisconnect);
    if (nextSocket.connected) {
      handleConnect();
    }

    return () => {
      nextSocket.off("connect", handleConnect);
      nextSocket.off("disconnect", handleDisconnect);
    };
  }, []);

  useEffect(() => {
    if (!socket || !isSocketConnected) return;
    if (channelId) {
      socket.emit("joinChatChannel", { channelId });
    }
  }, [socket, channelId, isSocketConnected]);

  useEffect(() => {
    if (!socket || !isSocketConnected) return;
    socket.emit("profileUpdate", {
      name: chatProfile.name,
      avatar: getSocketSafeAvatar(chatProfile.avatar),
    });
  }, [socket, chatProfile, isSocketConnected]);

  useEffect(() => {
    if (!socket) return;

    const handleOnlineUsers = (users) => {
      if (!Array.isArray(users)) {
        setOnlineUsers([]);
        return;
      }
      const dedup = new Map();
      for (const user of users) {
        const key = String(user?.userId || "");
        if (!key) continue;
        if (!dedup.has(key)) dedup.set(key, user);
      }
      setOnlineUsers(Array.from(dedup.values()));
    };
    const handleMessage = (message) => {
      const nextChannelId = message.channelId || "global";
      if (nextChannelId !== channelIdRef.current) return;
      setMessages((current) => [...current, normalizeMessage(message, locale)]);
    };
    const handleReact = (data) => {
      setMessages((current) =>
        current.map((message) =>
          String(message.id) === String(data.messageId)
            ? {
                ...message,
                reactedByCount: data.reactedByCount,
                reactedBy: Array.isArray(data.reactedBy) ? data.reactedBy : message.reactedBy,
              }
            : message,
        ),
      );
    };

    socket.on("onlineUsers", handleOnlineUsers);
    socket.on("message", handleMessage);
    socket.on("react", handleReact);

    return () => {
      socket.off("onlineUsers", handleOnlineUsers);
      socket.off("message", handleMessage);
      socket.off("react", handleReact);
    };
  }, [socket, locale]);

  const sendMessage = useCallback(
    (quickText, options = {}) => {
      const text = String(quickText || currentInput || "").trim();
      const shouldQueue = Boolean(quickText) || options.queueWhenOffline;
      if (!text) return;
      if (!channelId) return;

      const cannotSendLive = isOffline || !socket || !isSocketConnected;
      if (cannotSendLive) {
        if (!shouldQueue) return;
        const payload = {
          text,
          channelId,
          replyTo: replyTo
            ? {
                id: replyTo.id,
                author: replyTo.author,
                text: String(replyTo.text || "").slice(0, 160),
              }
            : undefined,
        };
        addQueuedCrisisMessage({
          text,
          channel: channelId,
          payload,
          author: chatProfileRef.current.name,
          authorId: chatProfileRef.current.userId,
          reason: isOffline ? "offline" : "socket_unavailable",
        });
        refreshQueuedMessages();
        setQueuedNotice(t("communication.quick.queuedNotice"));
        if (!quickText) setCurrentInput("");
        setReplyTo(null);
        return;
      }

      socket.emit("message", {
        text,
        channelId,
        replyTo: replyTo
          ? {
              id: replyTo.id,
              author: replyTo.author,
              text: String(replyTo.text || "").slice(0, 160),
            }
          : undefined,
      });
      setCurrentInput("");
      setReplyTo(null);
      setQueuedNotice("");
    },
    [channelId, currentInput, isOffline, isSocketConnected, refreshQueuedMessages, replyTo, socket, t],
  );

  const retryQueuedMessage = useCallback(
    (message) => {
      if (!message || message.status === "sending") return;
      if (isOffline) return;
      if (!socket || !isSocketConnected) return;

      try {
        markQueuedMessageSending(message.id);
        refreshQueuedMessages();
        socket.emit("message", message.payload || { text: message.text, channelId: message.channel || "global" });
        markQueuedMessageSent(message.id);
        refreshQueuedMessages();
        setQueuedNotice(t("communication.queued.sentLocal"));
      } catch (error) {
        markQueuedMessageFailed(message.id, error?.message || "Socket emit failed.");
        refreshQueuedMessages();
        setQueuedNotice(t("communication.queued.retryFailed"));
      }
    },
    [isOffline, isSocketConnected, refreshQueuedMessages, socket, t],
  );

  const removeQueuedMessage = useCallback(
    (id) => {
      removeQueuedCrisisMessage(id);
      refreshQueuedMessages();
    },
    [refreshQueuedMessages],
  );

  const clearSentMessages = useCallback(() => {
    clearSentQueuedMessages();
    refreshQueuedMessages();
  }, [refreshQueuedMessages]);

  const reactToMessage = useCallback(
    (messageId) => {
      socket?.emit("react", { messageId });
    },
    [socket],
  );

  const openDm = (peer) => {
    const myId = chatProfile.userId;
    if (String(peer.userId) === String(myId)) return;
    setChannelId(dmChannelId(peer.userId));
    setDmPeer({ name: peer.name, userId: peer.userId, avatar: peer.avatar || "" });
    setReplyTo(null);
    if (isMobileLayout) {
      setMobilePanel("chat");
    }
  };

  const openGlobal = () => {
    setChannelId("global");
    setDmPeer(null);
    setReplyTo(null);
  };

  const myId = chatProfile.userId;
  const othersOnline = onlineUsers.filter((user) => String(user.userId) !== String(myId));
  const quickMessages = useMemo(() => buildQuickMessages(t), [t]);
  const channelHeading = dmPeer ? t("communication.chat.dmHeading", { name: dmPeer.name }) : t("communication.chat.globalHeading");
  const channelSubline = dmPeer
    ? t("communication.chat.dmSubline")
    : t("communication.chat.globalSubline");
  const connectionState = isSocketConnected
    ? "online"
    : hasConnectedOnce
      ? "reconnecting"
      : "connecting";
  const connectionLabel = isSocketConnected
    ? t("communication.connection.connected")
    : hasConnectedOnce
      ? t("communication.connection.reconnecting")
      : t("communication.connection.connecting");
  const queuedCount = queuedMessages.filter((message) => ["queued", "sending", "failed"].includes(message.status)).length;
  const hasSentQueuedMessages = queuedMessages.some((message) => message.status === "sent");
  const retryDisabledReason = isOffline
    ? t("communication.queued.needsConnection")
    : !isSocketConnected
      ? t("communication.queued.socketUnavailable")
      : "";
  const resolveMessageAvatar = (message) => {
    if (typeof message.avatarUrl === "string" && message.avatarUrl.trim()) return message.avatarUrl;
    if (String(message.authorId || "") === String(chatProfile.userId || "")) {
      return chatProfile.avatar || "";
    }
    const onlineMatch = onlineUsers.find((user) => String(user.userId || "") === String(message.authorId || ""));
    return typeof onlineMatch?.avatar === "string" ? onlineMatch.avatar : "";
  };

  return (
    <section className="page-shell communication-page mobile-shell">
      <header className="comm-header mobile-card mobile-section-head">
        <div>
          <h1>{t("communication.title")}</h1>
          <p>{t("communication.description")}</p>
        </div>
        <div className="header-actions">
          <span className="online-count">{chatProfile.name}</span>
          <span className={`online-count connection-pill ${connectionState}`} aria-live="polite">
            {connectionLabel}
          </span>
          {queuedCount > 0 ? <span className="online-count queued-pill">{t("communication.header.queued", { count: queuedCount })}</span> : null}
          <span className="online-count">{t("communication.header.users", { count: onlineUsers.length })}</span>
        </div>
      </header>

      {isMobileLayout ? (
        <div className="comm-mobile-tabs mobile-segmented-tabs" role="tablist" aria-label={t("communication.panelsAria")}>
          <button
            type="button"
            role="tab"
            aria-selected={mobilePanel === "chat"}
            className={`comm-mobile-tab mobile-segmented-tab ${mobilePanel === "chat" ? "is-active" : ""}`}
            onClick={() => setMobilePanel("chat")}
          >
            {t("communication.tabs.chat")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobilePanel === "channels"}
            className={`comm-mobile-tab mobile-segmented-tab ${mobilePanel === "channels" ? "is-active" : ""}`}
            onClick={() => setMobilePanel("channels")}
          >
            {t("communication.tabs.channels")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobilePanel === "quick"}
            className={`comm-mobile-tab mobile-segmented-tab ${mobilePanel === "quick" ? "is-active" : ""}`}
            onClick={() => setMobilePanel("quick")}
          >
            {t("communication.tabs.quick")}
          </button>
        </div>
      ) : null}

      <div className={`comm-grid ${isMobileLayout ? "is-mobile" : ""}`}>
        <div className={`comm-card devices-card ${isMobileLayout && mobilePanel !== "channels" ? "is-hidden-mobile" : ""}`} data-tutorial="communication-channels">
          <div className="card-header">
            <h2>{t("communication.channels.title")}</h2>
          </div>
          <p className="online-hint">{t("communication.channels.hint")}</p>
          <div className="online-dm-list">
            <button
              type="button"
              className={`dm-user-row global ${channelId === "global" ? "active" : ""}`}
              onClick={openGlobal}
            >
              <span>{t("communication.channels.global")}</span>
            </button>
            {othersOnline.map((user) => (
              <div key={`${user.userId}-${user.name}`} className="dm-user-row">
                <span className="dm-user-name" title={user.name}>
                  {user.name}
                </span>
                <button
                  type="button"
                  className="dm-open-btn"
                  onClick={() => openDm(user)}
                  disabled={!isSocketConnected}
                >
                  PM
                </button>
              </div>
            ))}
            {!othersOnline.length && (
              <p className="online-empty">{t("communication.channels.empty")}</p>
            )}
          </div>

        </div>

        <div className={`comm-card chat-card ${isMobileLayout && mobilePanel !== "chat" ? "is-hidden-mobile" : ""}`} data-tutorial="communication-chat">
          <div className="card-header chat-channel-head">
            <div>
              <h2>{channelHeading}</h2>
              <p className="channel-sub">{channelSubline}</p>
            </div>
            {dmPeer && (
              <button type="button" className="back-global-btn" onClick={openGlobal}>
                {t("communication.chat.backGlobal")}
              </button>
            )}
          </div>

          {replyTo && (
            <div className="reply-banner">
              <span>
                {t("communication.chat.replyTo", { author: replyTo.author })} {String(replyTo.text).slice(0, 80)}
              </span>
              <button type="button" className="reply-cancel" onClick={() => setReplyTo(null)} aria-label={t("communication.chat.cancelReply")}>
                X
              </button>
            </div>
          )}

          <div className="chat-list">
            {messages.map((message) => {
              const isOwnMessage =
                String(message.authorId || message.userId || "") === String(myId)
                || String(message.author || "").trim().toLowerCase() === String(chatProfile.name || "").trim().toLowerCase();
              return (
              <div key={message.id} className={`chat-item ${isOwnMessage ? "is-own" : "is-peer"}`}>
                <div className="chat-avatar">
                  {resolveMessageAvatar(message) ? <img src={resolveMessageAvatar(message)} alt="" /> : message.avatar}
                </div>
                <div className="chat-content">
                  {message.replyTo && (
                    <div className="chat-reply-ref">
                      <span className="reply-arrow">↩</span>
                      <span>
                        {message.replyTo.author}: {message.replyTo.text}
                      </span>
                    </div>
                  )}
                  <div className="chat-meta">
                    <span className="chat-author">{message.author}</span>
                    <span className="chat-time">{message.time}</span>
                  </div>
                  <p className="chat-text">{renderMessageText(message.text)}</p>
                  <div className="chat-actions-row">
                    <div className="chat-reactions">
                      {message.reactedByCount > 0 && (
                        <span className="reaction">{t("communication.chat.reactions", { count: message.reactedByCount })}</span>
                      )}
                      <button
                        type="button"
                        onClick={() => reactToMessage(message.id)}
                        className={`react-btn ${
                          Array.isArray(message.reactedBy)
                          && message.reactedBy.includes(String(myId))
                            ? "active"
                            : ""
                        }`}
                        disabled={!isSocketConnected}
                      >
                        {t("communication.chat.react")}
                      </button>
                    </div>
                    <button
                      type="button"
                      className="reply-msg-btn"
                      onClick={() =>
                        setReplyTo({
                          id: message.id,
                          author: message.author,
                          text: message.text,
                        })
                      }
                      disabled={!isSocketConnected}
                    >
                      {t("communication.chat.reply")}
                    </button>
                  </div>
                </div>
              </div>
            );
            })}
            {messages.length === 0 && (
              <div className="no-messages">
                {dmPeer
                  ? t("communication.chat.emptyDm")
                  : t("communication.chat.emptyGlobal")}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className={`chat-input ${isMobileLayout ? "mobile-sticky-bar" : ""}`} data-tutorial="communication-input">
            <input
              type="text"
              placeholder={
                isSocketConnected || hasConnectedOnce
                  ? dmPeer
                    ? t("communication.chat.placeholderDm", { name: dmPeer.name })
                    : t("communication.chat.placeholderGlobal")
                  : t("communication.chat.connecting")
              }
              value={currentInput}
              onChange={(event) => setCurrentInput(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && sendMessage()}
              disabled={!isSocketConnected}
            />
            <button type="button" onClick={() => sendMessage()} disabled={!isSocketConnected || !currentInput.trim()}>
              {t("common.actions.send")}
            </button>
          </div>
        </div>

        <div className={`comm-card quick-card ${isMobileLayout && mobilePanel !== "quick" ? "is-hidden-mobile" : ""}`} data-tutorial="communication-quick">
          <h2>{t("communication.quick.title")}</h2>
          {queuedNotice ? <p className="comm-queue-status" aria-live="polite">{queuedNotice}</p> : null}
          {!isSocketConnected ? (
            <p className="comm-queue-hint">{t("communication.quick.unavailable")}</p>
          ) : null}
          <div className="quick-list">
            {quickMessages.map((message) => (
              <button
                key={message}
                type="button"
                onClick={() => sendMessage(message)}
              >
                {message}
              </button>
            ))}
          </div>
          <div className="broadcast">
            <h3>{t("communication.quick.broadcast")}</h3>
            <p className="broadcast-hint">{t("communication.quick.broadcastHint")}</p>
            <button
              type="button"
              className="broadcast-btn"
              disabled={!currentInput.trim()}
              onClick={() => sendMessage(currentInput, { queueWhenOffline: true })}
            >
              {t("communication.quick.sendCurrent")}
            </button>
          </div>

          <section className="queued-messages-panel" aria-label={t("communication.queued.aria")}>
            <div className="queued-messages-head">
              <div>
                <h3>{t("communication.queued.title")}</h3>
                <p>{t("communication.queued.summary", { count: queuedMessages.length })}</p>
              </div>
              <button
                type="button"
                className="queued-clear-btn"
                onClick={clearSentMessages}
                disabled={!hasSentQueuedMessages}
              >
                {t("communication.queued.clearSent")}
              </button>
            </div>

            {queuedMessages.length ? (
              <div className="queued-message-list">
                {queuedMessages.map((message) => {
                  const sendDisabled = Boolean(retryDisabledReason) || message.status === "sending";
                  return (
                    <article key={message.id} className={`queued-message-item status-${message.status}`}>
                      <div className="queued-message-main">
                        <p className="queued-message-text">{message.text}</p>
                        <div className="queued-message-meta">
                          <span>{message.channel}</span>
                          <span>{formatQueuedMessageTime(message.createdAt, locale, t("communication.queued.timeUnknown"))}</span>
                          <span>{message.reason}</span>
                        </div>
                        {message.lastError ? <p className="queued-message-error">{message.lastError}</p> : null}
                        {message.status === "sent" ? (
                          <p className="queued-message-note">{t("communication.queued.sentLocal")}</p>
                        ) : null}
                      </div>
                      <div className="queued-message-actions">
                        <span className={`queued-status-badge ${message.status}`}>{message.status}</span>
                        <button
                          type="button"
                          className="queued-send-btn"
                          onClick={() => retryQueuedMessage(message)}
                          disabled={sendDisabled}
                        >
                          {message.status === "sending" ? t("communication.queued.sending") : retryDisabledReason || t("communication.queued.sendNow")}
                        </button>
                        <button
                          type="button"
                          className="queued-remove-btn"
                          onClick={() => removeQueuedMessage(message.id)}
                        >
                          {t("communication.queued.remove")}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="queued-empty">{t("communication.queued.empty")}</p>
            )}
          </section>
        </div>
      </div>

    </section>
  );
};

export default CommunicationPage;

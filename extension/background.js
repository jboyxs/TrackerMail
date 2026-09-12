const DEFAULT_SERVER_URL = "https://tracker.775772.xyz";
const LEGACY_SERVER_URL = "http://10.10.80.14:8000";
const STORAGE_KEYS = {
  records: "trackingRecords",
  settings: "trackingSettings",
  composeStates: "composeTrackingStates",
  pending: "pendingTracks",
};

async function readObject(key) {
  const result = await messenger.storage.local.get(key);
  return result[key] || {};
}

async function writeObject(key, value) {
  await messenger.storage.local.set({ [key]: value });
}

async function getServerUrl() {
  const settings = await readObject(STORAGE_KEYS.settings);
  const configuredUrl = settings.serverUrl === LEGACY_SERVER_URL
    ? DEFAULT_SERVER_URL
    : settings.serverUrl || DEFAULT_SERVER_URL;

  if (configuredUrl !== settings.serverUrl) {
    await writeObject(STORAGE_KEYS.settings, { ...settings, serverUrl: configuredUrl });
  }
  return MailTrackerCompose.normalizeServerUrl(configuredUrl);
}

async function getApiToken() {
  const settings = await readObject(STORAGE_KEYS.settings);
  return settings.apiToken || "";
}

async function setComposeUi(tabId, enabled, errorMessage = "") {
  await messenger.composeAction.setBadgeText({ tabId, text: errorMessage ? "!" : enabled ? "ON" : "" });
  await messenger.composeAction.setBadgeBackgroundColor({
    tabId,
    color: errorMessage ? "#b91c1c" : "#15803d",
  });
  await messenger.composeAction.setTitle({
    tabId,
    title: errorMessage || `Track Email: ${enabled ? "on" : "off"}`,
  });
}

messenger.composeAction.onClicked.addListener(async (tab) => {
  const states = await readObject(STORAGE_KEYS.composeStates);
  const enabled = !Boolean(states[tab.id]);
  states[tab.id] = enabled;
  await writeObject(STORAGE_KEYS.composeStates, states);
  await setComposeUi(tab.id, enabled);
});

messenger.compose.onBeforeSend.addListener(async (tab, details) => {
  const states = await readObject(STORAGE_KEYS.composeStates);
  if (!states[tab.id]) {
    return {};
  }

  try {
    if (details.isPlainText) {
      throw new Error("Tracking requires an HTML email. Switch the composer to HTML or turn tracking off.");
    }

    const recipient = MailTrackerCompose.getSingleRecipient(details);
    const pending = await readObject(STORAGE_KEYS.pending);
    const existing = pending[tab.id];
    const trackingId = existing?.tracking_id || crypto.randomUUID();
    const sentAt = existing?.sent_at || new Date().toISOString();
    const serverUrl = await getServerUrl();
    const apiToken = await getApiToken();
    if (!apiToken) throw new Error("API Token is not configured. Open Mail Tracker Options first.");

    const record = {
      tracking_id: trackingId,
      recipient,
      subject: details.subject || "(No subject)",
      sent_at: sentAt,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    let response;
    try {
      response = await fetch(`${serverUrl}/api/tracks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiToken}` },
        body: JSON.stringify(record),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new Error(`Tracking server rejected the record (HTTP ${response.status}).`);
    }

    pending[tab.id] = record;
    await writeObject(STORAGE_KEYS.pending, pending);
    await setComposeUi(tab.id, true);

    return {
      details: {
        body: MailTrackerCompose.appendTrackingPixel(details.body || "", serverUrl, trackingId),
      },
    };
  } catch (error) {
    const message = error.name === "AbortError"
      ? "Tracking server timed out; sending was cancelled."
      : `Tracking error: ${error.message}`;
    console.error(message, error);
    await setComposeUi(tab.id, true, message);
    return { cancel: true };
  }
});

// Thunderbird provides the final RFC Message-ID only after an actual send.
// onAfterSend.headerMessageId is available without messagesRead permission.
messenger.compose.onAfterSend.addListener(async (tab, sendInfo) => {
  const pending = await readObject(STORAGE_KEYS.pending);
  const record = pending[tab.id];
  if (!record) {
    return;
  }

  if (!sendInfo.error) {
    const records = await readObject(STORAGE_KEYS.records);
    records[record.tracking_id] = {
      ...record,
      message_id: sendInfo.headerMessageId || null,
      opened: false,
      first_opened_at: null,
      last_opened_at: null,
      open_count: 0,
    };
    await writeObject(STORAGE_KEYS.records, records);
  } else {
    console.error("Message send failed; tracking record was not added locally:", sendInfo.error);
  }

  delete pending[tab.id];
  await writeObject(STORAGE_KEYS.pending, pending);
});

messenger.tabs.onRemoved.addListener(async (tabId) => {
  const states = await readObject(STORAGE_KEYS.composeStates);
  if (Object.hasOwn(states, tabId)) {
    delete states[tabId];
    await writeObject(STORAGE_KEYS.composeStates, states);
  }
});

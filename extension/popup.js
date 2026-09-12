const recordsContainer = document.querySelector("#records");
const message = document.querySelector("#message");
const refreshButton = document.querySelector("#refresh");
const template = document.querySelector("#record-template");
const configurationForm = document.querySelector("#configuration-form");
const serverUrlInput = document.querySelector("#server-url");
const serverWarning = document.querySelector("#server-warning");
const apiUsernameInput = document.querySelector("#api-username");
const apiTokenInput = document.querySelector("#api-token");
const health = document.querySelector("#health");
const settingsToggle = document.querySelector("#settings-toggle");
const configuration = document.querySelector("#configuration");

settingsToggle.addEventListener("click", () => {
  const expanded = settingsToggle.getAttribute("aria-expanded") === "true";
  settingsToggle.setAttribute("aria-expanded", String(!expanded));
  configuration.hidden = expanded;
});

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

function updateServerWarning() {
  try {
    const url = new URL(serverUrlInput.value.trim());
    const insecure = url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname);
    serverWarning.hidden = !insecure;
    serverWarning.textContent = insecure
      ? "⚠ 不安全连接：此 HTTP 地址会明文传输 API Token，可能被窃听。建议改用 HTTPS。"
      : "";
  } catch {
    serverWarning.hidden = true;
    serverWarning.textContent = "";
  }
}

serverUrlInput.addEventListener("input", updateServerWarning);

async function getConfiguration() {
  const { trackingSettings = {} } = await messenger.storage.local.get("trackingSettings");
  const legacyUrl = "http://10.10.80.14:8000";
  const serverUrl = !trackingSettings.serverUrl || trackingSettings.serverUrl === legacyUrl
    ? "https://tracker.775772.xyz"
    : trackingSettings.serverUrl;

  if (serverUrl !== trackingSettings.serverUrl) {
    await messenger.storage.local.set({ trackingSettings: { ...trackingSettings, serverUrl } });
  }
  return serverUrl.replace(/\/$/, "");
}

async function restoreConfiguration() {
  const { trackingSettings = {} } = await messenger.storage.local.get("trackingSettings");
  serverUrlInput.value = trackingSettings.serverUrl || "https://tracker.775772.xyz";
  apiUsernameInput.value = trackingSettings.apiUsername || "";
  apiTokenInput.value = trackingSettings.apiToken || "";
  updateServerWarning();
}

async function checkHealth(serverUrl) {
  health.textContent = "Checking…";
  health.className = "health pending";
  try {
    const response = await fetch(`${serverUrl}/health`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    health.textContent = "Online";
    health.className = "health online";
  } catch {
    health.textContent = "Offline";
    health.className = "health offline";
  }
}

configurationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const url = new URL(serverUrlInput.value.trim());
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("URL must use http:// or https://.");
    const serverUrl = url.href.replace(/\/$/, "");
    const apiUsername = apiUsernameInput.value.trim();
    const apiToken = apiTokenInput.value.trim();
    if (!apiUsername || !apiToken) throw new Error("Username and API Token are required.");
    await messenger.storage.local.set({ trackingSettings: { serverUrl, apiUsername, apiToken } });
    message.textContent = "Settings saved. Refreshing…";
    await loadRecords();
  } catch (error) {
    message.textContent = `Settings not saved: ${error.message}`;
  }
});

async function loadRecords() {
  refreshButton.disabled = true;
  message.textContent = "Refreshing tracking status…";
  recordsContainer.replaceChildren();

  try {
    const [{ trackingRecords = {} }, { trackingSettings = {} }, serverUrl] = await Promise.all([
      messenger.storage.local.get("trackingRecords"),
      messenger.storage.local.get("trackingSettings"),
      getConfiguration(),
    ]);
    const apiToken = trackingSettings.apiToken || "";
    await checkHealth(serverUrl);
    if (!apiToken) {
      message.textContent = "API Token is not configured. Open Settings to enter it.";
      configuration.hidden = false;
      settingsToggle.setAttribute("aria-expanded", "true");
      return;
    }
    const localRecords = Object.values(trackingRecords)
      .sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at));

    if (localRecords.length === 0) {
      message.textContent = "No tracked messages yet.";
      return;
    }

    let failures = 0;
    const refreshed = await Promise.all(localRecords.map(async (record) => {
      try {
        const response = await fetch(`${serverUrl}/api/tracks/${encodeURIComponent(record.tracking_id)}`, { headers: { Authorization: `Bearer ${apiToken}` } });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return { ...record, ...(await response.json()) };
      } catch (error) {
        failures += 1;
        console.error(`Could not refresh ${record.tracking_id}:`, error);
        return record;
      }
    }));

    const updatedMap = Object.fromEntries(refreshed.map((record) => [record.tracking_id, record]));
    await messenger.storage.local.set({ trackingRecords: updatedMap });

    for (const record of refreshed) {
      const fragment = template.content.cloneNode(true);
      fragment.querySelector(".subject").textContent = record.subject;
      fragment.querySelector(".subject-detail").textContent = record.subject;
      fragment.querySelector(".recipient").textContent = record.recipient;
      fragment.querySelector(".tracking-id").textContent = record.tracking_id;
      fragment.querySelector(".sent-at").textContent = formatDate(record.sent_at);
      fragment.querySelector(".first-opened-at").textContent = formatDate(record.first_opened_at);
      fragment.querySelector(".last-opened-at").textContent = formatDate(record.last_opened_at);
      fragment.querySelector(".open-count").textContent = String(record.open_count || 0);
      const deleteButton = fragment.querySelector(".delete-record");
      deleteButton.addEventListener("click", async () => {
        deleteButton.disabled = true;
        try {
          const response = await fetch(`${serverUrl}/api/tracks/${encodeURIComponent(record.tracking_id)}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${apiToken}` },
          });
          if (!response.ok && response.status !== 404) throw new Error(`HTTP ${response.status}`);
          const { trackingRecords = {} } = await messenger.storage.local.get("trackingRecords");
          delete trackingRecords[record.tracking_id];
          await messenger.storage.local.set({ trackingRecords });
          await loadRecords();
        } catch (error) {
          deleteButton.disabled = false;
          message.textContent = `Delete failed: ${error.message}`;
        }
      });
      const status = fragment.querySelector(".status");
      const opened = (record.open_count || 0) > 0;
      status.textContent = opened ? "Opened detected / 检测到打开" : "No open detected";
      status.classList.toggle("opened", opened);
      recordsContainer.append(fragment);
    }

    message.textContent = failures
      ? `${failures} record(s) could not be refreshed; cached status is shown.`
      : `Updated ${refreshed.length} record(s).`;
  } catch (error) {
    console.error(error);
    message.textContent = `Unable to load records: ${error.message}`;
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener("click", loadRecords);
loadRecords();
restoreConfiguration();

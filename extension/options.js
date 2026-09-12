const form = document.querySelector("#settings-form");
const serverUrlInput = document.querySelector("#server-url");
const serverWarning = document.querySelector("#server-warning");
const status = document.querySelector("#status");
const apiTokenInput = document.querySelector("#api-token");
const apiUsernameInput = document.querySelector("#api-username");

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

async function restoreOptions() {
  const { trackingSettings = {} } = await messenger.storage.local.get("trackingSettings");
  const legacyUrl = "http://10.10.80.14:8000";
  const serverUrl = !trackingSettings.serverUrl || trackingSettings.serverUrl === legacyUrl
    ? "https://tracker.775772.xyz"
    : trackingSettings.serverUrl;
  serverUrlInput.value = serverUrl;
  apiTokenInput.value = trackingSettings.apiToken || "";
  apiUsernameInput.value = trackingSettings.apiUsername || "";
  updateServerWarning();

  if (serverUrl !== trackingSettings.serverUrl) {
    await messenger.storage.local.set({ trackingSettings: { ...trackingSettings, serverUrl } });
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const url = new URL(serverUrlInput.value.trim());
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("URL must use http:// or https://.");
    }

    const serverUrl = url.href.replace(/\/$/, "");
    if (!apiUsernameInput.value.trim()) throw new Error("Username is required.");
    if (!apiTokenInput.value.trim()) throw new Error("API Token is required.");
    await messenger.storage.local.set({ trackingSettings: {
      serverUrl,
      apiUsername: apiUsernameInput.value.trim(),
      apiToken: apiTokenInput.value.trim(),
    } });
    serverUrlInput.value = serverUrl;
    status.textContent = "Saved.";
  } catch (error) {
    status.textContent = `Not saved: ${error.message}`;
  }
});

restoreOptions();

const form = document.querySelector("#settings-form");
const serverUrlInput = document.querySelector("#server-url");
const status = document.querySelector("#status");
const apiTokenInput = document.querySelector("#api-token");
const apiUsernameInput = document.querySelector("#api-username");

async function restoreOptions() {
  const { trackingSettings = {} } = await messenger.storage.local.get("trackingSettings");
  const legacyUrl = "http://10.10.80.14:8000";
  const serverUrl = !trackingSettings.serverUrl || trackingSettings.serverUrl === legacyUrl
    ? "https://tracker.775772.xyz"
    : trackingSettings.serverUrl;
  serverUrlInput.value = serverUrl;
  apiTokenInput.value = trackingSettings.apiToken || "";
  apiUsernameInput.value = trackingSettings.apiUsername || "";

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

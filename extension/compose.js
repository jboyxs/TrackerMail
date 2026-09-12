/*
 * Shared compose helpers loaded before background.js.
 *
 * Thunderbird's official compose API exposes the HTML message body as
 * ComposeDetails.body. compose.onBeforeSend may return a partial
 * ComposeDetails object, which is equivalent to setComposeDetails(). This is
 * safer and more stable than manipulating Thunderbird's compose editor DOM.
 */

const MailTrackerCompose = (() => {
  const TRACKING_ATTRIBUTE = "data-mail-tracker-id";

  function asArray(value) {
    if (value === undefined || value === null || value === "") {
      return [];
    }
    return Array.isArray(value) ? value : [value];
  }

  function recipientToString(recipient) {
    if (typeof recipient === "string") {
      return recipient.trim();
    }

    // ComposeRecipient may be an address-book node instead of a string.
    // Support the fields exposed by current Thunderbird contact/list objects.
    if (recipient && typeof recipient === "object") {
      return (
        recipient.email ||
        recipient.properties?.PrimaryEmail ||
        recipient.properties?.SecondEmail ||
        recipient.name ||
        ""
      ).trim();
    }
    return "";
  }

  function getSingleRecipient(details) {
    const allRecipients = [
      ...asArray(details.to),
      ...asArray(details.cc),
      ...asArray(details.bcc),
    ].map(recipientToString).filter(Boolean);

    if (allRecipients.length !== 1) {
      throw new Error("Tracking MVP requires exactly one recipient across To, Cc and Bcc.");
    }
    return allRecipients[0];
  }

  function normalizeServerUrl(value) {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Tracking Server URL must use http:// or https://.");
    }
    return url.href.replace(/\/$/, "");
  }

  function hasTrackingPixel(body, trackingId) {
    return body.includes(`${TRACKING_ATTRIBUTE}="${trackingId}"`);
  }

  function appendTrackingPixel(body, serverUrl, trackingId) {
    if (hasTrackingPixel(body, trackingId)) {
      return body;
    }

    const pixelUrl = `${normalizeServerUrl(serverUrl)}/open/${encodeURIComponent(trackingId)}.png`;
    const pixel = `<img src="${pixelUrl}" width="1" height="1" alt="" ${TRACKING_ATTRIBUTE}="${trackingId}" style="display:block;width:1px;height:1px;border:0;opacity:0" />`;
    const closingBody = /<\/body\s*>/i;

    return closingBody.test(body)
      ? body.replace(closingBody, `${pixel}</body>`)
      : `${body}${pixel}`;
  }

  return {
    appendTrackingPixel,
    getSingleRecipient,
    normalizeServerUrl,
  };
})();

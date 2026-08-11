# Standalone Web Push PoC

This playground is deliberately independent of Approval MCP. It verifies what a real browser and operating system do with:

- configurable notification title, body, and image;
- up to three configurable notification actions;
- a safe text, JSON, or key/value detail view after the notification is opened;
- Web Push delivery while the page is not active.

No approval or MCP endpoint is called. Clicking an action only records its ID in process memory and opens the result page.

## Run locally on macOS

```bash
cd pocs/web-push
npm install
npm start
```

Open `http://localhost:4173`. Localhost is accepted as a secure context by browsers. Copy the control token printed by the server into the form.

## Try it on iPhone or iPad

iOS Web Push needs a valid HTTPS origin. Make the PoC available through a trusted HTTPS reverse proxy, private VPN, or temporary tunnel, then:

1. Open the HTTPS URL on the device.
2. Add the page to the Home Screen.
3. Start it from its Home Screen icon.
4. Select **Povolit notifikace**.

To listen outside localhost, run for example:

```bash
HOST=0.0.0.0 POC_TOKEN=choose-a-long-random-value npm start
```

For a real deployment, set `VAPID_SUBJECT` to a monitored `mailto:` address or an HTTPS URL you control. The PoC default uses the reserved `example.com` domain because Apple Push rejects syntactically invalid contact domains.

Do not expose this PoC directly to the public internet. It is a capability experiment, not a production push service.

## Local state

VAPID keys and push subscriptions are stored in `.poc-data/`, which is ignored by Git. Delete that directory to reset the experiment. Existing browser subscriptions stop working after VAPID keys are regenerated and need to be registered again.

# Windscreen Automation System

Source backup for the Windscreen Fitment Centre automation dashboard, including the Reception WiFi voucher module.

## Included

- Windscreen dashboard backend (`index.js`)
- Studio frontend (`admin-web/`)
- Business services and integrations
- Static dashboard assets
- Reception WiFi connector, pairing gateway, installers, updater, and setup helpers
- WiFi voucher generation, live voucher monitoring, 5-minute unused activation expiry, history, and 58 mm receipt printing

## Intentionally excluded

This repository must not contain production secrets or customer/runtime data. Environment files, databases, logs, backups, uploads, generated PDFs, debug evidence, dependencies, and embedded runtime binaries are excluded.

## Production

Live dashboard: `https://glass.visionpixels.autos/studio`

## Security

Create the required environment variables on the deployment host. Never commit `.env`, production databases, API keys, access tokens, customer documents, or pairing secrets.

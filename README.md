# Windscreen WIFI VOUCHER System

A staff-friendly WiFi voucher system for **Windscreen Fitment Centre**. It is integrated into the Windscreen dashboard and allows reception staff to create, monitor, expire and print customer WiFi vouchers without managing the underlying WiFi software manually.

## How it works

1. Reception selects a **time limit** and **data limit**.
2. The dashboard creates a unique **6-digit WiFi voucher code**.
3. The voucher stays **READY** for up to **5 minutes** waiting for the customer to connect.
4. The customer joins **Windscreen Guest Wifi** and enters the 6-digit voucher code on the captive portal.
5. Once the customer connects, the voucher becomes **ACTIVE** and its time/data allowance starts running.
6. The dashboard refreshes live voucher usage every **5 seconds**.
7. When the voucher finishes, is used up, or expires unused, it moves to **Voucher History**.

## Staff workflow

**Choose limits → Generate voucher → Give/print the 6-digit code → Monitor Live → Voucher moves to History automatically.**

Reception can generate multiple independent vouchers, each with its own code, time allowance, data allowance and status.

## Main features

- Unique 6-digit customer voucher codes
- Custom time and data limits
- 5-minute activation window for unused vouchers
- READY, ACTIVE and HISTORY states
- Live remaining time and data monitoring
- Automatic refresh every 5 seconds
- 58 mm thermal receipt printing
- Click any live voucher to view and reprint it
- One-time reception-desktop pairing
- Local connector between the web dashboard and the reception WiFi service
- WiFi setup/update controls kept inside **Settings**

## System flow

```text
Windscreen Dashboard
        ↓
Reception WiFi Connector
        ↓
Reception WiFi Service
        ↓
Windscreen Guest Wifi
        ↓
Customer Captive Portal
        ↓
6-digit Voucher Login
```

## Repository contents

This private repository contains the Windscreen dashboard code required for the WiFi voucher feature, including:

- dashboard frontend and backend
- WiFi voucher UI and live monitoring
- Reception WiFi connector
- pairing gateway
- Windows reception setup installer
- voucher-engine updater
- 58 mm receipt printing logic
- supporting services and integrations used by the Windscreen dashboard

## Production

Windscreen dashboard: `https://glass.visionpixels.autos/studio`

## Security

Production secrets and customer/runtime data are intentionally excluded. Do not commit `.env` files, production databases, API keys, access tokens, customer documents, pairing secrets, logs or uploaded files.

---

**Designed and maintained by VisionCo.**

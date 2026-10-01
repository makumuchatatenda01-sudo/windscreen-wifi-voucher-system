WINDSCREEN RECEPTION WIFI — INSTALLATION

On the reception Windows desktop:
1. Install MyPublicWiFi 31.3 from https://www.mypublicwifi.com/ and set the guest SSID, network key, and voucher login in its own app.
2. Open https://glass.visionpixels.autos/studio and sign in with the existing staff admin PIN.
3. Open WiFi Vouchers and run Install-Windscreen-Reception-WiFi-Portable-v3.cmd. It prepares its own Python runtime automatically.
4. The installer shows a six-digit pairing code. Enter it in the dashboard on the same desktop. Keep the code private.
5. Press Start Hotspot in MyPublicWiFi. The dashboard checks the hotspot status and issues unique customer vouchers.
6. Sign out and back in to Windows once. Confirm MyPublicWiFi opens visibly and waits for staff to press Start Hotspot.
7. Check the full Wi-Fi password → voucher → internet flow using a customer phone.

MyPublicWiFi is a third-party app and is not included. Reception Setup downloads a verified portable Python runtime from the dashboard; it does not require a separate Python installation.
The seven-day dashboard PIN reminder is provided by the current live dashboard.
The installer validates downloaded connector files and backs up the MyPublicWiFi database before installation.

VERSION 3 — DATABASE PERMISSION REPAIR
Double-click the CMD normally from the reception Windows account.
Approve the Windows administrator prompt (an administrator may enter their credentials).
Only the permission helper runs elevated. Pairing, connector and startup registration
remain assigned to the original reception user.
The helper backs up original permissions in C:\ProgramData\VisionCo-WiFi-Setup-Backups.
It grants that user create-file access on the MyPublicWiFi folder (not inherited),
and Modify access on Data.db and existing SQLite journal/WAL/SHM files.
It does not grant write permission on existing application executables.
Setup tests a database write in a transaction and rolls it back. No test voucher is created.
If the permission or write check fails, setup stops with an error.
This package does not automatically set the SSID, WiFi key or voucher authentication.
It does not resolve an unrelated port 80 conflict.

Unused voucher activation window: 5 minutes. If a customer does not activate the code within 5 minutes, it expires and is shown in Voucher History.

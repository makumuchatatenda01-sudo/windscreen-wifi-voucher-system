"""VisionCo local MyPublicWiFi connector. Python 3.13; standard library only.

Run on the MyPublicWiFi laptop. No inbound network port is exposed: loopback only.
The dashboard calls this process directly; leave it running during the pilot.
Database support is experimental until verified against this installed version.
"""
import argparse
import hashlib
import hmac
import json
import math
import os
from pathlib import Path
import secrets
import sqlite3
import shutil
import subprocess
import sys
import socket
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ORIGIN = "https://glass.visionpixels.autos"
PORT = 18763
CAT = timezone(timedelta(hours=2))
MARK = "VisionCo connector v1:"  # Keep v1 marker so existing vouchers remain managed.
VERSION = "1.1.0"
BUILD_VERSION = "1.2.4"
INSTALLED_FILENAME = "VisionCo-WiFi-Connector-FINAL.pyw"
LOCK = threading.RLock()


def flag(value):
    return str(value).strip().lower() in ("1", "y", "yes", "true")


def stamp(epoch):
    return datetime.fromtimestamp(epoch, CAT).strftime("%Y-%m-%d %H:%M:%S")


def epoch(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value)).replace(tzinfo=CAT).timestamp()
    except ValueError:
        return None


def native_time(value):
    """Return None for MyPublicWiFi's native 'not set' timestamp."""
    if value is None:
        return None
    value = str(value)
    if not value or value.startswith("1899-12-30"):
        return None
    return value


class Connector:
    def __init__(self, path, home):
        self.path = Path(path).resolve()
        self.home = Path(home)
        self.home.mkdir(parents=True, exist_ok=True)
        self.last_error = None
        self.last_watch = 0
        self.stop = threading.Event()
        with self.db() as db:
            columns = {r[1] for r in db.execute("PRAGMA table_info(CodeAccounts)")}
            required = {"ID", "RandomID", "Code", "GroupId", "Active", "CreatedDate", "FirstLogin", "LastLogout", "MinutesCreditLimited", "MinutesCredit", "TimeStopAtLogout", "FixedEndTimeEnabled", "FixedEndTime", "BytesTrafficCreditLimited", "BytesTrafficCredit", "BytesTraffic", "Comment", "MultiLoginEnabled", "AutoLogin", "ExpireFromDate", "ExpireFromFirstLogin", "ExpireFromLastLogout"}
            if not required.issubset(columns):
                raise RuntimeError("Unsupported voucher schema. No records were changed.")
            tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            self.live_device_supported = {"Sessions", "ClientHostNames"}.issubset(tables)
            self.session_logs_supported = {"SessionLogs", "ClientHostNames"}.issubset(tables)
        self.backup()

    @contextmanager
    def db(self):
        # mode=rw must never silently create an empty replacement database.
        db = sqlite3.connect(self.path.as_uri() + "?mode=rw", uri=True, timeout=5)
        db.row_factory = sqlite3.Row
        try:
            yield db
        finally:
            db.close()

    def backup(self):
        target_path = self.home / ("Data-before-connector-" + datetime.now().strftime("%Y%m%d-%H%M%S-%f") + ".db")
        source = sqlite3.connect(self.path.as_uri() + "?mode=ro", uri=True, timeout=5)
        target = sqlite3.connect(target_path)
        try:
            deadline = time.monotonic() + 20
            def progress(status, remaining, total):
                if time.monotonic() > deadline:
                    raise TimeoutError("Backup was busy for 20 seconds. Close the voucher editor and try again.")
            source.backup(target, pages=128, progress=progress)
            if target.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise RuntimeError("Backup integrity check failed.")
        finally:
            source.close()
            target.close()
        return target_path

    @staticmethod
    def metadata(row):
        comment = row["Comment"] or ""
        if not comment.startswith(MARK):
            return None
        try:
            result = json.loads(comment[len(MARK):])
            if not isinstance(result, dict) or not all(k in result for k in ("key", "end", "redeem", "quota", "minutes")):
                return None
            return result
        except (ValueError, TypeError):
            return None

    def snapshot(self):
        with LOCK, self.db() as db:
            db.execute("PRAGMA query_only=ON")
            rows = db.execute("SELECT * FROM CodeAccounts ORDER BY ID DESC LIMIT 1000").fetchall()

            live_rows = []
            if self.live_device_supported:
                live_rows = db.execute("""
                    SELECT
                        s.MAC,
                        s.SessionType,
                        s.AccountID,
                        s.StartTime,
                        s.BytesDownload,
                        s.BytesUpload,
                        h.HostName
                    FROM Sessions s
                    LEFT JOIN ClientHostNames h ON h.MAC = s.MAC
                    WHERE s.SessionType = 1
                """).fetchall()

            history_rows = []
            if self.session_logs_supported:
                history_rows = db.execute("""
                    SELECT
                        sl.ID,
                        sl.MAC,
                        sl.SessionType,
                        sl.AccountID,
                        sl.StartTime,
                        sl.EndTime,
                        sl.SessionMinutes,
                        sl.BytesDownload,
                        sl.BytesUpload,
                        h.HostName
                    FROM SessionLogs sl
                    LEFT JOIN ClientHostNames h ON h.MAC = sl.MAC
                    WHERE sl.SessionType = 1
                    ORDER BY sl.ID DESC
                    LIMIT 5000
                """).fetchall()

        live_by_account = {}
        for session in live_rows:
            account = str(session["AccountID"])
            if account not in live_by_account:
                live_by_account[account] = session

        last_by_account = {}
        for session in history_rows:
            account = str(session["AccountID"])
            if account not in last_by_account:
                last_by_account[account] = session

        now = time.time()
        result = []
        for row in rows:
            meta = self.metadata(row)
            first = epoch(row["FirstLogin"])
            end = epoch(row["FixedEndTime"]) if flag(row["FixedEndTimeEnabled"]) else None
            credit, used = int(row["BytesTrafficCredit"] or 0), int(row["BytesTraffic"] or 0)
            data = max(0, credit - used) if flag(row["BytesTrafficCreditLimited"]) else None
            starts_on_login = bool(meta and meta.get("timing") == "first_login")
            timely_login = bool(first is not None and meta and first <= meta["redeem"])
            access_end = (first + meta["minutes"] * 60 if timely_login else None) if starts_on_login else (meta["end"] if meta else None)
            state = ("Usage started" if first else "Waiting for customer") if starts_on_login else ("Used" if first else "Unused")

            if not flag(row["Active"]):
                state = "Blocked"
            elif end is not None and now >= end:
                state = "Code expired" if starts_on_login and not first else "Deadline passed"

            if starts_on_login and first is not None and not timely_login:
                state = "Late login — check hotspot"

            account = str(row["ID"])
            live = live_by_account.get(account)
            last = last_by_account.get(account)
            device = live or last
            connected = live is not None

            if connected:
                connection_status = "connected"
            elif first is not None:
                connection_status = "disconnected"
            else:
                connection_status = "waiting"

            lifecycle_state = state
            if device and device["HostName"]:
                if connected:
                    state = lifecycle_state + " • 🟢 Connected • " + str(device["HostName"])
                elif first is not None:
                    state = lifecycle_state + " • ⚪ Disconnected • " + str(device["HostName"])

            result.append({
                "id": account,
                "code": row["Code"],
                "managed": meta is not None,
                "firstUse": native_time(row["FirstLogin"]),
                "state": state,
                "lifecycleState": lifecycle_state,
                "issued": row["CreatedDate"],
                "end": native_time(row["FixedEndTime"]) if end else None,
                "remainingSeconds": (
                    meta["minutes"] * 60
                    if first is None
                    else max(0, int(access_end - now)) if access_end else 0
                ) if starts_on_login else (max(0, int(end - now)) if end else None),
                "remainingBytes": data,
                "rawCreditBytes": credit,
                "rawTrafficBytes": used,
                "rawMinutesCredit": row["MinutesCredit"],
                "timeLimited": flag(row["MinutesCreditLimited"]),
                "dataLimited": flag(row["BytesTrafficCreditLimited"]),
                "assignedBytes": meta["quota"] if meta else None,
                "assignedMinutes": meta["minutes"] if meta else None,
                "redeemBy": stamp(meta["redeem"]) if meta else None,
                "timing": "first_login" if starts_on_login else "issue",
                "accessEnd": stamp(access_end) if access_end else None,

                # v1.2 live-device fields.
                # Sessions is the authenticated live-session source.
                "connected": connected,
                "connectionStatus": connection_status,
                "deviceName": device["HostName"] if device and device["HostName"] else None,
                "deviceMac": str(device["MAC"]) if device and device["MAC"] is not None else None,
                "sessionStart": native_time(live["StartTime"]) if live else None,
                "sessionBytesDownload": int(live["BytesDownload"] or 0) if live else None,
                "sessionBytesUpload": int(live["BytesUpload"] or 0) if live else None,
                "lastSessionEnd": native_time(last["EndTime"]) if last else native_time(row["LastLogout"]),
            })

        return {
            "vouchers": result,
            "serverTime": int(now * 1000),
            "connectorVersion": VERSION,
            "buildVersion": BUILD_VERSION,
            "readAt": stamp(now),
            "balancesVerified": False,
            "watchdogHealthy": self.last_error is None and now - self.last_watch < 10,
            "watchdogError": self.last_error,
            "hotspotVerified": False,
            "liveDeviceStatusSupported": self.live_device_supported,
            "sessionHistorySupported": self.session_logs_supported,
        }

    def issue(self, body):
        hours, minutes, amount, unit, key = (body.get(k) for k in ("hours", "minutes", "dataAmount", "dataUnit", "key"))
        if type(hours) is not int or type(minutes) is not int or hours < 0 or not 0 <= minutes < 60 or not 1 <= hours * 60 + minutes <= 10080:
            raise ValueError("Choose 1 minute to 7 days.")
        if type(amount) not in (int, float) or not math.isfinite(amount) or unit not in ("MB", "GB"):
            raise ValueError("Choose a valid MB or GB allowance.")
        quota = round(amount * (1000000 if unit == "MB" else 1000000000))
        if not 1000000 <= quota <= 1000000000000:
            raise ValueError("Choose 1 MB to 1,000 GB.")
        if not isinstance(key, str) or len(key) != 36 or any(c not in "0123456789abcdef-" for c in key.lower()):
            raise ValueError("Invalid request key.")
        if self.last_error or time.time() - self.last_watch > 10:
            raise ValueError("The expiry monitor is not healthy. No voucher was created.")
        fingerprint = hashlib.sha256(json.dumps([hours, minutes, quota]).encode()).hexdigest()
        with LOCK, self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            for row in db.execute("SELECT * FROM CodeAccounts WHERE Comment LIKE ?", (MARK + "%",)):
                meta = self.metadata(row)
                if meta and meta["key"] == key:
                    if meta.get("fingerprint") != fingerprint:
                        raise ValueError("This request was already used with different limits.")
                    db.commit()
                    return {
                        "code": row["Code"],
                        "id": str(row["ID"]),
                        "duplicate": True,
                        "voucher": {
                            "id": str(row["ID"]),
                            "code": row["Code"],
                            "managed": True,
                            "state": "Waiting for customer",
                            "lifecycleState": "Waiting for customer"
                        }
                    }
            now = int(time.time())
            if db.execute("SELECT COUNT(*) FROM CodeAccounts WHERE Comment LIKE ? AND CreatedDate>?", (MARK + "%", stamp(now - 60))).fetchone()[0] >= 30:
                raise ValueError("Please wait a minute before creating more vouchers.")
            for _ in range(30):
                code = str(secrets.randbelow(1000000)).zfill(6)
                if not db.execute("SELECT 1 FROM CodeAccounts WHERE Code=?", (code,)).fetchone():
                    break
            else:
                raise ValueError("Could not allocate a unique code.")
            group = db.execute("SELECT ID FROM CodeGroups WHERE GroupName=? ORDER BY ID LIMIT 1", ("VisionCo Dashboard",)).fetchone()
            group_id = group[0] if group else db.execute("INSERT INTO CodeGroups(GroupName) VALUES (?)", ("VisionCo Dashboard",)).lastrowid
            duration = hours * 60 + minutes
            redeem = now + 300  # Windscreen: unused voucher activation expires after 5 minutes
            meta = {"key": key, "end": None, "redeem": redeem, "quota": quota, "minutes": duration, "fingerprint": fingerprint, "extended": False, "timing": "first_login"}
            # Confirmed native 31.3 defaults are numeric booleans. Use explicit values;
            # never copy one field's enabled value to an unrelated setting.
            row_id = db.execute("""INSERT INTO CodeAccounts
                (GroupId,Code,Active,CreatedDate,MinutesCreditLimited,MinutesCredit,
                 BytesTrafficCreditLimited,BytesTrafficCredit,BytesTraffic,TimeStopAtLogout,
                 FixedEndTimeEnabled,FixedEndTime,MultiLoginEnabled,AutoLogin,
                 ExpireFromDate,ExpireFromFirstLogin,ExpireFromLastLogout,Comment)
                VALUES (?,?,1,?,1,?,1,?,0,0,1,?,0,0,0,0,0,?)""",
                (group_id, code, stamp(now), duration, quota, stamp(redeem), MARK + json.dumps(meta, separators=(",", ":")))).lastrowid
            db.commit()
            return {
                "id": str(row_id),
                "code": code,
                "duplicate": False,
                "voucher": {
                    "id": str(row_id),
                    "code": code,
                    "managed": True,
                    "state": "Waiting for customer",
                    "lifecycleState": "Waiting for customer",
                    "issued": stamp(now),
                    "remainingSeconds": duration * 60,
                    "remainingBytes": quota,
                    "assignedBytes": quota,
                    "assignedMinutes": duration,
                    "redeemBy": stamp(redeem),
                    "timing": "first_login"
                }
            }

    def tick(self):
        # New vouchers retain their full allowance until FirstLogin. The initial
        # native fixed deadline is ONLY for redemption. Once login is recorded,
        # replace it with FirstLogin + assigned duration, including if earlier.
        # Previously issued v1 vouchers keep their original issued-time semantics.
        with LOCK, self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            rows = db.execute("SELECT * FROM CodeAccounts WHERE Comment LIKE ?", (MARK + "%",)).fetchall()
            for row in rows:
                meta = self.metadata(row)
                if not meta or meta.get("extended") or not flag(row["Active"]):
                    continue
                # Respect any fixed-deadline edit made directly in MyPublicWiFi.
                if not flag(row["FixedEndTimeEnabled"]) or row["FixedEndTime"] != stamp(meta["redeem"]):
                    continue
                first = epoch(row["FirstLogin"])
                proposed_end = first + meta["minutes"] * 60 if first is not None and meta.get("timing") == "first_login" else meta["end"]
                created = epoch(row["CreatedDate"])
                if first is not None and created is not None and created <= first <= meta["redeem"] and proposed_end is not None:
                    meta["end"] = proposed_end
                    meta["extended"] = True
                    db.execute("UPDATE CodeAccounts SET FixedEndTimeEnabled=1,FixedEndTime=?,Comment=? WHERE ID=? AND RandomID=? AND Comment=?",
                        (stamp(meta["end"]), MARK + json.dumps(meta, separators=(",", ":")), row["ID"], row["RandomID"], row["Comment"]))
            db.commit()
        self.last_watch, self.last_error = time.time(), None

    def watch(self):
        while not self.stop.is_set():
            try:
                self.tick()
            except Exception as exc:
                self.last_error = str(exc)
            self.stop.wait(1)


def handler(connector, token):
    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(10)

        def log_message(self, *args):
            pass

        def trusted(self):
            return self.headers.get("Host") == f"127.0.0.1:{PORT}" and self.headers.get("Origin") == ORIGIN

        def send(self, status, payload):
            raw = json.dumps(payload).encode()
            self.send_response(status)
            if self.trusted():
                self.send_header("Access-Control-Allow-Origin", ORIGIN)
                self.send_header("Vary", "Origin")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(raw)

        def do_OPTIONS(self):
            if not self.trusted():
                return self.send(403, {"error": "Origin not allowed."})
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", ORIGIN)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Vary", "Origin")
            self.end_headers()

        def authorized(self):
            if not self.trusted():
                self.send(403, {"error": "Origin not allowed."})
                return False
            if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token):
                self.send(401, {"error": "Pairing key is incorrect. Copy it from the connector window."})
                return False
            return True

        def do_GET(self):
            if not self.authorized():
                return
            if self.path != "/vouchers":
                return self.send(404, {"error": "Not found."})
            try:
                self.send(200, connector.snapshot())
            except Exception:
                self.send(503, {"error": "Cannot read the Reception WiFi voucher database. Check the connector and database permissions."})

        def do_POST(self):
            if not self.authorized():
                return
            if self.path != "/vouchers":
                return self.send(404, {"error": "Not found."})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 4096 or self.headers.get("Content-Type") != "application/json":
                    return self.send(400, {"error": "Invalid request."})
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError("Invalid request.")
                self.send(201, connector.issue(body))
            except (ValueError, TypeError) as exc:
                self.send(400, {"error": str(exc)})
            except sqlite3.OperationalError as exc:
                reason = str(exc)
                print("Voucher save failed:", reason, flush=True)
                self.send(503, {"error": "Reception WiFi could not save the voucher: " + reason + ". Retry the same request after resolving this error."})
            except Exception as exc:
                print("Voucher save failed:", type(exc).__name__, str(exc), flush=True)
                self.send(503, {"error": "Reception WiFi write failed. Check the connector. Retry with the same request; it will not duplicate a saved voucher."})
    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", default=r"C:\Program Files (x86)\MyPublicWiFi\Data.db")
    parser.add_argument("--install", action="store_true", help="Install for this Windows user and start automatically at sign-in.")
    parser.add_argument("--background", action="store_true", help="Installed startup mode; do not print the pairing key.")
    parser.add_argument("--pair", action="store_true", help="Display the installed connector pairing key.")
    args = parser.parse_args()
    if args.install or args.background or args.pair:
        if os.name != 'nt':
            raise RuntimeError("Installation and startup are supported on Windows only.")
        folder = Path(os.environ['LOCALAPPDATA']) / 'VisionCo-WiFi-Connector'
        folder.mkdir(parents=True, exist_ok=True)
        # Restrict the persistent pairing key to the current Windows user and SYSTEM.
        if args.install:
            with socket.socket() as probe:
                try:
                    probe.bind(('127.0.0.1', PORT))
                except OSError:
                    raise RuntimeError('Stop the current connector before installing. Its local port is already in use.')
            sid = subprocess.check_output(['whoami', '/user', '/fo', 'csv', '/nh'], text=True).strip().split(',')[-1].strip('"')
            subprocess.run(['icacls', str(folder), '/inheritance:r', '/grant:r', f'*{sid}:(OI)(CI)F', '*S-1-5-18:(OI)(CI)F'], check=True, capture_output=True)
        key_path = folder / 'pairing-key.txt'
        if args.install and not key_path.exists():
            key_path.write_text(secrets.token_urlsafe(32), encoding='utf-8')
        if not key_path.exists():
            raise RuntimeError("Run with --install once before using the installed connector.")
        token = key_path.read_text(encoding='utf-8').strip()
        if args.pair:
            print("Pairing key (paste into the dashboard, not chat):\n" + token)
            return
        if args.install:
            import winreg
            target = folder / INSTALLED_FILENAME
            if Path(__file__).resolve() != target.resolve():
                shutil.copy2(__file__, target)
            pythonw = Path(sys.executable).with_name('pythonw.exe')
            if not pythonw.is_file():
                raise RuntimeError("pythonw.exe is missing. Use the normal foreground connector until Python is repaired.")
            # Validate and back up the database before enabling startup.
            Connector(args.database, Path.home() / 'VisionCo-WiFi-Backups')
            command = subprocess.list2cmdline([str(pythonw), str(target), '--background', '--database', str(Path(args.database).resolve())])
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Run') as key:
                winreg.SetValueEx(key, 'VisionCoWiFiConnector', 0, winreg.REG_SZ, command)
            subprocess.Popen([str(pythonw), str(target), '--background', '--database', str(Path(args.database).resolve())])
            print("Installed for this Windows user. Automatic startup is enabled at sign-in.")
            print("The installed pairing key is persistent and will be reused after Windows restarts.")
            print("Open " + ORIGIN + "/connect")
            print("Pairing key (paste into the dashboard, not chat):\n" + token)
            print("This starts the connector only. MyPublicWiFi's hotspot must also be running.")
            return
        log = open(folder / 'connector.log', 'a', encoding='utf-8', buffering=1)
        sys.stdout = sys.stderr = log
    else:
        token = secrets.token_urlsafe(32)
    if os.name == 'nt' and datetime.now().astimezone().utcoffset() != timedelta(hours=2):
        raise RuntimeError("Set Windows time zone to Harare (UTC+02:00) so dashboard and MyPublicWiFi deadlines agree, then restart the connector.")
    home = Path.home() / "VisionCo-WiFi-Backups"
    # Foreground keys last one launch. Installed keys stay in the protected user folder.
    connector = Connector(args.database, home)
    connector.tick()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), handler(connector, token))
    server.daemon_threads = True
    thread = threading.Thread(target=connector.watch, daemon=True)
    thread.start()
    print("\nVISIONCO WIFI CONNECTOR FINAL — PERSISTENT PAIRING + LIVE DEVICE STATUS\n")
    print("Database backup completed in:", home)
    print("Open:", ORIGIN + "/connect")
    if not args.background:
        print("Pairing key (paste into your dashboard; do not send in chat):\n" + token)
    if not args.background:
        print("\nKeep this window open. Press Ctrl+C to stop.")
    print("Database writes and deadline enforcement require a live MyPublicWiFi test.")
    print("Data balances are calculated as credit minus usage; compare with the app.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        connector.stop.set()
        server.server_close()
        thread.join(timeout=6)


def gui_install():
    """One-click install/update with no terminal required."""
    import io
    import ctypes
    import webbrowser

    MB_OK = 0x00000000
    MB_ICONINFO = 0x00000040
    MB_ICONERROR = 0x00000010

    def box(message, title="VisionCo WiFi"):
        ctypes.windll.user32.MessageBoxW(None, message, title, MB_OK | MB_ICONINFO)

    try:
        if os.name != "nt":
            raise RuntimeError("This installer is for Windows only.")

        # Find the current listener on the connector's fixed loopback port and
        # stop it only when it is a Python/VisionCo connector process.
        ps = (
            "$c=Get-NetTCPConnection -LocalPort %d -State Listen -ErrorAction SilentlyContinue | "
            "Select-Object -First 1; "
            "if($c){$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$c.OwningProcess); "
            "if($p.CommandLine -match 'VisionCo-WiFi-Connector|VisionCo-WiFi-FINAL'){"
            "Stop-Process -Id $c.OwningProcess -Force; Start-Sleep -Milliseconds 1200; "
            "Write-Output 'STOPPED'}else{Write-Output 'FOREIGN'}}"
        ) % PORT

        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        probe = subprocess.run(
            ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
            text=True, capture_output=True, creationflags=creationflags, timeout=15
        )
        if "FOREIGN" in (probe.stdout or ""):
            raise RuntimeError(
                "Port 18763 is being used by another program. The installer did not stop it."
            )

        # Reuse the existing protected pairing key. Run the connector's own
        # installer path in-process so no PowerShell/terminal is required.
        old_argv = sys.argv[:]
        old_out, old_err = sys.stdout, sys.stderr
        sys.argv = [str(Path(__file__).resolve()), "--install"]
        sys.stdout = io.StringIO()
        sys.stderr = io.StringIO()
        try:
            main()
        finally:
            sys.argv = old_argv
            sys.stdout, sys.stderr = old_out, old_err

        box(
            "VisionCo WiFi has been updated successfully.\n\n"
            "• Compatibility fixed\n"
            "• Existing pairing retained\n"
            "• Automatic Windows startup enabled\n"
            "• Device name and Connected/Disconnected status enabled\n\n"
            "The dashboard will now open. Refresh it once.",
            "VisionCo WiFi — Ready"
        )
        webbrowser.open(ORIGIN)

    except Exception as exc:
        ctypes.windll.user32.MessageBoxW(
            None,
            "VisionCo WiFi update failed:\n\n" + str(exc),
            "VisionCo WiFi — Update Error",
            MB_OK | MB_ICONERROR
        )


if __name__ == "__main__":
    try:
        if os.name == "nt" and len(sys.argv) == 1 and str(__file__).lower().endswith(".pyw"):
            gui_install()
        else:
            main()
    except Exception as exc:
        if os.name == "nt" and str(__file__).lower().endswith(".pyw"):
            try:
                import ctypes
                ctypes.windll.user32.MessageBoxW(
                    None,
                    "Connector could not start:\n\n" + str(exc),
                    "VisionCo WiFi",
                    0x10
                )
            except Exception:
                pass
        else:
            print("Connector could not start:", str(exc))
        raise SystemExit(1)

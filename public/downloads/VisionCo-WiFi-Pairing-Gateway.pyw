from __future__ import annotations

import argparse
import hmac
import json
import os
import secrets
import socket
import sys
import subprocess
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, Tuple

VERSION = "1.3.0"
DEFAULT_PORT = 18764
DEFAULT_UPSTREAM = "http://127.0.0.1:18763"
DEFAULT_ORIGINS = {
    "https://glass.visionpixels.autos",
    "http://127.0.0.1:8765",
    "http://localhost:8765",
    "http://127.0.0.1:18765",
    "http://localhost:18765",
}

APP_DIR = Path(os.environ.get("VISIONCO_CONNECTOR_DIR") or (Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "VisionCo-WiFi-Connector"))
PAIR_CODE_FILE = APP_DIR / "pairing-code.txt"
DASH_TOKEN_FILE = APP_DIR / "dashboard-token.txt"
UPSTREAM_KEY_FILE = APP_DIR / "pairing-key.txt"
ALLOWED_ORIGINS_FILE = APP_DIR / "allowed-origins.txt"
LOG_FILE = APP_DIR / "pairing-gateway.log"
GUEST_WIFI_TASK = "Windscreen Reception Guest WiFi Start"
GUEST_GATEWAY_IP = os.environ.get("WINDSCREEN_GUEST_GATEWAY_IP", "192.168.5.1")
_GUEST_STATUS_CACHE = {"at": 0.0, "value": False}

def wifi_engine_ready() -> bool:
    """Verify the real local voucher service through the already-running VisionCo Connector."""
    try:
        if not upstream_ready() or not UPSTREAM_KEY_FILE.exists():
            return False
        key = read_upstream_key()
        endpoint = os.environ.get("VISIONCO_UPSTREAM", DEFAULT_UPSTREAM).rstrip("/") + "/vouchers"
        req = urllib.request.Request(
            endpoint,
            method="GET",
            headers={
                "Authorization": "Bearer " + key,
                "Origin": "https://glass.visionpixels.autos",
                "Accept": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=3) as res:
            return 200 <= int(res.status) < 300
    except Exception:
        return False



def guest_wifi_online() -> bool:
    now = time.monotonic()
    if now - float(_GUEST_STATUS_CACHE.get("at", 0.0)) < 2.0:
        return bool(_GUEST_STATUS_CACHE.get("value", False))
    online = False
    try:
        proc = subprocess.run(["ipconfig"], capture_output=True, text=True, timeout=4, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        online = GUEST_GATEWAY_IP in (proc.stdout or "")
    except Exception:
        online = False
    _GUEST_STATUS_CACHE["at"] = now
    _GUEST_STATUS_CACHE["value"] = online
    return online

def wifi_app_running() -> bool:
    try:
        proc = subprocess.run(["tasklist.exe", "/FI", "IMAGENAME eq MyPublicWiFi.exe", "/FO", "CSV", "/NH"], capture_output=True, text=True, timeout=4, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return "MyPublicWiFi.exe".lower() in (proc.stdout or "").lower()
    except Exception:
        return False

def start_guest_wifi_task() -> tuple[bool, str]:
    if guest_wifi_online():
        return True, "Reception Guest WiFi is already online."
    try:
        proc = subprocess.run(["schtasks.exe", "/Run", "/TN", GUEST_WIFI_TASK], capture_output=True, text=True, timeout=8, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if proc.returncode != 0:
            log("Guest WiFi task failed: " + ((proc.stderr or proc.stdout or "unknown error").strip()))
            return False, "The Reception WiFi start control is not installed correctly."
        _GUEST_STATUS_CACHE["at"] = 0.0
        return True, "Starting Reception Guest WiFi."
    except Exception as exc:
        log("Guest WiFi start error: " + repr(exc))
        return False, "Reception Guest WiFi could not be started."

FAIL_LOCK = threading.Lock()
FAIL_STATE: Dict[str, Dict[str, float]] = {}
MAX_FAILURES = 5
LOCK_SECONDS = 60


def _atomic_write(path: Path, value: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(value, encoding="utf-8")
    os.replace(tmp, path)


def ensure_identity() -> Tuple[str, str]:
    APP_DIR.mkdir(parents=True, exist_ok=True)

    code = ""
    if PAIR_CODE_FILE.exists():
        code = PAIR_CODE_FILE.read_text(encoding="utf-8").strip()
    if not (len(code) == 6 and code.isdigit()):
        code = str(secrets.randbelow(1_000_000)).zfill(6)
        _atomic_write(PAIR_CODE_FILE, code)

    token = ""
    if DASH_TOKEN_FILE.exists():
        token = DASH_TOKEN_FILE.read_text(encoding="utf-8").strip()
    if len(token) < 32:
        token = secrets.token_urlsafe(48)
        _atomic_write(DASH_TOKEN_FILE, token)

    return code, token


def load_origins() -> set[str]:
    origins = set(DEFAULT_ORIGINS)
    extra = os.environ.get("VISIONCO_ALLOWED_ORIGINS", "")
    for item in extra.split(","):
        item = item.strip()
        if item:
            origins.add(item)
    if ALLOWED_ORIGINS_FILE.exists():
        for line in ALLOWED_ORIGINS_FILE.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                origins.add(line)
    return origins


def upstream_ready(host: str = "127.0.0.1", port: int = 18763) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.5):
            return True
    except OSError:
        return False


def read_upstream_key() -> str:
    if not UPSTREAM_KEY_FILE.exists():
        raise RuntimeError("The reception WiFi connector is not installed correctly.")
    key = UPSTREAM_KEY_FILE.read_text(encoding="utf-8").strip()
    if not key:
        raise RuntimeError("The reception WiFi connector is not ready.")
    return key


def log(message: str) -> None:
    try:
        APP_DIR.mkdir(parents=True, exist_ok=True)
        with LOG_FILE.open("a", encoding="utf-8") as fh:
            fh.write(time.strftime("%Y-%m-%d %H:%M:%S") + " " + message.replace("\n", " ") + "\n")
    except Exception:
        pass


def failure_status(client: str) -> Tuple[bool, int]:
    now = time.time()
    with FAIL_LOCK:
        state = FAIL_STATE.get(client)
        if not state:
            return False, 0
        until = float(state.get("lock_until", 0))
        if until > now:
            return True, int(until - now) + 1
        if until:
            FAIL_STATE.pop(client, None)
        return False, 0


def record_failure(client: str) -> None:
    now = time.time()
    with FAIL_LOCK:
        state = FAIL_STATE.setdefault(client, {"count": 0, "lock_until": 0})
        state["count"] = int(state.get("count", 0)) + 1
        if state["count"] >= MAX_FAILURES:
            state["count"] = 0
            state["lock_until"] = now + LOCK_SECONDS


def clear_failures(client: str) -> None:
    with FAIL_LOCK:
        FAIL_STATE.pop(client, None)


class GatewayHandler(BaseHTTPRequestHandler):
    server_version = "VisionCoWiFiGateway/" + VERSION

    def log_message(self, fmt, *args):
        log("HTTP " + (fmt % args))

    @property
    def pair_code(self) -> str:
        return self.server.pair_code  # type: ignore[attr-defined]

    @property
    def dashboard_token(self) -> str:
        return self.server.dashboard_token  # type: ignore[attr-defined]

    @property
    def upstream(self) -> str:
        return self.server.upstream  # type: ignore[attr-defined]

    @property
    def allowed_origins(self) -> set[str]:
        return self.server.allowed_origins  # type: ignore[attr-defined]

    def origin_ok(self) -> bool:
        origin = self.headers.get("Origin")
        if not origin:
            return True  # permits local diagnostics/curl; browser CORS still remains restricted.
        return origin in self.allowed_origins

    def send_json(self, status: int, payload: dict) -> None:
        raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        origin = self.headers.get("Origin")
        if origin and origin in self.allowed_origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def reject_origin(self) -> bool:
        if self.origin_ok():
            return False
        self.send_json(403, {"ok": False, "error": "This local connector only accepts the approved Windscreen dashboard."})
        return True

    def read_json(self, max_bytes: int = 8192) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ValueError("Invalid Content-Length")
        if length <= 0 or length > max_bytes:
            raise ValueError("Invalid request size")
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception as exc:
            raise ValueError("Invalid JSON") from exc
        if not isinstance(data, dict):
            raise ValueError("JSON object required")
        return data

    def authorized(self) -> bool:
        expected = "Bearer " + self.dashboard_token
        actual = self.headers.get("Authorization", "")
        if hmac.compare_digest(actual, expected):
            return True
        self.send_json(401, {"ok": False, "error": "This browser is not paired with the reception desktop."})
        return False

    def proxy_vouchers(self, method: str) -> None:
        if not self.authorized():
            return
        try:
            upstream_key = read_upstream_key()
            url = self.upstream.rstrip("/") + "/vouchers"
            body = None
            if method == "POST":
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                except ValueError:
                    return self.send_json(400, {"ok": False, "error": "Invalid request."})
                if length <= 0 or length > 8192:
                    return self.send_json(400, {"ok": False, "error": "Invalid request."})
                body = self.rfile.read(length)
            req = urllib.request.Request(
                url,
                data=body,
                method=method,
                headers={
                    "Authorization": "Bearer " + upstream_key,
                    "Origin": "https://glass.visionpixels.autos",
                    "Content-Type": self.headers.get("Content-Type", "application/json"),
                    "Accept": "application/json",
                },
            )
            try:
                with urllib.request.urlopen(req, timeout=8) as res:
                    raw = res.read()
                    status = res.status
            except urllib.error.HTTPError as exc:
                raw = exc.read()
                status = exc.code
            try:
                payload = json.loads(raw.decode("utf-8")) if raw else {}
            except Exception:
                payload = {"error": "The local connector returned an unreadable response."}

            def mask_vendor(value):
                if isinstance(value, str):
                    return (value
                            .replace("My" + "Public" + "WiFi", "Reception WiFi service")
                            .replace(("My" + "Public" + "WiFi").lower(), "Reception WiFi service")
                            .replace("MY PUBLIC WIFI", "RECEPTION WIFI SERVICE"))
                if isinstance(value, dict):
                    return {k: mask_vendor(v) for k, v in value.items()}
                if isinstance(value, list):
                    return [mask_vendor(v) for v in value]
                return value

            payload = mask_vendor(payload)
            self.send_json(status, payload if isinstance(payload, dict) else {"data": payload})
        except Exception as exc:
            log("Proxy error: " + repr(exc))
            self.send_json(503, {"ok": False, "error": "The reception WiFi connector is not ready on this computer."})

    def do_OPTIONS(self):
        if self.reject_origin():
            return
        self.send_response(204)
        origin = self.headers.get("Origin")
        if origin and origin in self.allowed_origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        if self.headers.get("Access-Control-Request-Private-Network") == "true":
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self):
        if self.reject_origin():
            return
        path = self.path.split("?", 1)[0]
        if path == "/health":
            main_ready = upstream_ready()
            bridge_ready = wifi_engine_ready()
            return self.send_json(200, {
                "ok": True,
                "gatewayVersion": VERSION,
                "connectorDetected": main_ready,
                "voucherBridgeDetected": bridge_ready,
                "guestWifiOnline": guest_wifi_online(),
                "wifiAppRunning": wifi_app_running(),
                "ready": bool(main_ready and UPSTREAM_KEY_FILE.exists()),
            })
        if path == "/wifi/status":
            if not self.authorized():
                return
            return self.send_json(200, {
                "ok": True,
                "online": guest_wifi_online(),
                "serviceRunning": wifi_app_running(),
                "connectorDetected": upstream_ready(),
            })
        if path == "/vouchers":
            return self.proxy_vouchers("GET")
        return self.send_json(404, {"ok": False, "error": "Not found."})

    def do_POST(self):
        if self.reject_origin():
            return
        path = self.path.split("?", 1)[0]
        if path == "/pair":
            client = self.client_address[0] if self.client_address else "local"
            locked, retry = failure_status(client)
            if locked:
                return self.send_json(429, {"ok": False, "error": "Too many incorrect codes. Try again shortly.", "retryAfterSeconds": retry})
            try:
                data = self.read_json(2048)
            except ValueError as exc:
                return self.send_json(400, {"ok": False, "error": str(exc)})
            code = str(data.get("code", "")).strip()
            if not (len(code) == 6 and code.isdigit() and hmac.compare_digest(code, self.pair_code)):
                record_failure(client)
                return self.send_json(401, {"ok": False, "error": "Incorrect connector code."})
            if not upstream_ready() or not UPSTREAM_KEY_FILE.exists():
                return self.send_json(503, {"ok": False, "error": "The reception WiFi connector is not running on this computer."})
            clear_failures(client)
            return self.send_json(200, {
                "ok": True,
                "paired": True,
                "token": self.dashboard_token,
                "message": "Reception desktop paired successfully.",
            })
        if path == "/wifi/start":
            if not self.authorized():
                return
            accepted, message = start_guest_wifi_task()
            return self.send_json(202 if accepted else 503, {
                "ok": accepted,
                "accepted": accepted,
                "online": guest_wifi_online(),
                "message": message,
            })
        if path == "/vouchers":
            return self.proxy_vouchers("POST")
        return self.send_json(404, {"ok": False, "error": "Not found."})


def main() -> int:
    parser = argparse.ArgumentParser(description="VisionCo local six-digit pairing gateway")
    parser.add_argument("--port", type=int, default=int(os.environ.get("VISIONCO_GATEWAY_PORT", DEFAULT_PORT)))
    parser.add_argument("--upstream", default=os.environ.get("VISIONCO_UPSTREAM", DEFAULT_UPSTREAM))
    parser.add_argument("--show-code", action="store_true")
    parser.add_argument("--health-check", action="store_true")
    args = parser.parse_args()

    code, token = ensure_identity()
    if args.show_code:
        print(code)
        return 0
    if args.health_check:
        print(json.dumps({
            "gatewayVersion": VERSION,
            "connectorDetected": upstream_ready(),
            "voucherBridgeDetected": wifi_engine_ready(),
            "guestWifiOnline": guest_wifi_online(),
            "wifiAppRunning": wifi_app_running(),
            "pairingCodePresent": len(code) == 6,
            "dashboardTokenPresent": len(token) >= 32,
        }, indent=2))
        return 0

    APP_DIR.mkdir(parents=True, exist_ok=True)
    log("Gateway starting on 127.0.0.1:%s" % args.port)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), GatewayHandler)
    server.pair_code = code
    server.dashboard_token = token
    server.upstream = args.upstream
    server.allowed_origins = load_origins()
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        log("Gateway stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


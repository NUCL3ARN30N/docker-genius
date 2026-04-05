import http.server
import json
import os
import platform
import socket
import sys
import argparse
import urllib.request
import urllib.parse
import threading
import signal
import shutil
import subprocess
import tempfile

DEFAULT_PORT = 9587
DEFAULT_HOST = "127.0.0.1"
DOCKER_SOCKET_PATHS = [
    "/var/run/docker.sock",
    os.path.expanduser("~/.docker/run/docker.sock"),
    "/run/docker.sock",
]
BUFFER_SIZE = 65536
VERSION = "1.2.0"

C_RESET  = "\033[0m"
C_BOLD   = "\033[1m"
C_DIM    = "\033[2m"
C_PURPLE = "\033[38;5;141m"
C_PINK   = "\033[38;5;211m"
C_GREEN  = "\033[38;5;114m"
C_RED    = "\033[38;5;203m"
C_CYAN   = "\033[38;5;117m"
C_YELLOW = "\033[38;5;221m"

def colorize(text, color):
    if not sys.stdout.isatty():
        return text
    return f"{color}{text}{C_RESET}"


def find_docker_socket():
    for path in DOCKER_SOCKET_PATHS:
        if os.path.exists(path):
            return path
    return None


def connect_docker_unix(socket_path):
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.connect(socket_path)
    sock.settimeout(120)
    return sock


def connect_docker_tcp(host, port):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.connect((host, int(port)))
    sock.settimeout(120)
    return sock


class DockerProxyHandler(http.server.BaseHTTPRequestHandler):
    docker_target = None

    def log_message(self, format, *args):
        method = args[0].split(" ")[0] if args else "?"
        path = args[0].split(" ")[1] if args and len(args[0].split(" ")) > 1 else "?"
        status = args[1] if len(args) > 1 else "?"
        mc = {"GET": C_GREEN, "POST": C_YELLOW, "PUT": C_CYAN, "DELETE": C_RED, "OPTIONS": C_DIM, "HEAD": C_DIM}.get(method, C_RESET)
        print(f"  {colorize(method, mc):>20s} {colorize(path, C_PURPLE)} -> {colorize(str(status), C_CYAN)}")

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Registry-Auth")
        self.send_header("Access-Control-Expose-Headers", "Content-Type, Docker-Content-Digest")
        self.send_header("Access-Control-Max-Age", "3600")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _json_response(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _proxy_request(self, method):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else b""
        try:
            if self.docker_target["type"] == "unix":
                sock = connect_docker_unix(self.docker_target["path"])
            else:
                sock = connect_docker_tcp(self.docker_target["host"], self.docker_target["port"])
        except Exception as e:
            return self._json_response(502, {"error": f"Cannot connect to Docker: {e}"})

        path = self.path
        raw = f"{method} {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n"
        if body:
            raw += f"Content-Length: {len(body)}\r\nContent-Type: {self.headers.get('Content-Type', 'application/json')}\r\n"
        raw += "\r\n"

        try:
            sock.sendall(raw.encode() + body)
            response_data = b""
            while True:
                try:
                    chunk = sock.recv(BUFFER_SIZE)
                    if not chunk:
                        break
                    response_data += chunk
                    if b"\r\n\r\n" in response_data:
                        hdr_end = response_data.index(b"\r\n\r\n") + 4
                        hdrs = response_data[:hdr_end].decode("utf-8", errors="replace")
                        cl = None
                        for line in hdrs.split("\r\n"):
                            if line.lower().startswith("content-length:"):
                                cl = int(line.split(":")[1].strip())
                                break
                        if cl is not None:
                            if len(response_data) - hdr_end >= cl:
                                break
                        elif "transfer-encoding: chunked" in hdrs.lower():
                            if response_data.endswith(b"0\r\n\r\n"):
                                break
                except socket.timeout:
                    break
            sock.close()

            if not response_data:
                return self._json_response(502, {"error": "Empty response from Docker"})

            hdr_end = response_data.index(b"\r\n\r\n") + 4
            hdrs = response_data[:hdr_end].decode("utf-8", errors="replace")
            body_data = response_data[hdr_end:]
            status_code = int(hdrs.split("\r\n")[0].split(" ")[1])

            if "transfer-encoding: chunked" in hdrs.lower():
                decoded = b""
                buf = body_data
                while buf:
                    le = buf.find(b"\r\n")
                    if le == -1: break
                    sz_str = buf[:le].decode().strip()
                    if not sz_str: buf = buf[le+2:]; continue
                    sz = int(sz_str, 16)
                    if sz == 0: break
                    decoded += buf[le+2:le+2+sz]
                    buf = buf[le+2+sz+2:]
                body_data = decoded

            self.send_response(status_code)
            self._cors()
            for line in hdrs.split("\r\n")[1:]:
                if ":" in line:
                    k, v = line.split(":", 1)
                    if k.strip().lower() in ("content-type", "docker-content-digest"):
                        self.send_header(k.strip(), v.strip())
            self.send_header("Content-Length", str(len(body_data)))
            self.end_headers()
            self.wfile.write(body_data)
        except Exception as e:
            try: sock.close()
            except: pass
            self._json_response(502, {"error": str(e)})

    # ── Route: Health ────────────────────────────
    def do_GET(self):
        if self.path == "/docker-genius-health":
            return self._json_response(200, {"status": "ok", "service": "docker-genius-proxy", "version": VERSION})

        # Route: Docker Hub search (bypasses Docker daemon entirely)
        if self.path.startswith("/docker-genius/hub/search"):
            return self._hub_search()

        self._proxy_request("GET")

    def do_POST(self):
        if self.path == "/docker-genius/compose/up":
            return self._handle_compose("up")
        if self.path == "/docker-genius/compose/down":
            return self._handle_compose("down")
        self._proxy_request("POST")

    def do_PUT(self):    self._proxy_request("PUT")
    def do_DELETE(self):  self._proxy_request("DELETE")
    def do_HEAD(self):   self._proxy_request("HEAD")
    def do_PATCH(self):  self._proxy_request("PATCH")

    # ── Docker Hub search via hub.docker.com API ─
    def _hub_search(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        term = qs.get("term", [""])[0]
        limit = qs.get("limit", ["20"])[0]

        if not term:
            return self._json_response(400, {"error": "Missing 'term' parameter"})

        url = f"https://hub.docker.com/v2/search/repositories/?query={urllib.parse.quote(term)}&page_size={limit}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "DockerGenius/1.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode())

            results = []
            for item in data.get("results", []):
                results.append({
                    "name": item.get("repo_name", item.get("name", "")),
                    "description": item.get("short_description", item.get("description", "")),
                    "star_count": item.get("star_count", 0),
                    "is_official": item.get("is_official", False),
                    "is_automated": item.get("is_automated", False),
                    "pull_count": item.get("pull_count", 0),
                })
            self._json_response(200, results)
        except Exception as e:
            self._json_response(502, {"error": f"Docker Hub unreachable: {e}"})

    # ── Compose deploy/teardown ──────────────────
    def _handle_compose(self, action):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else b""
        try:
            data = json.loads(body) if body else {}
        except Exception:
            data = {}

        yaml_content = data.get("yaml", "")
        project_name = data.get("project", "dg-stack")

        compose_bin = None
        for c in ["docker", "/usr/bin/docker", "/usr/local/bin/docker"]:
            if shutil.which(c):
                compose_bin = c
                break
        if not compose_bin:
            return self._json_response(500, {"error": "docker binary not found on host"})

        tmpdir = tempfile.mkdtemp(prefix="dg_compose_")
        compose_file = os.path.join(tmpdir, "docker-compose.yml")
        try:
            if action == "up":
                if not yaml_content.strip():
                    raise ValueError("Empty compose YAML")
                with open(compose_file, "w") as f:
                    f.write(yaml_content)
                cmd = [compose_bin, "compose", "-f", compose_file, "-p", project_name, "up", "-d", "--pull", "always"]
            else:
                if yaml_content.strip():
                    with open(compose_file, "w") as f:
                        f.write(yaml_content)
                    cmd = [compose_bin, "compose", "-f", compose_file, "-p", project_name, "down"]
                else:
                    cmd = [compose_bin, "compose", "-p", project_name, "down"]

            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            resp = {"ok": result.returncode == 0, "stdout": result.stdout, "stderr": result.stderr, "code": result.returncode}
        except subprocess.TimeoutExpired:
            resp = {"ok": False, "error": "Command timed out after 120s", "stdout": "", "stderr": ""}
        except Exception as e:
            resp = {"ok": False, "error": str(e), "stdout": "", "stderr": ""}
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)
        self._json_response(200, resp)


class ThreadedHTTPServer(http.server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True
    def process_request(self, request, client_address):
        t = threading.Thread(target=self.process_request_thread, args=(request, client_address))
        t.daemon = True
        t.start()
    def process_request_thread(self, request, client_address):
        try: self.finish_request(request, client_address)
        except Exception: self.handle_error(request, client_address)
        finally: self.shutdown_request(request)


def print_banner(host, port, target):
    print(f"\n  {colorize('Docker', C_BOLD)}{colorize('Genius', C_PURPLE)} {colorize('Proxy', C_PINK)} {colorize('v' + VERSION, C_DIM)}")
    print(f"  {colorize('Target:', C_DIM)}  {colorize(str(target), C_CYAN)}")
    print(f"  {colorize('Listen:', C_DIM)}  {colorize(f'http://{host}:{port}', C_GREEN)}")
    if host == "127.0.0.1":
        print(f"  {colorize('TIP:', C_YELLOW)} Use {colorize('--host 0.0.0.0', C_PURPLE)} to allow LAN access")
    else:
        print(f"  {colorize('WARNING:', C_RED)} Listening on all interfaces")
    print()


# =====================================================
#  Service management — install / uninstall / status
# =====================================================

SERVICE_NAME = "docker-genius"
SCRIPT_PATH = os.path.abspath(__file__)
PYTHON_PATH = sys.executable

def detect_os():
    s = platform.system().lower()
    if s == "linux": return "linux"
    if s == "darwin": return "macos"
    if s == "windows": return "windows"
    return s

def _systemd_unit(host, port, user, extra_args):
    return f"""[Unit]
Description=Docker Genius Proxy
After=docker.service network-online.target
Wants=docker.service

[Service]
Type=simple
User={user}
ExecStart={PYTHON_PATH} {SCRIPT_PATH} run --host {host} --port {port}{extra_args}
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
"""

def _launchd_plist(host, port, extra_args):
    args_list = f"""        <string>{PYTHON_PATH}</string>
        <string>{SCRIPT_PATH}</string>
        <string>run</string>
        <string>--host</string>
        <string>{host}</string>
        <string>--port</string>
        <string>{str(port)}</string>"""
    if extra_args.strip():
        for a in extra_args.strip().split():
            args_list += f"\n        <string>{a}</string>"
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.{SERVICE_NAME}.proxy</string>
    <key>ProgramArguments</key>
    <array>
{args_list}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/{SERVICE_NAME}.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/{SERVICE_NAME}.log</string>
</dict>
</plist>
"""

def _systemd_path():
    return f"/etc/systemd/system/{SERVICE_NAME}.service"

def _launchd_path():
    return os.path.expanduser(f"~/Library/LaunchAgents/com.{SERVICE_NAME}.proxy.plist")


def cmd_install(args):
    ostype = detect_os()
    host = args.host or "0.0.0.0"
    port = args.port or DEFAULT_PORT
    extra = ""
    if args.tcp: extra += f" --tcp {args.tcp}"
    if args.socket: extra += f" --socket {args.socket}"

    if ostype == "linux":
        path = _systemd_path()
        user = args.user or os.environ.get("USER", "root")
        unit = _systemd_unit(host, port, user, extra)
        print(f"\n  {colorize('Installing systemd service...', C_CYAN)}")
        print(f"  File: {colorize(path, C_PURPLE)}")
        print(f"  User: {colorize(user, C_GREEN)}")
        print(f"  Listen: {colorize(f'http://{host}:{port}', C_GREEN)}")

        if os.geteuid() != 0:
            print(f"\n  {colorize('Root required. Re-running with sudo...', C_YELLOW)}\n")
            cmd = ["sudo", PYTHON_PATH, SCRIPT_PATH, "install",
                   "--host", host, "--port", str(port), "--user", user]
            if args.tcp: cmd += ["--tcp", args.tcp]
            if args.socket: cmd += ["--socket", args.socket]
            os.execvp("sudo", cmd)
            return

        with open(path, "w") as f:
            f.write(unit)
        subprocess.run(["systemctl", "daemon-reload"], check=True)
        subprocess.run(["systemctl", "enable", SERVICE_NAME], check=True)
        subprocess.run(["systemctl", "start", SERVICE_NAME], check=True)
        print(f"\n  {colorize('[OK]', C_GREEN)} Service installed and started")
        print(f"  {colorize('Commands:', C_DIM)}")
        print(f"    sudo systemctl status {SERVICE_NAME}")
        print(f"    sudo systemctl stop {SERVICE_NAME}")
        print(f"    sudo journalctl -u {SERVICE_NAME} -f")
        print(f"    python {os.path.basename(SCRIPT_PATH)} uninstall")
        print()

    elif ostype == "macos":
        path = _launchd_path()
        plist = _launchd_plist(host, port, extra)
        print(f"\n  {colorize('Installing launchd agent...', C_CYAN)}")
        print(f"  File: {colorize(path, C_PURPLE)}")

        os.makedirs(os.path.dirname(path), exist_ok=True)
        # Unload first if exists
        if os.path.exists(path):
            subprocess.run(["launchctl", "unload", path], capture_output=True)
        with open(path, "w") as f:
            f.write(plist)
        subprocess.run(["launchctl", "load", path], check=True)
        print(f"\n  {colorize('[OK]', C_GREEN)} Agent installed and started")
        print(f"  {colorize('Commands:', C_DIM)}")
        print(f"    python {os.path.basename(SCRIPT_PATH)} status")
        print(f"    python {os.path.basename(SCRIPT_PATH)} logs")
        print(f"    python {os.path.basename(SCRIPT_PATH)} uninstall")
        print()

    elif ostype == "windows":
        task_name = "DockerGenius"
        cmd_str = f'{PYTHON_PATH} {SCRIPT_PATH} run --host {host} --port {port}{extra}'
        print(f"\n  {colorize('Installing Windows scheduled task...', C_CYAN)}")
        # Remove existing
        subprocess.run(["schtasks", "/delete", "/tn", task_name, "/f"], capture_output=True)
        result = subprocess.run([
            "schtasks", "/create", "/tn", task_name,
            "/tr", cmd_str, "/sc", "onlogon", "/rl", "highest"
        ], capture_output=True, text=True)
        if result.returncode == 0:
            # Also start now
            subprocess.run(["schtasks", "/run", "/tn", task_name], capture_output=True)
            print(f"\n  {colorize('[OK]', C_GREEN)} Task created and started")
            print(f"  {colorize('Commands:', C_DIM)}")
            print(f"    python {os.path.basename(SCRIPT_PATH)} status")
            print(f"    python {os.path.basename(SCRIPT_PATH)} uninstall")
        else:
            print(f"\n  {colorize('[FAIL]', C_RED)} {result.stderr.strip()}")
            print(f"  Try running as Administrator")
        print()
    else:
        print(f"\n  {colorize('Unsupported OS:', C_RED)} {ostype}")
        print(f"  Run manually: nohup python proxy.py --host 0.0.0.0 &")


def cmd_uninstall(args):
    ostype = detect_os()
    if ostype == "linux":
        path = _systemd_path()
        if os.geteuid() != 0:
            print(f"  {colorize('Re-running with sudo...', C_YELLOW)}")
            os.execvp("sudo", ["sudo", PYTHON_PATH, SCRIPT_PATH, "uninstall"])
            return
        subprocess.run(["systemctl", "stop", SERVICE_NAME], capture_output=True)
        subprocess.run(["systemctl", "disable", SERVICE_NAME], capture_output=True)
        if os.path.exists(path):
            os.remove(path)
        subprocess.run(["systemctl", "daemon-reload"], capture_output=True)
        print(f"\n  {colorize('[OK]', C_GREEN)} Service removed\n")

    elif ostype == "macos":
        path = _launchd_path()
        if os.path.exists(path):
            subprocess.run(["launchctl", "unload", path], capture_output=True)
            os.remove(path)
        print(f"\n  {colorize('[OK]', C_GREEN)} Agent removed\n")

    elif ostype == "windows":
        subprocess.run(["schtasks", "/end", "/tn", "DockerGenius"], capture_output=True)
        subprocess.run(["schtasks", "/delete", "/tn", "DockerGenius", "/f"], capture_output=True)
        print(f"\n  {colorize('[OK]', C_GREEN)} Task removed\n")


def cmd_status(args):
    ostype = detect_os()
    if ostype == "linux":
        r = subprocess.run(["systemctl", "is-active", SERVICE_NAME], capture_output=True, text=True)
        state = r.stdout.strip()
        color = C_GREEN if state == "active" else C_RED
        print(f"\n  {colorize('Service:', C_DIM)}  {colorize(state, color)}")
        if state == "active":
            r2 = subprocess.run(["systemctl", "show", SERVICE_NAME, "--property=MainPID,ActiveEnterTimestamp"],
                                capture_output=True, text=True)
            for line in r2.stdout.strip().split("\n"):
                k, v = line.split("=", 1)
                label = "PID" if "PID" in k else "Since"
                print(f"  {colorize(label + ':', C_DIM)}    {colorize(v, C_CYAN)}")
        installed = os.path.exists(_systemd_path())
        print(f"  {colorize('Startup:', C_DIM)}  {colorize('enabled' if installed else 'not installed', C_CYAN)}")
        print()

    elif ostype == "macos":
        path = _launchd_path()
        installed = os.path.exists(path)
        r = subprocess.run(["launchctl", "list"], capture_output=True, text=True)
        running = f"com.{SERVICE_NAME}.proxy" in r.stdout
        print(f"\n  {colorize('Installed:', C_DIM)} {colorize('yes' if installed else 'no', C_GREEN if installed else C_RED)}")
        print(f"  {colorize('Running:', C_DIM)}   {colorize('yes' if running else 'no', C_GREEN if running else C_RED)}")
        if installed:
            print(f"  {colorize('Log:', C_DIM)}       {colorize(f'/tmp/{SERVICE_NAME}.log', C_CYAN)}")
        print()

    elif ostype == "windows":
        r = subprocess.run(["schtasks", "/query", "/tn", "DockerGenius", "/fo", "LIST"],
                          capture_output=True, text=True)
        if r.returncode == 0:
            for line in r.stdout.strip().split("\n"):
                line = line.strip()
                if line and ":" in line:
                    print(f"  {line}")
        else:
            print(f"\n  {colorize('Not installed', C_RED)}\n")


def cmd_logs(args):
    ostype = detect_os()
    n = args.lines or 50
    if ostype == "linux":
        os.execvp("journalctl", ["journalctl", "-u", SERVICE_NAME, "-n", str(n), "-f"])
    elif ostype == "macos":
        logfile = f"/tmp/{SERVICE_NAME}.log"
        if os.path.exists(logfile):
            os.execvp("tail", ["tail", "-n", str(n), "-f", logfile])
        else:
            print(f"\n  {colorize('No log file found at', C_RED)} {logfile}\n")
    elif ostype == "windows":
        print(f"  Windows logs are in the Task Scheduler event history.")
        print(f"  Open Task Scheduler > DockerGenius > History")


def cmd_stop(args):
    ostype = detect_os()
    if ostype == "linux":
        if os.geteuid() != 0:
            os.execvp("sudo", ["sudo", PYTHON_PATH, SCRIPT_PATH, "stop"])
        subprocess.run(["systemctl", "stop", SERVICE_NAME])
        print(f"\n  {colorize('[OK]', C_GREEN)} Stopped\n")
    elif ostype == "macos":
        path = _launchd_path()
        if os.path.exists(path):
            subprocess.run(["launchctl", "unload", path])
            print(f"\n  {colorize('[OK]', C_GREEN)} Stopped (use 'install' to start again)\n")
    elif ostype == "windows":
        subprocess.run(["schtasks", "/end", "/tn", "DockerGenius"], capture_output=True)
        print(f"\n  {colorize('[OK]', C_GREEN)} Stopped\n")


def cmd_restart(args):
    ostype = detect_os()
    if ostype == "linux":
        if os.geteuid() != 0:
            os.execvp("sudo", ["sudo", PYTHON_PATH, SCRIPT_PATH, "restart"])
        subprocess.run(["systemctl", "restart", SERVICE_NAME])
        print(f"\n  {colorize('[OK]', C_GREEN)} Restarted\n")
    elif ostype == "macos":
        path = _launchd_path()
        if os.path.exists(path):
            subprocess.run(["launchctl", "unload", path], capture_output=True)
            subprocess.run(["launchctl", "load", path])
            print(f"\n  {colorize('[OK]', C_GREEN)} Restarted\n")
    elif ostype == "windows":
        subprocess.run(["schtasks", "/end", "/tn", "DockerGenius"], capture_output=True)
        subprocess.run(["schtasks", "/run", "/tn", "DockerGenius"])
        print(f"\n  {colorize('[OK]', C_GREEN)} Restarted\n")


def cmd_run(args):
    """Foreground run (used by service and direct invocation)."""
    host = args.host or DEFAULT_HOST
    port = args.port or DEFAULT_PORT

    if args.tcp:
        parts = args.tcp.split(":")
        DockerProxyHandler.docker_target = {"type": "tcp", "host": parts[0], "port": int(parts[1]) if len(parts) > 1 else 2375}
        target_display = f"tcp://{parts[0]}:{parts[1] if len(parts) > 1 else 2375}"
    else:
        sock_path = args.socket or find_docker_socket()
        if not sock_path:
            print(colorize("\n  Cannot find Docker socket!", C_RED))
            print(f"  Searched: {', '.join(DOCKER_SOCKET_PATHS)}")
            print(f"  Use --socket /path or --tcp host:port")
            sys.exit(1)
        if not os.access(sock_path, os.R_OK | os.W_OK):
            print(colorize(f"\n  Permission denied: {sock_path}", C_RED))
            print(f"  Fix: sudo usermod -aG docker $USER  (then re-login)")
            sys.exit(1)
        DockerProxyHandler.docker_target = {"type": "unix", "path": sock_path}
        target_display = f"unix://{sock_path}"

    # Test connection
    try:
        if DockerProxyHandler.docker_target["type"] == "unix":
            ts = connect_docker_unix(DockerProxyHandler.docker_target["path"])
        else:
            ts = connect_docker_tcp(DockerProxyHandler.docker_target["host"], DockerProxyHandler.docker_target["port"])
        ts.sendall(b"GET /_ping HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        ts.recv(4096)
        ts.close()
    except Exception as e:
        print(colorize(f"\n  Cannot reach Docker at {target_display}: {e}", C_RED))
        sys.exit(1)

    print_banner(host, port, target_display)
    server = ThreadedHTTPServer((host, port), DockerProxyHandler)
    signal.signal(signal.SIGINT, lambda *a: (print(f"\n  {colorize('Bye', C_DIM)}"), server.shutdown(), sys.exit(0)))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


def print_help():
    print(f"""
  {colorize('Docker', C_BOLD)}{colorize('Genius', C_PURPLE)} {colorize('Proxy', C_PINK)} {colorize('v' + VERSION, C_DIM)}

  {colorize('USAGE:', C_YELLOW)}
    python proxy.py [command] [options]

  {colorize('COMMANDS:', C_YELLOW)}
    {colorize('run', C_GREEN)}          Start proxy in foreground (default)
    {colorize('install', C_GREEN)}      Install as system service + start on boot
    {colorize('uninstall', C_GREEN)}    Remove system service
    {colorize('start', C_GREEN)}        Start the installed service
    {colorize('stop', C_GREEN)}         Stop the running service
    {colorize('restart', C_GREEN)}      Restart the service
    {colorize('status', C_GREEN)}       Show service status
    {colorize('logs', C_GREEN)}         Tail service logs

  {colorize('OPTIONS:', C_YELLOW)}
    --host HOST    Bind address (default: 127.0.0.1, use 0.0.0.0 for LAN)
    --port PORT    Listen port (default: 9587)
    --tcp H:P      Connect to Docker via TCP instead of socket
    --socket PATH  Custom Docker socket path
    --user USER    Service user (Linux install only, default: current)
    --lines N      Number of log lines to show (default: 50)

  {colorize('EXAMPLES:', C_YELLOW)}
    python proxy.py                          # Run in foreground
    python proxy.py install                  # Install + autostart
    python proxy.py install --host 0.0.0.0   # Install with LAN access
    python proxy.py status                   # Check if running
    python proxy.py logs                     # Tail live logs
    python proxy.py uninstall                # Remove service
""")


def main():
    # Parse command as first positional arg
    commands = ["run", "install", "uninstall", "start", "stop", "restart", "status", "logs", "help"]

    parser = argparse.ArgumentParser(
        description="Docker Genius CORS Proxy",
        add_help=False,
    )
    parser.add_argument("command", nargs="?", default="run", choices=commands + ["--help", "-h"])
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--tcp", metavar="HOST:PORT", default=None)
    parser.add_argument("--socket", metavar="PATH", default=None)
    parser.add_argument("--user", default=None)
    parser.add_argument("--lines", type=int, default=None)
    parser.add_argument("-h", "--help", action="store_true", default=False)

    args = parser.parse_args()

    if args.help or args.command in ("help", "--help", "-h"):
        print_help()
        return

    cmd_map = {
        "run": cmd_run,
        "install": cmd_install,
        "uninstall": cmd_uninstall,
        "start": lambda a: cmd_install(a) if not _is_installed() else cmd_restart(a),
        "stop": cmd_stop,
        "restart": cmd_restart,
        "status": cmd_status,
        "logs": cmd_logs,
    }

    handler = cmd_map.get(args.command, cmd_run)

    # Default host/port for run
    if args.command == "run":
        if args.host is None: args.host = DEFAULT_HOST
        if args.port is None: args.port = DEFAULT_PORT

    # Default for install
    if args.command == "install":
        if args.host is None: args.host = "0.0.0.0"
        if args.port is None: args.port = DEFAULT_PORT

    handler(args)


def _is_installed():
    ostype = detect_os()
    if ostype == "linux": return os.path.exists(_systemd_path())
    if ostype == "macos": return os.path.exists(_launchd_path())
    if ostype == "windows":
        r = subprocess.run(["schtasks", "/query", "/tn", "DockerGenius"], capture_output=True)
        return r.returncode == 0
    return False


if __name__ == "__main__":
    main()

"""Native Firefox smoke check: built extension, disposable profile, local fake API only."""

import contextlib
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

pending_request = threading.Event()
release_response = threading.Event()
requests = []


class Provider(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(f"<title>Synthetic {self.path}</title>".encode())

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        requests.append(body)
        tabs = json.loads(body["messages"][1]["content"])
        pending_request.set()
        release_response.wait(60)
        result = {
            "groups": [
                {
                    "name": "Docs",
                    "color": "blue",
                    "tabIds": [tab["id"] for tab in tabs[:2]],
                }
            ],
            "ungroupedTabIds": [tab["id"] for tab in tabs[2:]],
        }
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        with contextlib.suppress(BrokenPipeError, ConnectionResetError):
            self.wfile.write(
                json.dumps(
                    {"choices": [{"message": {"content": json.dumps(result)}}]}
                ).encode()
            )


server = ThreadingHTTPServer(("127.0.0.1", 0), Provider)
threading.Thread(target=server.serve_forever, daemon=True).start()
origin = f"http://127.0.0.1:{server.server_port}"

ROOT = Path(__file__).resolve().parents[1]
FIREFOX = os.environ.get("FIREFOX_BINARY") or (
    "/Applications/Firefox.app/Contents/MacOS/firefox"
    if sys.platform == "darwin"
    else shutil.which("firefox")
)
if not FIREFOX:
    raise SystemExit("Install Firefox or set FIREFOX_BINARY to its executable.")
ADDON = "ark-tabs-categoriser@ark"
UUID = "decade00-1111-4444-8888-000000000001"
with tempfile.TemporaryDirectory(prefix="ark-firefox-test-") as profile:
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()
    prefs = {
        "marionette.port": port,
        "intl.locale.requested": "en-US",
        "extensions.webextensions.uuids": json.dumps({ADDON: UUID}),
        "extensions.webextOptionalPermissionPrompts": False,
        "browser.shell.checkDefaultBrowser": False,
        "browser.startup.homepage": "about:blank",
        "browser.aboutwelcome.enabled": False,
        "datareporting.policy.dataSubmissionEnabled": False,
        "toolkit.telemetry.enabled": False,
    }
    Path(profile, "user.js").write_text(
        "\n".join(
            f"user_pref({json.dumps(k)}, {json.dumps(v)});" for k, v in prefs.items()
        )
    )
    with open(Path(profile, "firefox.log"), "w+") as log:
        child = subprocess.Popen(
            [
                FIREFOX,
                "--headless",
                "--no-remote",
                "--profile",
                profile,
                "--marionette",
                "--remote-allow-system-access",
                "about:blank",
            ],
            stdout=log,
            stderr=log,
        )
        try:
            deadline = time.monotonic() + 20
            while True:
                try:
                    conn = socket.create_connection(("127.0.0.1", port), timeout=65)
                    break
                except OSError:
                    if time.monotonic() > deadline:
                        raise
                    time.sleep(0.1)
            stream = conn.makefile("rb")

            def packet():
                size = b""
                while (char := stream.read(1)) != b":":
                    if not char:
                        raise EOFError()
                    size += char
                return json.loads(stream.read(int(size)))

            print("Protocol", packet(), flush=True)
            seq = 0

            def command(name, params=None):
                global seq
                seq += 1
                data = json.dumps([0, seq, name, params or {}]).encode()
                conn.sendall(str(len(data)).encode() + b":" + data)
                result = packet()
                assert result[1] == seq, result
                if result[2]:
                    raise RuntimeError(result[2])
                return result[3]

            def evaluate(body):
                result = command(
                    "WebDriver:ExecuteAsyncScript",
                    {
                        "script": "const done = arguments[arguments.length - 1]; (async () => {"
                        + body
                        + "})().then(value => done({ok: true, value}), error => done({ok: false, error: String(error), stack: error.stack}));",
                        "args": [],
                    },
                )
                result = result.get("value", result)
                assert result["ok"], result
                return result.get("value")

            session = command("WebDriver:NewSession", {"capabilities": {}})
            print("Firefox", session["capabilities"]["browserVersion"], flush=True)
            print(
                "Install",
                command(
                    "Addon:Install",
                    {"path": str(ROOT / ".output/firefox-mv3"), "temporary": True},
                ),
                flush=True,
            )
            command(
                "WebDriver:Navigate", {"url": f"moz-extension://{UUID}/options.html"}
            )
            initial = evaluate(
                "return {title: document.title, api: typeof browser, permissions: await browser.permissions.getAll()};"
            )
            assert initial["permissions"]["origins"] == [], initial
            assert initial["permissions"]["data_collection"] == [
                "authenticationInfo",
                "browsingActivity",
            ], initial
            print("Install and initial permission isolation passed", flush=True)
            evaluate(f"""
              document.querySelector('input[value="custom"]').click();
              for (const [id, value] of Object.entries({{ 'api-key': 'synthetic-test-key', model: 'synthetic-model', 'base-url': '{origin}/v1' }})) {{
                const input = document.getElementById(id); input.value = value;
                input.dispatchEvent(new Event('input', {{bubbles: true}}));
              }}
            """)
            element = command(
                "WebDriver:FindElement",
                {"using": "css selector", "value": "#save-settings"},
            )["value"]
            command("WebDriver:ElementClick", {"id": next(iter(element.values()))})

            def wait_for(expression):
                return evaluate(
                    "for (let i = 0; i < 200; i++) { const value = await ("
                    + expression
                    + '); if (value) return value; await new Promise(r => setTimeout(r, 50)); } throw new Error("Condition timed out: " + document.body.innerText);'
                )

            saved = wait_for(
                '(async () => (await browser.storage.local.get("arkSettings")).arkSettings)()'
            )
            assert saved["activeProvider"] == "custom", saved
            assert evaluate(
                'return await browser.permissions.contains({origins: ["http://127.0.0.1/*"]});'
            )
            print("Options save and native optional-origin request passed", flush=True)
            windows = evaluate(f"""
              const target = await browser.windows.create({{url: ['{origin}/a', '{origin}/b', '{origin}/c', '{origin}/pinned']}});
              await browser.tabs.update(target.tabs[3].id, {{pinned: true}});
              const oldGroup = await browser.tabs.group({{tabIds: target.tabs.slice(0,2).map(t => t.id), createProperties: {{windowId: target.id}}}});
              await browser.tabGroups.update(oldGroup, {{title: 'Before', color: 'red'}});
              const other = await browser.windows.create({{url: '{origin}/other'}});
              return {{target: target.id, other: other.id, ids: target.tabs.map(t => t.id), pinned: target.tabs[3].id}};
            """)
            target = windows["target"]
            evaluate(f"""
              window.testPort = browser.runtime.connect({{name: 'organise'}});
              window.testPort.onMessage.addListener(message => {{ if (message.type === 'state') window.testState = message; }});
              window.testPort.postMessage({{type: 'start', windowId: {target}}});
            """)
            assert pending_request.wait(10), "No provider request"
            assert len(requests) == 1
            sent_tabs = json.loads(requests[0]["messages"][1]["content"])
            assert len(sent_tabs) == 3 and all(
                "pinned" not in tab["url"] for tab in sent_tabs
            ), sent_tabs
            running = wait_for(
                'window.testState?.task?.phase === "running" && window.testState'
            )
            task_id = running["task"]["id"]
            command("WebDriver:Navigate", {"url": "about:blank"})
            # This delay tests the real default 30s event-page idle deadline with no open extension view.
            time.sleep(40)
            command(
                "WebDriver:Navigate", {"url": f"moz-extension://{UUID}/options.html"}
            )
            evaluate("""
              window.testPort = browser.runtime.connect({name: 'organise'});
              window.testPort.onMessage.addListener(message => { if (message.type === 'state') window.testState = message; });
            """)
            resumed = wait_for("window.testState")
            assert (
                resumed["task"]["id"] == task_id
                and resumed["task"]["phase"] == "running"
            ), resumed
            assert len(requests) == 1, "Reconnect duplicated a provider request"
            print(
                "Event page survived 40s with no view; reconnect did not resend",
                flush=True,
            )
            release_response.set()
            complete = wait_for(
                'window.testState?.task?.phase !== "running" && window.testState?.task?.phase !== "applying" && window.testState'
            )
            assert complete["task"]["phase"] == "complete", complete
            result = evaluate(
                f"""return {{tabs: await browser.tabs.query({{windowId: {target}}}), groups: await browser.tabGroups.query({{windowId: {target}}}), other: await browser.tabGroups.query({{windowId: {windows["other"]}}})}};"""
            )
            assert sorted(tab["id"] for tab in result["tabs"]) == sorted(
                windows["ids"]
            ), result
            assert (
                len(result["groups"]) == 1
                and result["groups"][0]["title"] == "Docs"
                and result["groups"][0]["color"] == "blue"
            ), result
            assert result["other"] == [], result
            assert next(
                tab for tab in result["tabs"] if tab["id"] == windows["pinned"]
            )["pinned"], result
            summary = evaluate(
                'return await browser.storage.session.get("organiseTask");'
            )
            assert "synthetic-test-key" not in json.dumps(
                summary
            ) and origin not in json.dumps(summary), summary
            print(
                "Native grouping/color/window pinning/pinned exclusion/session privacy passed",
                flush=True,
            )
            group_id = result["groups"][0]["id"]
            rename = evaluate(
                f"""await browser.windows.update({target}, {{focused: true}}); return await browser.runtime.sendMessage({{type: 'renameGroups', renames: [{{id: {group_id}, title: 'Renamed'}}]}});"""
            )
            assert rename["ok"], rename
            assert (
                evaluate(f"return (await browser.tabGroups.get({group_id})).title;")
                == "Renamed"
            )
            print("Native group rename passed", flush=True)
            release_response.clear()
            pending_request.clear()
            evaluate(
                f'window.testPort.postMessage({{type: "start", windowId: {target}}});'
            )
            assert pending_request.wait(10), "No second provider request"
            stopping = wait_for(
                'window.testState?.task?.phase === "running" && window.testState'
            )
            evaluate(
                f'window.testPort.postMessage({{type: "stop", id: {json.dumps(stopping["task"]["id"])}}});'
            )
            cancelled = wait_for(
                'window.testState?.task?.phase === "cancelled" && window.testState'
            )
            assert cancelled["task"]["phase"] == "cancelled"
            assert (
                evaluate(f"return (await browser.tabGroups.get({group_id})).title;")
                == "Renamed"
            )
            release_response.set()
            print("Native cancellation left groups unchanged", flush=True)
            command("WebDriver:Navigate", {"url": f"moz-extension://{UUID}/popup.html"})
            popup = wait_for(
                'document.querySelector("#popup-status")?.textContent === "Stopped. No tab-group changes were applied."'
            )
            print("Popup rendered:", popup, flush=True)
            command("WebDriver:DeleteSession")
        except Exception:
            log.flush()
            log.seek(0)
            print(log.read()[-6000:], flush=True)
            raise
        finally:
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
            release_response.set()
            server.shutdown()
            server.server_close()

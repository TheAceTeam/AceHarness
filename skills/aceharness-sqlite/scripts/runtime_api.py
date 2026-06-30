import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def load_env_file():
    current = os.getcwd()
    while True:
        candidate = os.path.join(current, ".agents", "runtime-database-env.json")
        if os.path.exists(candidate):
            try:
                with open(candidate, "r", encoding="utf-8") as handle:
                    data = json.load(handle)
                if isinstance(data, dict):
                    for key, value in data.items():
                        os.environ.setdefault(str(key), str(value))
            except Exception:
                pass
            return
        parent = os.path.dirname(current)
        if parent == current:
            return
        current = parent


load_env_file()


def runtime_url():
    value = os.environ.get("ACEHARNESS_RUNTIME_URL", "").strip().rstrip("/")
    if not value:
        print("ACEHARNESS_RUNTIME_URL is missing", file=sys.stderr)
        sys.exit(2)
    return value


def runtime_token():
    value = os.environ.get("ACEHARNESS_RUNTIME_TOKEN", "").strip()
    if not value:
        print("ACEHARNESS_RUNTIME_TOKEN is missing", file=sys.stderr)
        sys.exit(2)
    return value


def request_json(method, path, payload=None):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        runtime_url() + path,
        data=body,
        method=method,
        headers={
            "Authorization": "Bearer " + runtime_token(),
            "Content-Type": "application/json",
            "X-ACEHarness-Run-Id": os.environ.get("ACEHARNESS_RUN_ID", ""),
            "X-ACEHarness-Chat-Session-Id": os.environ.get("ACEHARNESS_CHAT_SESSION_ID", ""),
            "X-ACEHarness-Skill-Name": os.environ.get("ACEHARNESS_SKILL_NAME", "aceharness-sqlite"),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            print(resp.read().decode("utf-8"))
            return 0
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        print(text or json.dumps({"error": "HTTP_%s" % exc.code}), file=sys.stderr)
        return 3 if exc.code < 500 else 4
    except Exception as exc:
        print(json.dumps({"error": "RUNTIME_REQUEST_FAILED", "message": str(exc)}), file=sys.stderr)
        return 4


def encode_path(value):
    return urllib.parse.quote(value, safe="")


def parse_json_arg(value, default):
    if value is None:
        return default
    try:
        return json.loads(value)
    except Exception as exc:
        print("invalid JSON argument: %s" % exc, file=sys.stderr)
        sys.exit(2)

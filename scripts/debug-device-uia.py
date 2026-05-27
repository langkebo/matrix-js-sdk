import json
import ssl
import sys
import time
import urllib.error
import urllib.request

BASE_URL = "https://matrix.test"
USER = "sdk_testuser"
PASSWORD = "Test@123"


def request(method: str, path: str, body=None, token: str | None = None):
    ctx = ssl._create_unverified_context()
    data = None if body is None else json.dumps(body).encode()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(BASE_URL + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=20) as resp:
            raw = resp.read().decode("utf-8", "replace")
            try:
                parsed = json.loads(raw) if raw else {}
            except Exception:
                parsed = raw
            return resp.status, parsed
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            parsed = json.loads(raw) if raw else {}
        except Exception:
            parsed = raw
        return exc.code, parsed


def main():
    suffix = int(time.time() * 1000)
    device_a = f"SDK_UIA_A_{suffix}"
    device_b = f"SDK_UIA_B_{suffix}"

    status_a, login_a = request(
        "POST",
        "/_matrix/client/v3/login",
        {"type": "m.login.password", "user": USER, "password": PASSWORD, "device_id": device_a},
    )
    status_b, login_b = request(
        "POST",
        "/_matrix/client/v3/login",
        {"type": "m.login.password", "user": USER, "password": PASSWORD, "device_id": device_b},
    )
    print(json.dumps({"step": "login", "status_a": status_a, "status_b": status_b}, ensure_ascii=False))
    if status_a != 200 or status_b != 200:
        print(json.dumps({"login_a": login_a, "login_b": login_b}, ensure_ascii=False))
        return 0

    token_a = login_a["access_token"]
    token_b = login_b["access_token"]
    device_id_b = login_b["device_id"]
    resolved_user_id = login_a["user_id"]

    status_1, body_1 = request("DELETE", f"/_matrix/client/v3/devices/{device_id_b}", {}, token_a)
    print(json.dumps({"step": "first_delete", "status": status_1, "body": body_1}, ensure_ascii=False))

    session = body_1.get("session") if isinstance(body_1, dict) else None
    if session:
        auth = {
            "type": "m.login.password",
            "session": session,
            "user": resolved_user_id,
            "password": PASSWORD,
            "identifier": {"type": "m.id.user", "user": resolved_user_id},
        }
        status_2, body_2 = request("DELETE", f"/_matrix/client/v3/devices/{device_id_b}", {"auth": auth}, token_a)
        print(json.dumps({"step": "second_delete", "status": status_2, "body": body_2}, ensure_ascii=False))

    request("POST", "/_matrix/client/v3/logout", {}, token_a)
    request("POST", "/_matrix/client/v3/logout", {}, token_b)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

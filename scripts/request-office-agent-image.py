#!/usr/bin/env python3
"""Request a sprite sheet from an OpenAI-compatible image generation endpoint.

This intentionally uses only the Python standard library so custom image
gateways can be called without the OpenAI SDK.

Typical usage:
    IMAGE_API_KEY="sk-..." \\
      python3 scripts/request-office-agent-image.py \\
        --prompt-file prompts/office-agent.txt \\
        --out generated_assets/office-agent.png

Equivalent explicit usage for the PenguinSai gateway:
    python3 scripts/request-office-agent-image.py \\
      --endpoint https://api.penguinsaichat.dpdns.org/v1/images/generations \\
      --api-key "sk-..." \\
      --model gpt-image-2 \\
      --size 1024x1024 \\
      --prompt-file prompts/office-agent.txt \\
      --out generated_assets/office-agent.png \\
      --response-out generated_assets/office-agent.response.json

Parameter notes:
    --endpoint
        Image generation endpoint. Defaults to the PenguinSai-compatible
        /v1/images/generations path. If a caller passes /v1/images, this
        script normalizes it to /v1/images/generations because the gateway
        rejects POST /v1/images with "Invalid URL".

    --api-key
        API key for the endpoint. If omitted, the script reads IMAGE_API_KEY
        first, then OPENAI_API_KEY.

    --prompt-file
        UTF-8 text file containing the full image prompt.

    --out
        Destination image path. Parent directories are created automatically.

    --response-out
        Optional path for saving the raw JSON response, useful for debugging.

    --model / --size / --quality
        Sent directly in the JSON payload. Defaults are gpt-image-2,
        1024x1024, and medium.

    --codex-cli-body / --no-codex-cli-body
        codexCli=true is included in the JSON body by default. Use
        --no-codex-cli-body only for gateways that reject unknown fields.

    --codex-cli-query
        Also appends ?codexCli=true to the endpoint URL. Normally not needed
        for the current gateway because body mode works.

    --insecure / --no-auto-insecure
        The current custom gateway may fail local certificate-chain validation.
        By default, the script retries once with TLS verification disabled only
        when the failure is specifically SSLCertVerificationError. Use
        --insecure to skip verification immediately, or --no-auto-insecure to
        disable that retry behavior.

Expected response shapes:
    The script supports OpenAI-like responses where data[0] contains either
    b64_json, base64, image, or url. URL downloads reuse the same TLS mode that
    succeeded for the JSON request.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import socket
import ssl
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_ENDPOINT = "https://api2.penguinsaichat.dpdns.org/v1/images/generations"
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0 Safari/537.36"
)
RETRYABLE_HTTP_STATUS = {408, 409, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524}


class HttpStatusError(RuntimeError):
    def __init__(self, code: int, body: str, headers) -> None:
        super().__init__(f"HTTP {code}\n{body}")
        self.code = code
        self.body = body
        self.headers = headers


@dataclass(frozen=True)
class JsonResponse:
    body: dict
    endpoint: str
    insecure: bool


def with_query_flag(url: str, key: str, value: str) -> str:
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query[key] = value
    return urlunparse(parsed._replace(query=urlencode(query)))


def normalize_endpoint(endpoint: str) -> str:
    if endpoint.rstrip("/") == "https://api.penguinsaichat.dpdns.org/v1/images":
        return "https://api.penguinsaichat.dpdns.org/v1/images/generations"
    if endpoint.rstrip("/").endswith("/v1/images"):
        return endpoint.rstrip("/") + "/generations"
    return endpoint


def make_request(endpoint: str, payload: dict, api_key: str, user_agent: str) -> Request:
    return Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": user_agent,
        },
        method="POST",
    )


def read_json_response(request: Request, *, insecure: bool = False, timeout: float = 600) -> dict:
    context = ssl._create_unverified_context() if insecure else None
    try:
        with urlopen(request, timeout=timeout, context=context) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise HttpStatusError(error.code, body, error.headers) from error


def retry_delay_seconds(error: HttpStatusError, fallback: float) -> float:
    retry_after = error.headers.get("Retry-After") if error.headers else None
    if retry_after:
        try:
            return max(0.0, float(retry_after))
        except ValueError:
            pass
    try:
        body = json.loads(error.body)
    except json.JSONDecodeError:
        return fallback
    if isinstance(body, dict):
        value = body.get("retry_after")
        if isinstance(value, (int, float)):
            return max(0.0, float(value))
    return fallback


def request_json_once(
    endpoint: str,
    payload: dict,
    api_key: str,
    *,
    user_agent: str,
    insecure: bool,
    auto_insecure: bool,
    request_timeout: float,
) -> JsonResponse:
    request = make_request(endpoint, payload, api_key, user_agent)
    try:
        return JsonResponse(
            read_json_response(request, insecure=insecure, timeout=request_timeout),
            endpoint,
            insecure,
        )
    except URLError as error:
        if not auto_insecure or insecure or not isinstance(error.reason, ssl.SSLCertVerificationError):
            raise

    request = make_request(endpoint, payload, api_key, user_agent)
    return JsonResponse(
        read_json_response(request, insecure=True, timeout=request_timeout),
        endpoint,
        True,
    )


def request_json(
    endpoint: str,
    payload: dict,
    api_key: str,
    *,
    user_agent: str,
    insecure: bool,
    auto_insecure: bool,
    max_attempts: int,
    retry_delay: float,
    request_timeout: float,
) -> JsonResponse:
    last_error: HttpStatusError | None = None
    last_timeout: TimeoutError | socket.timeout | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            print(
                f"Requesting image: model={payload.get('model')} "
                f"size={payload.get('size')} quality={payload.get('quality')} "
                f"attempt={attempt}/{max_attempts}",
                flush=True,
            )
            return request_json_once(
                endpoint,
                payload,
                api_key,
                user_agent=user_agent,
                insecure=insecure,
                auto_insecure=auto_insecure,
                request_timeout=request_timeout,
            )
        except HttpStatusError as error:
            last_error = error
            if error.code not in RETRYABLE_HTTP_STATUS or attempt >= max_attempts:
                raise SystemExit(str(error)) from error
            delay = retry_delay_seconds(error, retry_delay)
            print(
                f"HTTP {error.code}; retrying in {delay:.0f}s "
                f"({attempt}/{max_attempts})",
                flush=True,
            )
            time.sleep(delay)
        except (TimeoutError, socket.timeout) as error:
            last_timeout = error
            if attempt >= max_attempts:
                raise SystemExit(f"Request timed out after {request_timeout:.0f}s.") from error
            print(
                f"Request timed out after {request_timeout:.0f}s; retrying in {retry_delay:.0f}s "
                f"({attempt}/{max_attempts})",
                flush=True,
            )
            time.sleep(retry_delay)

    if last_error:
        raise SystemExit(str(last_error))
    if last_timeout:
        raise SystemExit(f"Request timed out after {request_timeout:.0f}s.")
    raise SystemExit("Request failed.")


def extract_image(response: dict, output: Path, *, insecure: bool = False) -> None:
    data = response.get("data")
    if not isinstance(data, list) or not data:
        raise SystemExit(f"No image data in response:\n{json.dumps(response, ensure_ascii=False, indent=2)[:2000]}")

    first = data[0]
    if not isinstance(first, dict):
        raise SystemExit(f"Unexpected image item:\n{first!r}")

    b64 = first.get("b64_json") or first.get("base64") or first.get("image")
    if isinstance(b64, str) and b64:
        output.write_bytes(base64.b64decode(b64))
        return

    image_url = first.get("url")
    if isinstance(image_url, str) and image_url:
        context = ssl._create_unverified_context() if insecure else None
        request = Request(image_url, headers={"User-Agent": DEFAULT_USER_AGENT})
        with urlopen(request, timeout=600, context=context) as response:
            output.write_bytes(response.read())
        return

    raise SystemExit(f"Unsupported image response item:\n{json.dumps(first, ensure_ascii=False, indent=2)[:2000]}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    parser.add_argument("--api-key", default=os.environ.get("IMAGE_API_KEY") or os.environ.get("OPENAI_API_KEY"))
    parser.add_argument("--prompt-file", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--response-out")
    parser.add_argument("--model", default="gpt-image-2")
    parser.add_argument("--size", default="1024x1024")
    parser.add_argument("--quality", default="medium")
    parser.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    parser.add_argument("--max-attempts", type=int, default=3)
    parser.add_argument("--retry-delay", type=float, default=120)
    parser.add_argument("--request-timeout", type=float, default=600)
    parser.add_argument("--codex-cli-query", action="store_true")
    parser.add_argument("--codex-cli-body", action="store_true", default=True)
    parser.add_argument("--no-codex-cli-body", action="store_false", dest="codex_cli_body")
    parser.add_argument("--insecure", action="store_true", help="Disable TLS certificate verification for custom gateways.")
    parser.add_argument(
        "--no-auto-insecure",
        action="store_false",
        dest="auto_insecure",
        help="Do not retry with disabled TLS verification after a local certificate-chain failure.",
    )
    parser.set_defaults(auto_insecure=True)
    args = parser.parse_args()

    if not args.api_key:
        raise SystemExit("Missing API key. Pass --api-key or set IMAGE_API_KEY.")
    if args.max_attempts < 1:
        raise SystemExit("--max-attempts must be at least 1.")
    if args.retry_delay < 0:
        raise SystemExit("--retry-delay must be non-negative.")
    if args.request_timeout <= 0:
        raise SystemExit("--request-timeout must be positive.")

    prompt = Path(args.prompt_file).read_text(encoding="utf-8").strip()
    payload = {
        "model": args.model,
        "prompt": prompt,
        "size": args.size,
        "quality": args.quality,
        "output_format": "png",
        "n": 1,
    }
    if args.codex_cli_body:
        payload["codexCli"] = True

    endpoint = normalize_endpoint(args.endpoint)
    if args.codex_cli_query:
        endpoint = with_query_flag(endpoint, "codexCli", "true")

    result = request_json(
        endpoint,
        payload,
        args.api_key,
        user_agent=args.user_agent,
        insecure=args.insecure,
        auto_insecure=args.auto_insecure,
        max_attempts=args.max_attempts,
        retry_delay=args.retry_delay,
        request_timeout=args.request_timeout,
    )
    if args.response_out:
        Path(args.response_out).write_text(json.dumps(result.body, ensure_ascii=False, indent=2), encoding="utf-8")
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    extract_image(result.body, out, insecure=result.insecure)
    print(out)


if __name__ == "__main__":
    main()

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
import ssl
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_ENDPOINT = "https://api.penguinsaichat.dpdns.org/v1/images/generations"


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


def make_request(endpoint: str, payload: dict, api_key: str) -> Request:
    return Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )


def read_json_response(request: Request, *, insecure: bool = False) -> dict:
    context = ssl._create_unverified_context() if insecure else None
    try:
        with urlopen(request, timeout=600, context=context) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise SystemExit(f"HTTP {error.code}\n{body}") from error


def request_json(endpoint: str, payload: dict, api_key: str, *, insecure: bool, auto_insecure: bool) -> JsonResponse:
    request = make_request(endpoint, payload, api_key)
    try:
        return JsonResponse(read_json_response(request, insecure=insecure), endpoint, insecure)
    except URLError as error:
        if not auto_insecure or insecure or not isinstance(error.reason, ssl.SSLCertVerificationError):
            raise

    request = make_request(endpoint, payload, api_key)
    return JsonResponse(read_json_response(request, insecure=True), endpoint, True)


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
        with urlopen(image_url, timeout=600, context=context) as response:
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
        insecure=args.insecure,
        auto_insecure=args.auto_insecure,
    )
    if args.response_out:
        Path(args.response_out).write_text(json.dumps(result.body, ensure_ascii=False, indent=2), encoding="utf-8")
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    extract_image(result.body, out, insecure=result.insecure)
    print(out)


if __name__ == "__main__":
    main()

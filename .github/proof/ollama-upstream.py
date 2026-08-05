#!/usr/bin/env python3
import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote_plus


class ProofHandler(BaseHTTPRequestHandler):
    def log_message(self, _format: str, *_args: object) -> None:
        return

    def send_json(self, status: int, payload: object) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self.send_json(200, {"status": "ok"})
            return
        self.send_json(404, {"error": "not found"})

    def do_POST(self) -> None:
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length:
            self.rfile.read(content_length)
        if self.headers.get("X-Proof-Control") == "success":
            self.send_json(200, {"embeddings": [[3, 4]]})
            return
        self.send_json(
            429,
            {
                "error": "rate limit exceeded",
                "upstreamEcho": self.headers.get("X-Proof-Authorization-Component"),
                "proxyUpstreamEcho": self.headers.get(
                    "X-Proof-Proxy-Authorization-Component"
                ),
                "customUpstreamEcho": self.headers.get("X-Proof-Custom-Component"),
                "customFormUpstreamEcho": quote_plus(
                    self.headers.get("X-Proof-Custom-Component", "")
                ),
            },
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    ThreadingHTTPServer(("127.0.0.1", args.port), ProofHandler).serve_forever()


if __name__ == "__main__":
    main()

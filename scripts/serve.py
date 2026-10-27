"""Serve the static site on the web port leased by Cedros Code."""

import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class PreviewHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_head(self):
        # Preview edits can share a filesystem timestamp; always return fresh bytes.
        for header in ("If-Modified-Since", "If-None-Match"):
            if header in self.headers:
                del self.headers[header]
        return super().send_head()


def main():
    try:
        port = int(os.environ["APP_PORT_WEB"])
        if not 1 <= port <= 65535:
            raise ValueError()
    except (KeyError, ValueError):
        raise SystemExit(
            "Start the dev Run script in Cedros Code so its port manager sets APP_PORT_WEB."
        )

    root = Path(__file__).resolve().parent.parent
    handler = partial(PreviewHandler, directory=str(root))
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        print("Serving Solana Wallet Searcher at http://127.0.0.1:{}/".format(port), flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()

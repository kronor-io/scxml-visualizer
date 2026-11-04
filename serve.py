#!/usr/bin/env python3
"""Tiny static server for local development.

Same as `python3 -m http.server`, but tells the browser not to cache anything,
so edits show up on a plain refresh. Not needed for hosting: any static host
will do.
"""
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler) as httpd:
        print(f"Serving on http://127.0.0.1:{port}/")
        httpd.serve_forever()

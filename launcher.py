from __future__ import annotations

import multiprocessing
import socket
import threading
import time
import webbrowser

import uvicorn

from backend.app import app


HOST = "127.0.0.1"
DEFAULT_PORT = 8000
PORT_SCAN_LIMIT = 50


def find_available_port(start_port: int = DEFAULT_PORT) -> int:
    for port in range(start_port, start_port + PORT_SCAN_LIMIT):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            if sock.connect_ex((HOST, port)) != 0:
                return port

    raise RuntimeError("No available local port found")


def open_browser_later(url: str) -> None:
    time.sleep(1)
    webbrowser.open(url)


def main() -> None:
    port = find_available_port()
    url = f"http://{HOST}:{port}"
    threading.Thread(target=open_browser_later, args=(url,), daemon=True).start()
    uvicorn.run(app, host=HOST, port=port, log_level="warning", loop="asyncio", http="h11")


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()

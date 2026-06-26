import os
import socket
import threading
import time
import webbrowser
from pathlib import Path

import pystray
import uvicorn
from PIL import Image, ImageDraw


APP_NAME = "Fixture Forge"
HOST = "127.0.0.1"
PORT = int(os.getenv("FIXTURE_FORGE_PORT", "8765"))
URL = f"http://{HOST}:{PORT}"


def _data_dir() -> Path:
    root = os.getenv("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    path = Path(root) / APP_NAME / "data"
    path.mkdir(parents=True, exist_ok=True)
    return path


os.environ.setdefault("DATABASE_URL", f"sqlite:///{(_data_dir() / 'fixture-forge.db').as_posix()}")

from app.main import app  # noqa: E402


server: uvicorn.Server | None = None


def _icon_image() -> Image.Image:
    image = Image.new("RGBA", (64, 64), (10, 20, 24, 255))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((7, 7, 57, 57), radius=12, fill=(17, 34, 42, 255), outline=(255, 205, 0, 255), width=3)
    draw.polygon([(22, 16), (45, 31), (22, 48)], fill=(255, 205, 0, 255))
    draw.rectangle((17, 19, 25, 45), fill=(116, 93, 255, 255))
    return image


def _wait_until_ready(timeout: float = 12.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((HOST, PORT), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.2)
    return False


def _serve() -> None:
    global server
    config = uvicorn.Config(app, host=HOST, port=PORT, log_level="warning")
    server = uvicorn.Server(config)
    server.run()


def _open_browser() -> None:
    if _wait_until_ready():
        webbrowser.open(URL)


def _quit(icon: pystray.Icon, item: pystray.MenuItem | None = None) -> None:
    if server:
        server.should_exit = True
    icon.stop()


def main() -> None:
    thread = threading.Thread(target=_serve, name="fixture-forge-api", daemon=True)
    thread.start()
    threading.Thread(target=_open_browser, name="fixture-forge-open-browser", daemon=True).start()

    icon = pystray.Icon(
        "Fixture Forge",
        _icon_image(),
        APP_NAME,
        menu=pystray.Menu(
            pystray.MenuItem("打开 Fixture Forge", lambda icon, item: webbrowser.open(URL), default=True),
            pystray.MenuItem("退出并停止服务", _quit),
        ),
    )
    icon.run()

    if server:
        server.should_exit = True
    thread.join(timeout=5)


if __name__ == "__main__":
    main()

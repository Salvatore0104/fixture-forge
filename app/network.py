import ipaddress
import re
import socket
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed


def _local_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def _mask_for_ip(ip: str) -> str | None:
    try:
        output = subprocess.check_output(
            ["ipconfig"], text=True, encoding="gbk", errors="ignore", timeout=2
        )
    except Exception:
        return None
    current_ip = None
    for line in output.splitlines():
        ip_match = re.search(r"IPv4[^:]*:\s*([0-9.]+)", line)
        if ip_match:
            current_ip = ip_match.group(1)
            continue
        mask_match = re.search(r"(Subnet Mask|子网掩码)[^:]*:\s*([0-9.]+)", line)
        if mask_match and current_ip == ip:
            return mask_match.group(2)
    return None


def _network_for_ip(ip: str) -> ipaddress.IPv4Network:
    mask = _mask_for_ip(ip)
    if mask:
        try:
            return ipaddress.ip_network(f"{ip}/{mask}", strict=False)
        except ValueError:
            pass
    return ipaddress.ip_network(f"{ip}/24", strict=False)


def _tcp_open(ip: str, port: int, timeout: float) -> bool:
    try:
        with socket.create_connection((ip, port), timeout=timeout):
            return True
    except OSError:
        return False


def _http_ma_signature(ip: str, timeout: float) -> bool:
    try:
        with socket.create_connection((ip, 80), timeout=timeout) as sock:
            sock.settimeout(timeout)
            sock.sendall(b"GET / HTTP/1.0\r\nHost: fixture-forge-scan\r\n\r\n")
            data = sock.recv(2048).lower()
        return any(token in data for token in (b"grandma", b"ma lighting", b"ma remote", b"malighting"))
    except OSError:
        return False


def _hostname(ip: str) -> str:
    try:
        return socket.gethostbyaddr(ip)[0]
    except OSError:
        return ""


def _probe_host(ip: str, timeout: float, local_ip: str) -> dict | None:
    detected_by: list[str] = []
    web_port = None
    if _tcp_open(ip, 30000, timeout):
        detected_by.append("telnet30000")
    if _http_ma_signature(ip, timeout):
        detected_by.append("web80")
        web_port = 80
    is_local = ip in {"127.0.0.1", "localhost", local_ip}
    if not detected_by and not is_local:
        return None
    return {
        "ip": ip,
        "hostname": _hostname(ip),
        "remotePort": 30000,
        "webPort": web_port,
        "detectedBy": detected_by or ["local"],
        "isLocal": is_local,
    }


def scan_ma2_instances(timeout: float = 1.0) -> list[dict]:
    local_ip = _local_ip()
    network = _network_for_ip(local_ip)
    candidates = [str(ip) for ip in network.hosts()]
    if "127.0.0.1" not in candidates:
        candidates.insert(0, "127.0.0.1")

    found: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=50) as executor:
        futures = {executor.submit(_probe_host, ip, timeout, local_ip): ip for ip in candidates}
        for future in as_completed(futures):
            result = future.result()
            if result:
                found[result["ip"]] = result

    return sorted(found.values(), key=lambda item: (not item["isLocal"], item["ip"]))

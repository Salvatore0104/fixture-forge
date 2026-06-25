import ipaddress

from app import network


def test_scan_ma2_instances_detects_telnet_and_web(monkeypatch):
    monkeypatch.setattr(network, "_local_ip", lambda: "192.168.5.10")
    monkeypatch.setattr(network, "_network_for_ip", lambda ip: ipaddress.ip_network("192.168.5.0/30"))
    monkeypatch.setattr(network, "_hostname", lambda ip: "MAonPC-01" if ip == "192.168.5.1" else "")
    monkeypatch.setattr(network, "_tcp_open", lambda ip, port, timeout: ip == "192.168.5.1" and port == 30000)
    monkeypatch.setattr(network, "_http_ma_signature", lambda ip, timeout: ip == "192.168.5.1")

    result = network.scan_ma2_instances()

    assert result[0]["ip"] == "127.0.0.1"
    detected = next(item for item in result if item["ip"] == "192.168.5.1")
    assert detected["hostname"] == "MAonPC-01"
    assert detected["remotePort"] == 30000
    assert detected["webPort"] == 80
    assert detected["detectedBy"] == ["telnet30000", "web80"]

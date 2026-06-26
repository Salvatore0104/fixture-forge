import ipaddress

from app import network


def test_scan_ma2_instances_detects_telnet_and_web(monkeypatch):
    monkeypatch.setattr(network, "_local_ip", lambda: "192.168.5.10")
    monkeypatch.setattr(network, "_network_for_ip", lambda ip: ipaddress.ip_network("192.168.5.0/30"))
    monkeypatch.setattr(network, "_hostname", lambda ip: "MAonPC-01" if ip == "192.168.5.1" else "")
    monkeypatch.setattr(network, "_ma2_telnet_signature", lambda ip, timeout: ip == "192.168.5.1")
    monkeypatch.setattr(network, "_http_ma_signature", lambda ip, timeout: ip == "192.168.5.1")

    result = network.scan_ma2_instances()

    assert all(item["ip"] != "127.0.0.1" for item in result)
    detected = next(item for item in result if item["ip"] == "192.168.5.1")
    assert detected["hostname"] == "MAonPC-01"
    assert detected["remotePort"] == 30000
    assert detected["webPort"] == 80
    assert detected["detectedBy"] == ["ma2-telnet30000", "ma2-web80"]


def test_scan_ma2_instances_ignores_open_non_ma2_port(monkeypatch):
    monkeypatch.setattr(network, "_local_ip", lambda: "192.168.5.10")
    monkeypatch.setattr(network, "_network_for_ip", lambda ip: ipaddress.ip_network("192.168.5.0/30"))
    monkeypatch.setattr(network, "_ma2_telnet_signature", lambda ip, timeout: False)
    monkeypatch.setattr(network, "_http_ma_signature", lambda ip, timeout: False)

    assert network.scan_ma2_instances() == []

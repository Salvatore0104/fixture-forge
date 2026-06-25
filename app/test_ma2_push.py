from app.formats import push_ma2_to_onpc
from app.schemas import FixtureDocument


class DummySocket:
    def __init__(self, sent, feedback=None):
        self.sent = sent
        self.feedback = list(feedback or [])
        self.reads = 0
        self.pending = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def settimeout(self, timeout):
        self.timeout = timeout

    def sendall(self, data):
        self.sent.append(data.decode("utf-8").strip())
        self.pending = self.feedback.pop(0) if self.feedback else None

    def recv(self, size):
        if self.reads == 0 and self.feedback:
            self.reads += 1
            return self.feedback.pop(0)
        if self.pending is not None:
            data = self.pending
            self.pending = None
            return data
        raise TimeoutError()


def fixture_doc():
    return FixtureDocument.model_validate({
        "id": "fixture-1",
        "name": "Wash",
        "shortName": "Wash",
        "manufacturer": {"id": "manu-1", "name": "Manu", "shortName": "M"},
        "category": "Moving Head",
        "modes": [{
            "id": "mode-1",
            "name": "Basic",
            "channels": [{
                "id": "ch-1",
                "address": 1,
                "attribute": "DIM",
                "group": "DIMMER",
                "name": "Dimmer",
                "resolution": 8,
                "byteOrder": "MSB",
                "defaultValue": 0,
                "highlightValue": 255,
                "ueAttribute": "Dimmer",
                "functions": [],
            }],
        }],
        "wheels": [],
    })


def patch_item():
    return {"fixtureId": "fixture-1", "fid": 7, "modeName": "Basic", "universe": 2, "address": 33, "name": "Wash_0007"}


def test_push_ma2_local_imports_fixturetype_and_layer(monkeypatch, tmp_path):
    sent = []
    feedback = [
        b"banner\r\n",
        b"Logged in as User 'administrator'\r\n",
        b"Executing : ChangeDest /\r\n",
        b"Executing : ChangeDest EditSetup\r\n",
        b"Executing : ChangeDest FixtureTypes\r\n",
        b'1 object(s) from "Manu_Wash_Basic.xml" imported.\r\n',
        b"FixtureType 16 16   Wash                  Wash                  Manu\r\n",
        b"Executing : ChangeDest /\r\n",
        b"Executing : ChangeDest Root\r\n",
        b"WARNING, NO OBJECTS FOUND FOR LIST\r\n",
        b"Executing : ChangeDest EditSetup\r\n",
        b"Executing : ChangeDest Layers\r\n",
        b'1 object(s) from "Scene_layer.xml" imported.\r\n',
        b"Executing : ChangeDest Root\r\n",
    ]
    monkeypatch.setattr("app.formats.socket.create_connection", lambda *args, **kwargs: DummySocket(sent, feedback))
    monkeypatch.setattr("app.formats.time.sleep", lambda delay: None)
    monkeypatch.setattr("app.formats._ma2_data_dir", lambda kind: str(tmp_path))

    result = push_ma2_to_onpc(
        {"fixture-1": fixture_doc()},
        [patch_item()],
        "Scene",
        username="administrator",
        password="admin",
    )

    assert result["success"] is True
    assert sent[0] == 'Login "administrator" "admin"'
    assert any(command.startswith('Import "') for command in sent)
    assert "CD Layers" in sent
    assert 'Import "Scene_layer.xml"' in sent
    assert "Assign Fixture 7 At DMX 2.33" not in sent


def test_push_ma2_remote_skips_local_import_and_warns(monkeypatch):
    sent = []
    monkeypatch.setattr("app.formats.socket.create_connection", lambda *args, **kwargs: DummySocket(sent))
    monkeypatch.setattr("app.formats.time.sleep", lambda delay: None)

    result = push_ma2_to_onpc(
        {"fixture-1": fixture_doc()},
        [patch_item()],
        "Scene",
        ma2_ip="192.168.5.50",
        username="administrator",
        password="admin",
    )

    assert result["success"] is True
    assert not any(command.startswith('Import "') for command in sent)
    assert result["warnings"]
    assert "Assign Fixture 7 At DMX 2.33" in sent


def test_push_ma2_stops_after_editsetup_rejected(monkeypatch, tmp_path):
    sent = []
    feedback = [
        b"banner\r\n",
        b"Logged in as User 'administrator'\r\n",
        b"Executing : ChangeDest /\r\n",
        b"Error : ChangeDest EditSetup\r\nError #22: CANNOT ENTER DESTINATION\r\n",
    ]
    monkeypatch.setattr("app.formats.socket.create_connection", lambda *args, **kwargs: DummySocket(sent, feedback))
    monkeypatch.setattr("app.formats.time.sleep", lambda delay: None)
    monkeypatch.setattr("app.formats._ma2_data_dir", lambda kind: str(tmp_path))

    result = push_ma2_to_onpc(
        {"fixture-1": fixture_doc()},
        [patch_item()],
        "Scene",
        username="administrator",
        password="admin",
    )

    assert result["success"] is False
    assert "CD EditSetup" in sent
    assert not any(command.startswith("Import ") for command in sent)
    assert not any(command.startswith("Assign Fixture ") for command in sent)
    assert any("EditSetup" in warning for warning in result["warnings"])


def test_push_ma2_returns_to_root_before_layer_import(monkeypatch, tmp_path):
    sent = []
    feedback = [
        b"banner\r\n",
        b"Logged in as User 'administrator'\r\n",
        b"Executing : ChangeDest /\r\n",
        b"Executing : ChangeDest EditSetup\r\n",
        b"Executing : ChangeDest FixtureTypes\r\n",
        b'1 object(s) from "Manu_Wash_Basic.xml" imported.\r\n',
        b"FixtureType 16 16   Wash                  Wash                  Manu\r\n",
        b"Executing : ChangeDest /\r\n",
        b"Executing : ChangeDest Root\r\n",
        b"WARNING, NO OBJECTS FOUND FOR LIST\r\n",
        b"Executing : ChangeDest EditSetup\r\n",
        b"Executing : ChangeDest Layers\r\n",
        b'1 object(s) from "Scene_layer.xml" imported.\r\n',
        b"Executing : ChangeDest Root\r\n",
    ]
    monkeypatch.setattr("app.formats.socket.create_connection", lambda *args, **kwargs: DummySocket(sent, feedback))
    monkeypatch.setattr("app.formats.time.sleep", lambda delay: None)
    monkeypatch.setattr("app.formats._ma2_data_dir", lambda kind: str(tmp_path))

    result = push_ma2_to_onpc(
        {"fixture-1": fixture_doc()},
        [patch_item()],
        "Scene",
        username="administrator",
        password="admin",
    )

    assert result["success"] is True
    import_index = sent.index('Import "Manu_Wash_Basic.xml"')
    assert sent[import_index + 1] == "List"
    assert sent[import_index + 2] == "CD /"
    assert sent[import_index + 3] == "CD Root"
    assert sent[import_index + 4] == "List Fixture 7"
    assert "CD Layers" in sent


def test_push_ma2_errors_without_fixturetype_numbers_for_layer(monkeypatch):
    sent = []
    feedback = [
        b"banner\r\n",
        b"Logged in as User 'administrator'\r\n",
        b"Executing : ChangeDest /\r\n",
        b"Executing : ChangeDest Root\r\n",
        b"WARNING, NO OBJECTS FOUND FOR LIST\r\n",
    ]
    monkeypatch.setattr("app.formats.socket.create_connection", lambda *args, **kwargs: DummySocket(sent, feedback))
    monkeypatch.setattr("app.formats.time.sleep", lambda delay: None)

    result = push_ma2_to_onpc(
        {"fixture-1": fixture_doc()},
        [patch_item()],
        "Scene",
        username="administrator",
        password="admin",
        options={"importFixtureTypes": False, "patchFixtures": True, "labelFixtures": True},
    )

    assert result["success"] is False
    assert "Assign Fixture 7 At DMX 2.33" not in sent
    assert any("FixtureType number" in error for error in result["errors"])

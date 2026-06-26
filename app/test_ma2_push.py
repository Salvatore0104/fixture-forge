from app.formats import export_ma2, push_ma2_to_onpc
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
                "highlightValue": 100,
                "ueAttribute": "Dimmer",
                "functions": [],
            }],
        }],
        "wheels": [],
    })


def test_export_ma2_converts_default_to_dmx_but_keeps_highlight_percent():
    fixture = fixture_doc()
    channel = fixture.modes[0].channels[0]
    channel.defaultValue = 50
    channel.highlightValue = 100

    xml = export_ma2(fixture)

    assert b'default="128"' in xml
    assert b'highlight_value="100"' in xml
    assert b'from="0"' in xml
    assert b'to="100"' in xml


def test_export_ma2_zero_highlight_value_exports_none():
    fixture = fixture_doc()
    fixture.modes[0].channels[0].highlightValue = 0

    xml = export_ma2(fixture)

    assert b'highlight_value="None"' in xml
    assert b'highlight_value="0"' not in xml


def patch_item():
    return {"fixtureId": "fixture-1", "fid": 7, "modeName": "Basic", "universe": 2, "address": 33, "name": "Wash_0007"}


def overwrite_feedback():
    return [
        b"banner\r\n",
        b"Logged in as User 'administrator'\r\n",
        b"Executing : ChangeDest /\r\n",
        b"Executing : ChangeDest EditSetup\r\n",
        b"Executing : ChangeDest FixtureTypes\r\n",
        b"WARNING, NO OBJECTS FOUND FOR LIST\r\n",
        b'1 object(s) from "Manu_Wash_Basic.xml" imported.\r\n',
        b"FixtureType 16 16   Wash                  Wash                  Manu\r\n",
        b"Executing : ChangeDest /\r\n",
        b"Executing : ChangeDest EditSetup\r\n",
        b"Executing : ChangeDest Layers\r\n",
        b"WARNING, NO OBJECTS FOUND FOR LIST\r\n",
        b'1 object(s) from "Scene_Universe_002.xml" imported.\r\n',
        b"Executing : ChangeDest Root\r\n",
    ]


def missing_fixturetype_feedback():
    return [
        b"banner\r\n",
        b"Logged in as User 'administrator'\r\n",
        b"Executing : ChangeDest /\r\n",
        b"Executing : ChangeDest EditSetup\r\n",
        b"Executing : ChangeDest FixtureTypes\r\n",
        b'Error : Delete FixtureType "Wash"\r\nError #14: OBJECT DOES NOT EXIST\r\n',
        b'1 object(s) from "Manu_Wash_Basic.xml" imported.\r\n',
        b"FixtureType 16 16   Wash                  Wash                  Manu\r\n",
        b"Executing : ChangeDest /\r\n",
        b"Executing : ChangeDest EditSetup\r\n",
        b"Executing : ChangeDest Layers\r\n",
        b"WARNING, NO OBJECTS FOUND FOR LIST\r\n",
        b'1 object(s) from "Scene_Universe_002.xml" imported.\r\n',
        b"Executing : ChangeDest Root\r\n",
    ]


def new_show_feedback():
    return [
        b"banner\r\n",
        b"Logged in as User 'administrator'\r\n",
        b"New show created\r\n",
        b"Executing : ChangeDest /\r\n",
        b"Executing : ChangeDest EditSetup\r\n",
        b"Executing : ChangeDest FixtureTypes\r\n",
        b'1 object(s) from "Manu_Wash_Basic.xml" imported.\r\n',
        b"FixtureType 16 16   Wash                  Wash                  Manu\r\n",
        b"Executing : ChangeDest /\r\n",
        b"Executing : ChangeDest EditSetup\r\n",
        b"Executing : ChangeDest Layers\r\n",
        b'1 object(s) from "Scene_Universe_002.xml" imported.\r\n',
        b"Executing : ChangeDest Root\r\n",
    ]


def test_push_ma2_overwrite_creates_new_show_without_deleting_existing_objects(monkeypatch, tmp_path):
    sent = []
    monkeypatch.setattr("app.formats.socket.create_connection", lambda *args, **kwargs: DummySocket(sent, new_show_feedback()))
    monkeypatch.setattr("app.formats.time.sleep", lambda delay: None)
    monkeypatch.setattr("app.formats._ma2_data_dir", lambda kind: str(tmp_path))

    result = push_ma2_to_onpc(
        {"fixture-1": fixture_doc()},
        [patch_item()],
        "Scene",
        username="administrator",
        password="admin",
        options={"mode": "overwrite"},
    )

    assert result["success"] is True
    assert 'NewShow "Scene" /nc' in sent
    assert not any(command.startswith("Delete FixtureType ") for command in sent)
    assert not any(command.startswith("Delete Layer ") for command in sent)
    assert 'Import "Manu_Wash_Basic.xml"' in sent
    assert 'Import "Scene_Universe_002.xml"' in sent


def test_push_ma2_ignores_missing_fixturetype_on_first_import(monkeypatch, tmp_path):
    sent = []
    monkeypatch.setattr("app.formats.socket.create_connection", lambda *args, **kwargs: DummySocket(sent, missing_fixturetype_feedback()))
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
    assert 'Delete FixtureType "Wash"' in sent
    assert 'Import "Manu_Wash_Basic.xml"' in sent
    assert not any("OBJECT DOES NOT EXIST" in error for error in result["errors"])


def test_push_ma2_local_replaces_fixturetype_and_overwrites_universe_layer(monkeypatch, tmp_path):
    sent = []
    monkeypatch.setattr("app.formats.socket.create_connection", lambda *args, **kwargs: DummySocket(sent, overwrite_feedback()))
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
    assert 'Delete FixtureType "Wash"' in sent
    assert 'Import "Manu_Wash_Basic.xml"' in sent
    assert 'Delete Layer "Scene_Universe_002"' in sent
    assert 'Import "Scene_Universe_002.xml"' in sent
    assert "Assign Fixture 7 At DMX 2.33" not in sent


def test_push_ma2_remote_requires_local_onpc_for_overwrite(monkeypatch):
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

    assert result["success"] is False
    assert not any(command.startswith("Import ") for command in sent)
    assert not any(command.startswith("Assign Fixture ") for command in sent)
    assert any("same computer" in error for error in result["errors"])


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


def test_push_ma2_imports_layer_after_returning_to_layers_root(monkeypatch, tmp_path):
    sent = []
    monkeypatch.setattr("app.formats.socket.create_connection", lambda *args, **kwargs: DummySocket(sent, overwrite_feedback()))
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
    assert sent[import_index + 3] == "CD EditSetup"
    assert sent[import_index + 4] == "CD Layers"


def test_push_ma2_requires_fixturetype_import_for_overwrite(monkeypatch):
    sent = []
    feedback = [
        b"banner\r\n",
        b"Logged in as User 'administrator'\r\n",
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
    assert any("FixtureType import is required" in error for error in result["errors"])

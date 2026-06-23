from typing import Literal
from pydantic import BaseModel, Field

class ChannelFunction(BaseModel):
    id: str
    name: str = "默认"
    dmxFrom: int = 0
    dmxTo: int = 255
    physicalFrom: float = 0
    physicalTo: float = 1
    attribute: str = "DIM"

class WheelSlot(BaseModel):
    id: str
    name: str
    color: str | None = None
    image: str | None = None
    dmxFrom: int = 0
    dmxTo: int = 255

class Wheel(BaseModel):
    id: str
    name: str
    slots: list[WheelSlot] = []

class DmxChannel(BaseModel):
    id: str
    address: int = Field(ge=1, le=512)
    attribute: str = "DIM"
    group: str = "DIMMER"
    name: str = "调光"
    resolution: Literal[8, 16, 24, 32] = 8
    byteOrder: Literal["MSB", "LSB"] = "MSB"
    defaultValue: int = 0
    highlightValue: int = 255
    physicalFrom: float = 0
    physicalTo: float = 1
    unit: str = "Percent"
    inverted: bool = False
    ueAttribute: str = "Dimmer"
    functions: list[ChannelFunction] = []

class FixtureMode(BaseModel):
    id: str
    name: str
    channels: list[DmxChannel] = []

class Manufacturer(BaseModel):
    id: str
    name: str
    shortName: str = ""

class FixtureDocument(BaseModel):
    id: str
    schemaVersion: str = "1.0"
    revision: int = 0
    name: str
    shortName: str = ""
    manufacturer: Manufacturer
    category: str = "Other"
    version: str = "1.0"
    notes: str = ""
    modes: list[FixtureMode]
    wheels: list[Wheel] = []

class Preset(BaseModel):
    id: str
    name: str
    kind: Literal["channel", "mode", "fixture"]
    manufacturer: str = "通用"
    tags: list[str] = []
    description: str = ""
    version: str = "1.0"
    payload: dict


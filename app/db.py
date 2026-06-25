import json, os
from pathlib import Path
from datetime import datetime, timezone
from sqlalchemy import create_engine, String, Integer, Text, DateTime
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{(DATA_DIR / 'fixture-forge.db').as_posix()}")
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {})
SessionLocal = sessionmaker(engine, expire_on_commit=False)

class Base(DeclarativeBase): pass

class JsonRecord(Base):
    __tablename__ = "records"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    kind: Mapped[str] = mapped_column(String, index=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    payload: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

Base.metadata.create_all(engine)

def list_records(kind):
    with SessionLocal() as db:
        return [json.loads(x.payload) for x in db.query(JsonRecord).filter(JsonRecord.kind == kind).all()]

def get_record(record_id, kind=None):
    with SessionLocal() as db:
        q = db.query(JsonRecord).filter(JsonRecord.id == record_id)
        if kind: q = q.filter(JsonRecord.kind == kind)
        row = q.first()
        return json.loads(row.payload) if row else None

def save_record(record_id, kind, data, expected_revision=None):
    with SessionLocal() as db:
        row = db.get(JsonRecord, record_id)
        current = row.revision if row else -1
        if expected_revision is not None and row and expected_revision != current:
            raise ValueError(f"版本冲突：服务器版本为 {current}，当前编辑版本为 {expected_revision}")
        revision = current + 1
        data["revision"] = revision
        if row:
            row.kind, row.revision, row.payload = kind, revision, json.dumps(data, ensure_ascii=False)
            row.updated_at = datetime.now(timezone.utc)
        else:
            db.add(JsonRecord(id=record_id, kind=kind, revision=revision, payload=json.dumps(data, ensure_ascii=False)))
        db.commit()
        return data

def delete_record(record_id, kind):
    with SessionLocal() as db:
        count = db.query(JsonRecord).filter(JsonRecord.id == record_id, JsonRecord.kind == kind).delete()
        db.commit()
        return bool(count)

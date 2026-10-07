"""PostgreSQL connectivity and migration-readiness checks."""

import os
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator
from urllib.parse import quote_plus

import psycopg
from psycopg.rows import dict_row

EXPECTED_SCHEMA_REVISION = "0009_remediation_verification"


def _connection_settings() -> str | dict[str, str | int]:
    database_url = os.getenv("DATABASE_URL", "")
    if database_url:
        return database_url
    required = ("DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD")
    missing = [name for name in required if not os.getenv(name)]
    if missing:
        raise RuntimeError(f"Missing required database settings: {', '.join(missing)}")
    return {
        "host": os.environ["DB_HOST"], "port": int(os.getenv("DB_PORT", "5432")),
        "dbname": os.environ["DB_NAME"], "user": os.environ["DB_USER"],
        "password": os.environ["DB_PASSWORD"],
    }


def sqlalchemy_database_url() -> str:
    settings = _connection_settings()
    if isinstance(settings, str):
        if "+psycopg" in settings:
            return settings
        if settings.startswith("postgresql://"):
            return settings.replace("postgresql://", "postgresql+psycopg://", 1)
        if settings.startswith("postgres://"):
            return settings.replace("postgres://", "postgresql+psycopg://", 1)
        return settings
    return (
        f"postgresql+psycopg://{quote_plus(str(settings['user']))}:"
        f"{quote_plus(str(settings['password']))}@{settings['host']}:{settings['port']}/"
        f"{quote_plus(str(settings['dbname']))}"
    )


@contextmanager
def get_connection() -> Iterator[psycopg.Connection]:
    settings = _connection_settings()
    timeout = int(os.getenv("DB_CONNECT_TIMEOUT_SECONDS", "3"))
    connection = (
        psycopg.connect(settings, row_factory=dict_row, connect_timeout=timeout)
        if isinstance(settings, str)
        else psycopg.connect(**settings, row_factory=dict_row, connect_timeout=timeout)
    )
    with connection:
        yield connection


def schema_revision() -> str | None:
    with get_connection() as connection:
        exists = connection.execute(
            "SELECT to_regclass('public.alembic_version') AS table_name"
        ).fetchone()
        if not exists["table_name"]:
            return None
        row = connection.execute("SELECT version_num FROM alembic_version").fetchone()
        return row["version_num"] if row else None


def database_ready() -> tuple[bool, str]:
    try:
        revision = schema_revision()
        if revision != EXPECTED_SCHEMA_REVISION:
            return False, f"schema revision {revision or 'missing'}; expected {EXPECTED_SCHEMA_REVISION}"
        return True, "ready"
    except Exception as error:
        return False, f"database unavailable: {type(error).__name__}"


def init_database() -> None:
    """Compatibility helper for CLI seeders; schema changes belong to Alembic."""
    from alembic import command
    from alembic.config import Config

    root = Path(__file__).resolve().parents[2]
    command.upgrade(Config(str(root / "alembic.ini")), "head")

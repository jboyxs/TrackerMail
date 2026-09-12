FROM ghcr.io/astral-sh/uv:0.12.13-python3.12-trixie-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATABASE_PATH=/data/tracker.db \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-install-project

COPY main.py database.py models.py geoip.py admin.html entrypoint.sh ./
RUN useradd --create-home --uid 10001 app && mkdir -p /data && chown -R app:app /app /data

ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8000

RUN chmod 755 /app/entrypoint.sh

CMD ["/app/entrypoint.sh"]

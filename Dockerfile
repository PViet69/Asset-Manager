FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install --no-install-recommends -y libmagic1 \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir "uv==0.11.24"

WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY backend ./backend
RUN uv sync --frozen --no-dev --no-editable \
    && useradd --create-home --uid 10001 app \
    && chown -R app:app /app

USER app

EXPOSE 8000
CMD [".venv/bin/uvicorn", "backend.app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]

from pathlib import Path

import yaml

ROOT = Path(__file__).parents[3]


def test_compose_defines_app_and_qdrant_services() -> None:
    compose = yaml.safe_load((ROOT / "docker-compose.yml").read_text())

    assert set(compose["services"]) == {"app", "frontend", "qdrant"}
    assert compose["services"]["app"]["build"] == "."
    assert compose["services"]["app"]["env_file"] == [".env"]
    assert compose["services"]["app"]["ports"] == ["127.0.0.1:${APP_PORT:-8000}:8000"]
    assert (
        compose["services"]["app"]["environment"]["QDRANT_URL"] == "http://qdrant:6333"
    )
    assert compose["services"]["qdrant"]["volumes"] == [
        "qdrant_storage:/qdrant/storage"
    ]


def test_compose_defines_frontend_service() -> None:
    compose = yaml.safe_load((ROOT / "docker-compose.yml").read_text())
    frontend = compose["services"]["frontend"]

    assert frontend["build"] == "./frontend"
    assert frontend["ports"] == ["127.0.0.1:${FRONTEND_PORT:-5173}:80"]
    assert "environment" not in frontend
    assert frontend["depends_on"] == ["app"]
    nginx_template = (
        ROOT / "frontend" / "nginx-templates" / "default.conf.template"
    ).read_text()
    assert "client_max_body_size 250m" in nginx_template
    assert "proxy_pass http://app:8000" in nginx_template
    assert "location /admin/sync/" in nginx_template
    assert "location /admin/tags" in nginx_template
    assert "try_files $uri $uri/ /index.html" in nginx_template
    assert "location /auth/" in nginx_template
    assert "Authorization" not in nginx_template


def test_vite_proxies_admin_tag_routes() -> None:
    vite_config = (ROOT / "frontend" / "vite.config.ts").read_text()

    assert '"/admin/tags"' in vite_config


def test_compose_requires_admin_session_configuration() -> None:
    compose = yaml.safe_load((ROOT / "docker-compose.yml").read_text())
    environment = compose["services"]["app"]["environment"]

    assert "ADMIN_USERNAME" not in environment
    assert "ADMIN_PASSWORD_HASH" not in environment
    assert "ADMIN_SESSION_SECRET" not in environment
    assert "ADMIN_ALLOWED_ORIGIN" not in environment
    assert "ADMIN_API_KEY" not in environment


def test_compose_uses_safe_reproducible_qdrant_defaults() -> None:
    compose = yaml.safe_load((ROOT / "docker-compose.yml").read_text())
    qdrant = compose["services"]["qdrant"]

    assert qdrant["image"] != "qdrant/qdrant:latest"
    assert qdrant["ports"] == ["127.0.0.1:${QDRANT_PORT:-6333}:6333"]
    assert "/healthz" in " ".join(qdrant["healthcheck"]["test"])


def test_compose_requires_description_and_embedding_models() -> None:
    compose = yaml.safe_load((ROOT / "docker-compose.yml").read_text())
    environment = compose["services"]["app"]["environment"]

    assert environment["DESCRIPTION_MODEL"] == (
        "${DESCRIPTION_MODEL:?Set DESCRIPTION_MODEL in .env}"
    )
    assert environment["EMBEDDING_MODEL"] == (
        "${EMBEDDING_MODEL:?Set EMBEDDING_MODEL in .env}"
    )


def test_example_model_url_is_reachable_from_docker_desktop() -> None:
    env_example = (ROOT / ".env.example").read_text()

    assert "MODEL_ENDPOINT_URL=http://host.docker.internal:8001/v1" in env_example


def test_dockerfile_installs_libmagic_and_runs_uvicorn() -> None:
    dockerfile = (ROOT / "Dockerfile").read_text()

    assert "libmagic1" in dockerfile
    assert "uvicorn" in dockerfile
    assert "backend.app.main:create_app" in dockerfile
    assert "uv.lock" in dockerfile
    assert "--frozen" in dockerfile
    assert "USER app" in dockerfile

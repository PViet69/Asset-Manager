---
name: "source-command-docker"
description: "Migrated source command `docker`"
---

# source-command-docker

Use this skill when the user asks to run the migrated source command `docker`.

## Command Template

---
  description: Build and start local Docker Compose services
  ---

  Run:

  ```bash
  docker compose up -d --build

  Report result. If command fails, show error output.
  ```

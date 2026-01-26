.PHONY: docker-up docker-down docker-reset

# Start Docker containers
docker-up:
	docker compose up -d

# Stop Docker containers
docker-down:
	docker compose down

# Reset Docker containers (removes volumes and restarts)
docker-reset:
	docker compose down -v
	docker compose up -d

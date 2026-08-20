# FixZone Persistent Upload Storage for Dokploy

## Purpose

FixZone stores citizen report evidence and provider completion evidence on the API filesystem. In the current Dokploy/Nixpacks container, the default application working directory is `/app`, so the default upload root resolves to `/app/uploads`.

Without a Docker volume or bind mount, `/app/uploads` is part of the replaceable container filesystem and can be lost when Dokploy replaces the API container.

## Application Storage Root

The API supports:

```text
UPLOAD_ROOT=/app/uploads
```

If `UPLOAD_ROOT` is unset, the API preserves the historical behavior:

```text
process.cwd()/uploads
```

For the current Nixpacks production runtime, that default is equivalent to:

```text
/app/uploads
```

Stored database references remain relative paths such as:

```text
report-evidence/<reportId>/<fileName>
report-completion/<reportId>/<fileName>
```

The protected API evidence routes continue to serve files only after authorization checks:

```text
/api/report/<reportId>/evidence/<fileName>
/api/report/<reportId>/completion-evidence/<fileName>
```

Do not expose `report-evidence` or `report-completion` through unrestricted static serving.

## Required Persistent Mount

For the current single-VPS deployment, mount the existing host directory:

```text
/srv/securezone-data/fixzone/uploads
```

into the API container at:

```text
/app/uploads
```

Recommended environment variable:

```text
UPLOAD_ROOT=/app/uploads
```

This keeps existing database references compatible and makes the existing recovered files immediately visible inside the new API container.

## Dokploy Configuration Requirement

This repository does not currently contain a Docker Compose file, Dockerfile, Nixpacks mount declaration, or committed Dokploy application manifest that Dokploy v0.29.8 can use to define the Swarm mount from source alone.

Therefore the persistent bind mount must be configured in Dokploy/server deployment configuration for the FixZone API application. A direct `docker service update --mount-add ...` is not sufficient as the final fix unless it is also reflected in Dokploy's durable application configuration, because a normal Dokploy redeploy may overwrite manual Swarm mutations.

If Dokploy cannot express the mount for this Nixpacks application, convert the API application to a Dokploy-supported Compose deployment in a separate infrastructure change and include the same bind mount:

```yaml
services:
  fixzone-api:
    volumes:
      - /srv/securezone-data/fixzone/uploads:/app/uploads
    environment:
      UPLOAD_ROOT: /app/uploads
```

Do not add any initialization command that clears, replaces, or reseeds `/app/uploads`.

## First Deployment Guardrails

Before deployment:

1. Confirm the backup set exists and contains both the PostgreSQL dump and uploads archive.
2. Confirm `/srv/securezone-data/fixzone/uploads` contains the expected 20 files.
3. Configure the durable Dokploy/server mount before replacing the API container.
4. Set `UPLOAD_ROOT=/app/uploads` in the API environment.
5. Deploy only through the approved Dokploy release process.

After deployment, verify the new container mount and evidence survival before continuing UAT.

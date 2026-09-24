# Docker hosting and maintenance

Run Command Table on your own hardware with Docker Compose and the `ghcr.io/addison16/commandtable:latest` image. The image contains the app, API, WebSockets and SQLite support; hosting does not require Node, npm or a source checkout on the computer.

## Hardware and operating systems

Use an existing 64-bit computer or server that can stay on while your table plays. Published images support Linux `amd64` (64-bit Intel/AMD) and `arm64` (64-bit ARM), and Docker selects the matching image. An ARM host needs a compatible 64-bit operating system; 32-bit images are not published. Keep the database on local disk and run one app instance against it.

- **Windows or macOS:** install [Docker Desktop](https://docs.docker.com/desktop/) for a supported version of your operating system. It includes Docker Compose. Use Linux containers for this app.
- **Linux:** install [Docker Engine](https://docs.docker.com/engine/install/) for a supported distribution and the [Docker Compose plugin](https://docs.docker.com/compose/install/). Docker Desktop is another option for a desktop computer.

Start Docker, then verify the client can reach the running engine and Compose is available:

```sh
docker version
docker compose version
```

The commands below use a POSIX shell, such as a Linux/macOS terminal or a WSL terminal configured for Docker Desktop on Windows. Keep the host awake and connected to the network while others use a shared room. Phones use their browsers; Docker runs only on the host.

## Install the published image

For a first installation, download **compose.yaml** and **docker.env.example** from the [latest GitHub release](https://github.com/Addison16/commanders-table/releases/latest). Put both in a dedicated folder, open a terminal there, and copy the environment example:

```sh
cp docker.env.example .env
```

Edit `.env` before starting. For phones on your LAN, use the host's actual LAN address in place of this example:

```dotenv
MTG_IMAGE=ghcr.io/addison16/commandtable:latest
PUBLIC_ORIGIN=http://192.168.1.50:8080
ALLOW_INSECURE_HTTP=true
TRUST_PROXY_HOPS=0
```

Open that exact origin on every phone and computer. A phone's `localhost` refers to the phone. For use only in a browser on the Docker host, `http://localhost:8080` is suitable. Allow access to port 8080 through the host firewall for LAN play. See [HTTPS through a proxy](#https-through-a-proxy) for a domain and secure installation/offline features.

Validate the settings, pull the released image and start the service:

```sh
docker compose -p mtg-util -f compose.yaml config --quiet
docker compose -p mtg-util -f compose.yaml pull
docker compose -p mtg-util -f compose.yaml up -d
docker compose -p mtg-util -f compose.yaml ps
curl --fail http://localhost:8080/api/health
```

The container should become **healthy**, and the health endpoint should return JSON containing `"ok":true`. Open the configured `PUBLIC_ORIGIN` to play. To inspect a startup problem:

```sh
docker compose -p mtg-util -f compose.yaml logs --tail=100 mtg-util
```

The app runs as UID 1000 (`node`) inside the container. Its named volume is `mtg-util_mtg-util-data` with the project name shown above; it stores SQLite and initializes `/data` with the correct ownership. Keep the same project name, volume, configuration folder and origin for updates. If an existing installation uses a different project name or `--env-file`, keep using those values in every command below.

Never use `docker compose down -v` to update: it deletes the volume containing server games and identities. Normal updates only need `pull` and `up -d`, after a backup. Browser-local games are stored separately in each browser.

## Configuration

| Variable              | Default                                 | Meaning                                                                            |
| --------------------- | --------------------------------------- | ---------------------------------------------------------------------------------- |
| `PUBLIC_ORIGIN`       | `http://localhost:8080`                 | Exact browser origin, including a nonstandard port; no path, credentials, or query |
| `ALLOW_INSECURE_HTTP` | `true` in the Compose example           | Use `true` for deliberate local/LAN HTTP; use `false` for HTTPS                    |
| `PORT`                | `8080` inside the container             | Retain 8080 inside the image for its health check                                  |
| `DATA_DIR`            | `/data` inside the container            | SQLite database and sidecars in the persistent volume                              |
| `ROOM_TTL_DAYS`       | `30`                                    | Days since last committed room activity                                            |
| `SESSION_TTL_DAYS`    | `90`                                    | Rolling guest-cookie/session lifetime                                              |
| `TRUST_PROXY_HOPS`    | `0`                                     | Number of trusted reverse-proxy hops, 0–5                                          |
| `MTG_IMAGE`           | `ghcr.io/addison16/commandtable:latest` | Published image; use a version or digest to pin a release                          |

Compose reads the `.env` beside `compose.yaml`. Release downloads call the template `docker.env.example`; its source filename is `.env.docker.example`. The separate `.env.example` is for contributor development. The image itself defaults to secure HTTP handling; Compose explicitly permits HTTP in the LAN example. Keep `ALLOW_INSECURE_HTTP=false` for an HTTPS origin.

To change the host port, change the left side of the `8080:8080` mapping in `compose.yaml` and include that port in `PUBLIC_ORIGIN`. Keep the container side at 8080. Then use the chosen host port for health checks and browser access.

Do not alternate between localhost, a numeric IP and a domain while expecting the same browser state. Guest cookies, local games and installed-app storage are scoped to the browser origin, and shared commands reject an unconfigured alias. Exports move game data, not room authority. Use a stable address where practical.

Use local disk for SQLite. If you replace the named volume with a bind mount, prepare a directory writable by container UID/GID 1000. Do not put the live database on NFS/SMB; SQLite WAL needs its sidecars on the same local filesystem.

## HTTPS through a proxy

Configure a reverse proxy with a trusted certificate for your actual domain and support for WebSocket upgrades. In the existing `.env`, use:

```dotenv
PUBLIC_ORIGIN=https://table.example.com
ALLOW_INSECURE_HTTP=false
TRUST_PROXY_HOPS=1
```

Set the trusted-hop count to match your actual proxy chain, then recreate the Docker service with the updated environment:

```sh
docker compose -p mtg-util -f compose.yaml up -d
docker compose -p mtg-util -f compose.yaml ps
curl --fail https://table.example.com/api/health
```

[Caddyfile.example](Caddyfile.example) shows a proxy on the host reaching `127.0.0.1:8080`. A proxy container needs a shared Docker network and the app service hostname instead, such as `mtg-util:8080`; its own `localhost` cannot reach another container. Caddy's `reverse_proxy` forwards WebSocket upgrades. Other proxies must retain the original Host/Origin, forward upgrades and allow long-lived connections. HTTPS clients automatically use `wss://`.

Restrict direct access to the backend port when public traffic should go through the proxy. HTTPS enables installation/offline reopening and other secure-context features on supported browsers. Core play and saving still work over deliberate LAN HTTP.

HTTPS cookies are Secure, HttpOnly, SameSite=Lax and host-only. Contradictory HTTP/HTTPS cookie configuration fails at startup. API responses are private `no-store`; hashed assets are immutable; HTML and service-worker files revalidate.

## Back up

Make a verified backup before updating. **Export game backup** in the app saves a browser-local game without credentials or installation identity. A server backup contains shared rooms, guest credential hashes, memberships and deduplication records; keep it private. It does not contain browser-local games.

Use a new filename each time. This command runs the backup tool inside the existing Docker container; Node does not need to be installed on the host:

```sh
docker compose -p mtg-util -f compose.yaml exec -T mtg-util \
  node scripts/backup.mjs /data/backups/before-update.sqlite
mkdir -p backups
docker compose -p mtg-util -f compose.yaml cp \
  mtg-util:/data/backups/before-update.sqlite ./backups/before-update.sqlite
```

The backup uses SQLite's online backup API, validates the result with `integrity_check` and refuses to overwrite an existing destination. Choose a fresh filename in both commands, retain the copied file outside the container and keep another copy off the host. Save the Compose file and `.env` alongside your operational backups.

Do not copy only a live `mtg-util.sqlite`: committed data may still be in its WAL. The online backup command handles a running server safely. The [restore procedure](#restore-a-verified-backup) below uses the copied file.

## Update to the latest release

The primary image name is now `commandtable`. To switch an existing installation from `ghcr.io/addison16/commanders-table`, edit only the image setting in its existing `.env`:

```dotenv
MTG_IMAGE=ghcr.io/addison16/commandtable:latest
```

The original image-address migration preserved the v0.2.0 runtime. Both names now receive the same stable application updates. Keep the same Compose project and service names, data volume, configuration and public origin; do not create a replacement stack or volume. The old image address remains a compatibility alias. The GitHub source repository remains `Addison16/commanders-table`.

1. [Back up](#back-up) the running server and copy the verified file out. Export important browser-local games separately.
2. Keep the existing settings and use `MTG_IMAGE=ghcr.io/addison16/commandtable:latest` to follow stable releases, then run:

   ```sh
   docker compose -p mtg-util -f compose.yaml pull
   docker compose -p mtg-util -f compose.yaml up -d
   docker compose -p mtg-util -f compose.yaml ps
   curl --fail http://localhost:8080/api/health
   ```

3. Open the configured origin, reconnect a room and confirm the saved game. Browser clients should choose **Save & update**, then confirm when ready. The app does not force a mid-game reload.

Pulling `latest` downloads an image; it does not replace a running container. `up -d` applies the downloaded image while keeping the named volume. Docker managers can detect a changed tag, but unattended updates require an updater you configure. Do not replace your configured `.env` with the release example during updates.

For a pinned installation, set `MTG_IMAGE` to a version such as `ghcr.io/addison16/commandtable:0.3.1` or an image digest, then use the same `pull` and `up -d` commands. Changing a version pin is intentional; `latest` remains the standard install/update path.

Migrations execute in transactions. An older app refuses a newer database schema, so rollback can require the matching pre-update backup. Retain the previous image or version/digest and its configuration until the update is verified.

For v0.1.2 and later, update browser clients with **Save & update** when prompted. The app reads earlier saves, but v0.1.2 adds optional player identity to new dice records and v0.1.3 adds optional commander-card metadata. Earlier versions validate those records strictly, so downgrading the server or importing new exports into an older app may require the pre-update backup even though the SQLite schema version is unchanged.

## Restore a verified backup

Restoring replaces shared server state with the backup's point in time. Make a fresh backup first and stop every app process using the volume. Choose the same image version that created the backup or a compatible newer version. The commands below validate the copied backup, stage it in the volume and replace the stopped database and its sidecars:

```sh
docker compose -p mtg-util -f compose.yaml stop
docker compose -p mtg-util -f compose.yaml run --rm --no-deps \
  --entrypoint node -v "$PWD/backups:/restore:ro" mtg-util -e '
    const fs = require("node:fs");
    const Database = require("better-sqlite3");
    const source = "/restore/before-update.sqlite";
    const db = new Database(source, { readonly: true, fileMustExist: true });
    if (db.pragma("integrity_check", { simple: true }) !== "ok") throw Error("Invalid backup");
    db.close();
    fs.copyFileSync(source, "/data/mtg-util.sqlite.restore");
    for (const suffix of ["-wal", "-shm"]) fs.rmSync("/data/mtg-util.sqlite" + suffix, { force: true });
    fs.renameSync("/data/mtg-util.sqlite.restore", "/data/mtg-util.sqlite");
  '
```

Continue only after the restore command succeeds:

```sh
docker compose -p mtg-util -f compose.yaml up -d
docker compose -p mtg-util -f compose.yaml ps
curl --fail http://localhost:8080/api/health
```

All database tools run inside Docker. Never restore against an active database. Open a previously joined browser and confirm its room, seat and game. Existing guest cookies remain usable if their matching sessions were in the backup and have not expired; restoring cannot recover cookies missing from the browser or rooms created after the backup.

## Start a locally built image

Use a source checkout and `compose.local.yaml` when developing or testing unpublished changes. The Docker build includes dependency installation and compilation, so a host Node installation is not required to build or run this version. Configure `.env` from `.env.docker.example`, then run:

```sh
docker compose -p mtg-util -f compose.local.yaml up -d --build
docker compose -p mtg-util -f compose.local.yaml ps
curl --fail http://localhost:8080/api/health
```

Use the existing project and volume only when deliberately replacing that installation. For an independent test instance, choose a separate project and unused host port. This local build does not pull or publish a release. Apply the same backup, restore and proxy procedures with `compose.local.yaml` substituted for `compose.yaml`.

The contributor verification and publication commands below use the source checkout's development tooling. They are not needed to install, update or operate a published Docker image.

## Contributor verification

```sh
docker build -t mtg-util:local .
node scripts/container-smoke.mjs mtg-util:local
```

The smoke test uses temporary containers and a private named volume, checks non-root execution/native SQLite/health/assets, creates and updates a room, recreates its container, retries the same operation, and verifies a live backup and stopped restore. It cleans up its own test resources.

The main Dockerfile supports amd64 and arm64. CI uses native `ubuntu-24.04` and `ubuntu-24.04-arm` runners to build and run the smoke test. On this development machine, amd64 passed natively and ARM64 Node plus its compiled SQLite addon passed using QEMU. The optional fallback recipe used was:

```sh
docker build -f tests/deployment/Dockerfile.arm64-smoke -t mtg-util:arm64-smoke .
SMOKE_QEMU=/usr/local/bin/qemu-aarch64-static \
  node scripts/container-smoke.mjs mtg-util:arm64-smoke
```

This fallback is an emulation-only verification image, not the published runtime. It needs neither privileged binfmt installation nor changes to host packages. The [v0.1.0 release gate](https://github.com/Addison16/commanders-table/actions/runs/35163473158) also passed native amd64 and arm64 container checks on GitHub's Ubuntu runners.

## Publishing a release

Source remains at `Addison16/commanders-table`. The primary image path is `ghcr.io/addison16/commandtable`; `ghcr.io/addison16/commanders-table` is retained as the compatibility image path. Future releases will publish the same application to both names. The workflow uses the repository owner's lowercase name, so a fork publishes under its own owner. Set `MTG_IMAGE` when consuming a fork's image. No Docker Hub account or stored registry password is needed: the workflow uses GitHub's scoped `GITHUB_TOKEN`.

For a new fork, enable GitHub Actions and verify its image configuration before publishing. The initial release used:

```sh
git tag v0.1.0
git push origin v0.1.0
```

For subsequent releases, use a new, unused version: update the package and lockfile together, add notes under `docs/releases/vX.Y.Z.md`, commit, and tag that commit. The historical v0.1.5 sequence was:

```sh
npm version 0.1.5 --no-git-tag-version
node scripts/check-release.mjs v0.1.5
git add package.json package-lock.json docs/releases/v0.1.5.md
git commit -m "Release v0.1.5"
git tag v0.1.5
git push origin main v0.1.5
```

Release validation rejects a tag that differs from the package/lockfile version or lacks a source license. The same reusable verification workflow runs on PRs, `main`, and releases: lint, types, domain/storage/server tests, Chromium/WebKit, production PWA/HTTPS checks, and native container smoke tests for both architectures. Only a passing release builds and pushes the combined image, creates GitHub release notes, and attaches the Compose/environment files. Official actions are pinned to verified release commits. A failed release can be rerun; publication does not alter the running server.

Each release publishes a version tag and a full commit `sha-…` tag to both image names. Stable versions also update `stable` and `latest` on both; prereleases such as `v0.2.0-rc.1` do not move those aliases. Users pull the updated tag and recreate their container while keeping the same volume and origin, or use their Docker manager's update controls. Automatic unattended restarts require an updater configured by that server's operator.

Both `commandtable` and the `commanders-table` compatibility package are public, and unauthenticated pulls have been verified. For a new fork, check each package for public visibility after its first image publication. If it is private, open the package's settings, select **Change visibility → Public**, and confirm. Subsequent versions keep the package's visibility. See [GitHub's package visibility documentation](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility#configuring-visibility-of-packages-for-your-personal-account).

Releases attach `compose.yaml` and `docker.env.example`. Copy the latter to `.env` before configuring the origin and starting Compose. The source file remains `.env.docker.example`; the workflow gives the download a visible filename that GitHub preserves.

Verify both platform manifests and an unauthenticated pull before announcing availability. The digest in each GitHub release identifies the exact versioned image index. The `latest` tag uses a separate index with the same platform images so GitHub’s generated install command stays on `latest`. Users can download the source ZIP/tarball directly from the release without installing Git.

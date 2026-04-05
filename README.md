# Docker *Genius*

![GitHub stars](https://img.shields.io/github/stars/NUCL3ARN30N/docker-genius?style=for-the-badge)
![GitHub forks](https://img.shields.io/github/forks/NUCL3ARN30N/docker-genius?style=for-the-badge)
![GitHub issues](https://img.shields.io/github/issues/NUCL3ARN30N/docker-genius?style=for-the-badge)
![GitHub license](https://img.shields.io/github/license/NUCL3ARN30N/docker-genius?style=for-the-badge)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-222222?style=for-the-badge&logo=githubpages&logoColor=white)

> Browser-based Docker management dashboard — no login, no server, no data collection

## Quick Start

**Proxy:** Run `python proxy.py` on your Docker host, then add `http://<host-ip>:9587` as a connection.

## Features

| # | Feature | Description |
|:-:|---------|-------------|
| 1 | Containers | Start, stop, restart, pause, unpause, remove |
| 2 | Live Logs | Stream container logs with timestamps |
| 3 | Inspect | Environment variables, port mappings, mounts, raw JSON |
| 4 | Resource Stats | Real-time CPU, memory, and network I/O per container |
| 5 | Web Console | Execute shell commands inside running containers |
| 6 | Deploy | Search Docker Hub, configure ports/volumes/env, pull and start |
| 7 | Compose | Paste docker-compose.yml, deploy or tear down full stacks |
| 8 | Images | List, pull, and remove images |
| 9 | Volumes | List, remove, and prune unused volumes |
| 10 | Networks | List and remove networks |
| 11 | Multi-Host | Save and switch between multiple Docker hosts |
| 12 | Backup / Restore | Export and import connections as JSON |

## Proxy Commands

| # | Command | Description |
|:-:|---------|-------------|
| 1 | `run` | Start proxy in foreground (default) |
| 2 | `install` | Install as system service + start on boot |
| 3 | `uninstall` | Remove system service |
| 4 | `start` | Start the installed service |
| 5 | `stop` | Stop the running service |
| 6 | `restart` | Restart the service |
| 7 | `status` | Show service status |
| 8 | `logs` | Tail service logs |

## Proxy Options

| # | Option | Description |
|:-:|--------|-------------|
| 1 | `--host HOST` | Bind address (default: 127.0.0.1, use 0.0.0.0 for LAN) |
| 2 | `--port PORT` | Listen port (default: 9587) |
| 3 | `--tcp H:P` | Connect to Docker via TCP instead of socket |
| 4 | `--socket PATH` | Custom Docker socket path |
| 5 | `--user USER` | Service user (Linux install only, default: current) |
| 6 | `--lines N` | Number of log lines for `logs` command (default: 50) |

## Platform Support

| # | Platform | Setup |
|:-:|----------|-------|
| 1 | Linux | `python3 proxy.py install` — systemd service, auto-elevates to sudo |
| 2 | macOS | `python3 proxy.py install` — launchd agent, runs at login |
| 3 | Windows (TCP) | Docker Desktop > Settings > Enable TCP, connect directly to `localhost:2375` |
| 4 | Windows (WSL2) | `python3 proxy.py install` inside WSL2 |

## File Structure

| # | File | Lines | Purpose |
|:-:|------|------:|---------|
| 1 | `index.html` | 30 | HTML shell, loads dependencies |
| 2 | `style.css` | 254 | All styling |
| 3 | `app.js` | 648 | React application with JSX |
| 4 | `proxy.py` | 740 | CORS proxy, Hub search, Compose, service installer |

## Controls

- **Hub Search:** Find images on Docker Hub directly from the deploy page (bypasses Docker daemon)
- **Compose Deploy:** Paste YAML, toggle between full logs or errors-only output
- **Backup:** Export all connections as a downloadable JSON file
- **Restore:** Import connections from backup, merges without duplicates
- **Custom Dialogs:** All confirmations are in-app, zero native browser popups

## Requirements

**Browser:** Any modern browser (Chrome, Firefox, Safari, Edge)
**Server:** None — fully static, runs 100% client-side
**Proxy:** Python 3 (zero dependencies, single file)
**Dependencies:** Loaded via CDN (React, Babel, Remix Icon, Google Fonts)

---

<p align="center">

  <sub>Badges from <a href="https://github.com/envoy1084/awesome-badges">envoy1084/awesome-badges</a></sub>

</p>

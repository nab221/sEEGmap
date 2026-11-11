# sEEGmap desktop launchers

Three macOS `.app` bundles so you can run the local sEEGmap without a terminal —
from Spotlight, Raycast, Launchpad or Finder:

| App | Icon | Action |
| --- | --- | --- |
| **Start sEEGmap** | green ▶ | Starts the Vite dev server detached on port **5180**, waits until it serves HTTP, then opens `http://localhost:5180/`. If it's already running it just opens the browser. |
| **Stop sEEGmap** | red ■ | Stops the server on port 5180 (other dev servers, e.g. on 5173, are left alone). |
| **Restart sEEGmap** | amber ↻ | Stop, then Start. Only needed after a `package.json` dependency change, a `vite.config.ts` edit, or a wedged server — source edits hot-reload on their own. |

## Build & install

```bash
scripts/launchers/build_apps.sh --install
```

Regenerates the icons, assembles the three bundles in a temp dir and copies
them into `/Applications`. The project path and `node` location are baked in
at build time; rebuild if you move the repo or reinstall Node elsewhere. From
a worktree, point the launchers at the main checkout:

```bash
SEEGMAP_REPO_ROOT="$HOME/Codes/sEEGmap" scripts/launchers/build_apps.sh --install
```

## Notes

- **Keep the port fixed.** sEEGmap saves plans in the browser's IndexedDB,
  which is tied to the origin (`http://localhost:5180`). Changing the port, or
  opening `127.0.0.1:5180` instead, shows an empty store.
- Server log: `~/Library/Logs/seegmap.log`.
- On a fresh clone the first Start runs `npm install` before serving.
- The bundles are `LSUIElement` (no Dock icon — fire-and-exit).
- `generate_icons.py` is the pure-stdlib icon generator shared with the SAMBA
  Reporter launchers.

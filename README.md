# Frame video platform

Frame is a small video sharing starter project. It includes a public discovery homepage, a signed-in creator dashboard, account registration and sign-in, SQLite storage, video uploads, watch history, likes, watch-later, playlists, and search.

## Run it locally

Install Node.js 22.13 or newer (which includes npm), then open a terminal in this project folder and run:

```bash
npm.cmd install
npm.cmd start
```

Open <http://localhost:3000>. Use this address for the full app. VS Code Live Server can serve the static page, but it cannot handle registration, sign-in, or uploads because those need the Node backend.

In PowerShell, if running `npm` reports that scripts are disabled, use `npm.cmd` instead. On a standard Windows installation, you can also run `& 'C:\Program Files\nodejs\npm.cmd' start` from the project folder.

User account, video metadata, watch history, likes, watch-later entries, and playlists are stored in `data/frame.sqlite`. Uploaded videos go in `uploads/videos/`; thumbnails and other images go in `uploads/images/`; profile photos can go in `uploads/profile-photos/`. The first server start imports the existing `data/frame.json` accounts and videos into SQLite and moves existing uploaded files into their new folders. It leaves the JSON file as a backup.

## Demo media

The Pexels demo assets are in `public/media/`. See [media credits](public/media/credits.md). The included sample video is large (about 386 MB) and can take time to load.

# Privacy and external services

OpenRound stores golf rounds and location evidence locally: the small PWA uses
IndexedDB, the iPhone prototype uses browser storage, the native app additionally
uses an on-device journal, and the Python pipeline writes under `data/` by default.
These stores are separate and are not automatically interchangeable backups.

Local storage does not mean every feature runs without network access:

- The Shot Scope importer sends your login to Shot Scope and downloads your account
  data. Raw exports can contain more personal information than normalized rounds.
- Course lookup/refresh may contact OpenGolfAPI and OpenStreetMap Overpass.
- Map imagery contacts USGS/USDA services or Google when configured. Requests can
  reveal the map area being viewed and your IP address.
- Weather features may send location coordinates to their configured provider.
- Generated Python shot maps load Google Fonts.

Browser storage, exported files, and backups should be treated as sensitive. Do
not assume they are encrypted by OpenRound. A shared device or browser profile may
expose saved rounds. Clearing site storage or uninstalling the native app can
remove the only copy of your data. Export and verify a backup first.

Use fictional player names and synthetic location traces when reporting bugs.
Course-map geometry is public geographic data, distinct from a person's round or
location history. See [third-party notices](../THIRD_PARTY_NOTICES.md) for sources.

# Restoring a backup

Backups are zip files in `server/storage/backups/` containing:

- `prisma/clinic.db` — the entire SQLite database
- `storage/uploads/` — every uploaded X-ray, scan and document

## Steps

1. Stop the server (close the terminal running `npm run dev` / `npm start`).
2. Extract the backup zip into the `server/` folder, overwriting when asked:

   ```powershell
   Expand-Archive -Path .\storage\backups\clinic-backup-XXXX.zip -DestinationPath . -Force
   ```

3. Start the server again. Done — the database and all attachments are back
   exactly as they were at backup time.

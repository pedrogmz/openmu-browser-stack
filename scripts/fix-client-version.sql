-- Fix OpenMU client-version resolution for the WASM client.
--
-- Symptom: opening the inventory (or entering the world, which sends the same
-- 0xF3 0x10 packet) crashes the browser client with
--     Uncaught RuntimeError: index out of bounds
-- and the client shows items the character does not own.
--
-- Cause: the MuMain WASM client sends protocol version "20404". OpenMU's
-- default initialization writes the same bytes ("20404") into BOTH the
-- "Season 6 Episode 3 GMO" row and the "Season 106 Episode 3 Open Source"
-- row. ClientVersionResolver is a dictionary keyed by those bytes and the
-- last registered definition wins, so "20404" resolves to the Season 6 GMO
-- client. That selects the legacy ItemSerializer (fixed 12-byte items)
-- instead of ItemSerializerExtended (variable 5-15 byte items). The browser
-- client only implements the extended parser, so it misreads the packet and
-- runs out of bounds.
--
-- Fix: give the GMO row its correct protocol version ("10404"). Then "20404"
-- maps unambiguously to the Season 106 Open Source definition and OpenMU uses
-- the extended serializer the client expects.
--
-- Apply:
--   docker exec -i openmu-browser-stack-postgres-1 psql -U openmu -d openmu < scripts/fix-client-version.sql
--   docker restart openmu-browser-stack-openmu-1
--
-- The OpenMU restart is required: the client definitions are cached in memory
-- at startup.

UPDATE config."GameClientDefinition"
SET "Version" = decode('3130343034', 'hex')   -- "10404"
WHERE "Season" = 6
  AND "Episode" = 3
  AND "Version" = decode('3230343034', 'hex'); -- only the wrongly-seeded "20404" row

-- Verify: the Season 106 row must keep "20404", the GMO row must be "10404".
SELECT "Season",
       "Episode",
       convert_from("Version", 'UTF8') AS version,
       "Description"
FROM config."GameClientDefinition"
ORDER BY "Season";

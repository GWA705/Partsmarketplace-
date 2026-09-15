-- Search indexes.
--
-- A dealer holding a part reads the number stamped on it and types some of it.
-- That means partial, middle-of-string matching on codes ("0208", "W.IN"),
-- which a B-tree cannot do — hence pg_trgm. Descriptions get proper full-text
-- search so "union connector" finds "JG 1/4 Union Connector - Straight".

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Partial-match on both code columns. A dealer's number may be either one.
CREATE INDEX IF NOT EXISTS "Part_code_trgm"
  ON "Part" USING gin (lower("code") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Part_catalogueCode_trgm"
  ON "Part" USING gin (lower("catalogueCode") gin_trgm_ops);

-- Word search across both descriptions and the vendor, weighted so a hit in
-- the name outranks a hit in the vendor name.
CREATE INDEX IF NOT EXISTS "Part_text_fts"
  ON "Part" USING gin (
    (
      setweight(to_tsvector('english', coalesce("name", '')), 'A') ||
      setweight(to_tsvector('english', coalesce("catalogueName", '')), 'B') ||
      setweight(to_tsvector('english', coalesce("vendor", '')), 'C')
    )
  );

-- Trigram on the descriptions too, so a typo ("conector") still lands.
CREATE INDEX IF NOT EXISTS "Part_name_trgm"
  ON "Part" USING gin (lower("name") gin_trgm_ops);

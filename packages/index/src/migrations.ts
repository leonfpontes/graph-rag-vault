// The index schema, in order. Every entry needs a `down` that undoes its `up` (tested in
// migrate.test.ts and schema.test.ts).
//
// - notes: one row per note of the vault, with the hash of its file so a rebuild re-indexes only
//   what changed. aliases: the names a note answers to, normalized, where the graph search starts.
// - links: typed edges between notes. `dst` may name a note that doesn't exist (a dangling
//   wikilink), so it has no foreign key; `src` does, and its links go with it.
// - chunks: the pieces of a note's body (`chunkNote`): `text` as written, for the app, and
//   `embed_text`, what gets embedded; a full-text index (FTS5, BM25) on `embed_text` is kept in
//   step by triggers.
// - embeddings: one vector per chunk and model, Float32 little-endian, so two models can be
//   compared on the same chunks.
import type { Migration } from './migrate.js'

const notes: Migration = {
  version: 1,
  name: 'notes, aliases and links',
  up: /* sql */ `
    CREATE TABLE notes (
      id           TEXT PRIMARY KEY CHECK (id GLOB '[a-z0-9]*' AND id NOT GLOB '*[^a-z0-9-]*'),
      type         TEXT NOT NULL
                   CHECK (type IN ('person', 'project', 'decision', 'meeting', 'document', 'customer')),
      title        TEXT NOT NULL CHECK (length(title) > 0),
      created      TEXT NOT NULL CHECK (created GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      updated      TEXT NOT NULL CHECK (updated GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      status       TEXT NOT NULL,
      path         TEXT NOT NULL UNIQUE,
      body         TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      CHECK (updated >= created)
    ) STRICT;
    CREATE INDEX notes_type_updated ON notes (type, updated DESC);

    CREATE TABLE aliases (
      note_id TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
      alias   TEXT NOT NULL CHECK (length(alias) > 0),
      norm    TEXT NOT NULL CHECK (length(norm) > 0),
      PRIMARY KEY (note_id, norm)
    ) STRICT, WITHOUT ROWID;
    CREATE INDEX aliases_norm ON aliases (norm);

    CREATE TABLE links (
      src      TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
      dst      TEXT NOT NULL,
      relation TEXT NOT NULL CHECK (relation IN
                 ('owner', 'attendees', 'decided_in', 'customer', 'supersedes', 'reports_to', 'mentions')),
      PRIMARY KEY (src, relation, dst),
      CHECK (src <> dst)
    ) STRICT, WITHOUT ROWID;
    CREATE INDEX links_dst ON links (dst, relation);`,
  down: /* sql */ `
    DROP TABLE links;
    DROP TABLE aliases;
    DROP TABLE notes;`,
}

const chunks: Migration = {
  version: 2,
  name: 'chunks and their full-text index',
  up: /* sql */ `
    CREATE TABLE chunks (
      rowid      INTEGER PRIMARY KEY,
      id         TEXT NOT NULL UNIQUE,
      note_id    TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
      ord        INTEGER NOT NULL CHECK (ord >= 0),
      heading    TEXT,
      text       TEXT NOT NULL CHECK (length(text) > 0),
      embed_text TEXT NOT NULL CHECK (length(embed_text) > 0),
      tokens     INTEGER NOT NULL CHECK (tokens > 0),
      UNIQUE (note_id, ord),
      CHECK (id = note_id || '#' || ord)
    ) STRICT;

    CREATE VIRTUAL TABLE chunks_fts USING fts5 (
      embed_text, content = 'chunks', content_rowid = 'rowid', tokenize = 'porter unicode61'
    );
    CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts (rowid, embed_text) VALUES (new.rowid, new.embed_text);
    END;
    CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts (chunks_fts, rowid, embed_text) VALUES ('delete', old.rowid, old.embed_text);
    END;
    CREATE TRIGGER chunks_au AFTER UPDATE ON chunks BEGIN
      INSERT INTO chunks_fts (chunks_fts, rowid, embed_text) VALUES ('delete', old.rowid, old.embed_text);
      INSERT INTO chunks_fts (rowid, embed_text) VALUES (new.rowid, new.embed_text);
    END;`,
  down: /* sql */ `
    DROP TRIGGER chunks_au;
    DROP TRIGGER chunks_ad;
    DROP TRIGGER chunks_ai;
    DROP TABLE chunks_fts;
    DROP TABLE chunks;`,
}

const embeddings: Migration = {
  version: 3,
  name: 'embeddings',
  up: /* sql */ `
    CREATE TABLE embeddings (
      chunk_id TEXT NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
      model    TEXT NOT NULL CHECK (length(model) > 0),
      dim      INTEGER NOT NULL CHECK (dim > 0),
      vector   BLOB NOT NULL,
      PRIMARY KEY (model, chunk_id),
      CHECK (length(vector) = dim * 4)
    ) STRICT, WITHOUT ROWID;`,
  down: /* sql */ `DROP TABLE embeddings;`,
}

export const MIGRATIONS: readonly Migration[] = [notes, chunks, embeddings]

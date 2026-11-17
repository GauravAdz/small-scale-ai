-- Digital Counterpart — Supabase pgvector backend.
-- Only needed when VECTOR_STORE=supabase. Run in the SQL editor, or via
-- `supabase db push` if you use the CLI.
--
-- IMPORTANT: `vector(1536)` must match your embedding model's dimensions.
--   text-embedding-3-small → 1536
--   voyage-3.5-lite        → 1024
--   voyage-3-large         → 1024 (configurable)
-- Change the two occurrences below before running if you're not on 1536.

create extension if not exists vector;

create table if not exists counterpart_documents (
  id          text primary key,
  chunk_id    text,
  index_id    text not null default 'legacy',
  doc_id      text not null,
  title       text not null,
  type        text not null default 'note',
  source      text not null,
  content     text not null,
  embedding   vector(1536) not null,
  created_at  timestamptz not null default now()
);

alter table counterpart_documents
  add column if not exists index_id text not null default 'legacy';

alter table counterpart_documents
  add column if not exists chunk_id text;

update counterpart_documents set chunk_id = id where chunk_id is null;

create index if not exists counterpart_documents_doc_id_idx
  on counterpart_documents (doc_id);

create index if not exists counterpart_documents_index_id_idx
  on counterpart_documents (index_id);

-- ivfflat is the right tradeoff at this corpus size. `lists` should be roughly
-- sqrt(rows); 100 is fine anywhere under ~10k chunks.
create index if not exists counterpart_documents_embedding_idx
  on counterpart_documents
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- The RPC the SupabaseVectorStore calls. Returns similarity in [0, 1] so it
-- matches the contract the other stores implement.
create or replace function match_counterpart_documents(
  query_embedding vector(1536),
  match_count int default 6,
  active_index_id text default 'legacy'
)
returns table (
  id         text,
  doc_id     text,
  title      text,
  source     text,
  content    text,
  similarity float
)
language sql
stable
as $$
  select
    coalesce(d.chunk_id, d.id) as id,
    d.doc_id,
    d.title,
    d.source,
    d.content,
    1 - (d.embedding <=> query_embedding) as similarity
  from counterpart_documents d
  where d.index_id = active_index_id
  order by d.embedding <=> query_embedding
  limit match_count;
$$;

-- The app connects with the service-role key from a server route, which bypasses
-- RLS. Enabling it anyway means an accidentally-exposed anon key reads nothing.
alter table counterpart_documents enable row level security;

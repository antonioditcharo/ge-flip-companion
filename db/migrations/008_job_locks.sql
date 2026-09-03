create table if not exists job_locks (
  job_name text primary key,
  lock_token uuid not null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null,
  owner text not null
);

create index if not exists job_locks_expires_at_idx
  on job_locks(expires_at);

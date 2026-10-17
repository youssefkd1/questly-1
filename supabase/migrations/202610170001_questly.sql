-- Questly family data model. Run with Supabase CLI against a new project.
create extension if not exists pgcrypto;
create type public.member_role as enum ('parent','child');
create type public.completion_status as enum ('assigned','in_progress','pending_approval','approved','needs_revision','missed','cancelled');
create type public.task_status as enum ('active','paused','archived');

create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check (char_length(display_name) between 1 and 80),
 created_at timestamptz not null default now()
);
create table public.families (
 id uuid primary key default gen_random_uuid(), name text not null check(char_length(name) between 1 and 100),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create table public.family_memberships (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade, role public.member_role not null,
 created_at timestamptz not null default now(), unique(family_id,user_id)
);
create table public.child_profiles (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id) on delete cascade,
 auth_user_id uuid unique references public.profiles(id) on delete set null,
 display_name text not null check(char_length(display_name) between 1 and 50), age smallint not null check(age between 4 and 17),
 theme text not null default 'blue', xp integer not null default 0 check(xp>=0), points integer not null default 0 check(points>=0),
 created_at timestamptz not null default now(), unique(id,family_id)
);
create table public.invitations (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id) on delete cascade,
 token_hash text not null unique, intended_role public.member_role not null default 'parent' check(intended_role='parent'),
 expires_at timestamptz not null, redeemed_at timestamptz, revoked_at timestamptz, created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now()
);
create table public.child_link_invitations (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id) on delete cascade,
 child_id uuid not null, token_hash text not null unique, expires_at timestamptz not null, redeemed_at timestamptz,
 revoked_at timestamptz, created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 foreign key(child_id,family_id) references public.child_profiles(id,family_id)
);
create table public.tasks (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id) on delete cascade,
 title text not null check(char_length(title) between 1 and 120), description text not null default '', category text not null,
 difficulty text not null default 'steady' check(difficulty in ('easy','steady','stretch')), xp_reward integer not null default 0 check(xp_reward between 0 and 500),
 point_reward integer not null default 0 check(point_reward between 0 and 500), due_at timestamptz, recurrence text not null default 'once',
 duration_minutes integer check(duration_minutes between 1 and 600), requires_approval boolean not null default true,
 status public.task_status not null default 'active', created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,family_id)
);
create table public.task_assignments (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id) on delete cascade,
 task_id uuid not null references public.tasks(id) on delete cascade, child_id uuid not null references public.child_profiles(id) on delete cascade,
 assigned_at timestamptz not null default now(), unique(task_id,child_id), foreign key(child_id,family_id) references public.child_profiles(id,family_id),
 foreign key(task_id,family_id) references public.tasks(id,family_id)
);
create table public.task_completions (
 id uuid primary key default gen_random_uuid(), assignment_id uuid not null references public.task_assignments(id) on delete cascade,
 status public.completion_status not null default 'assigned', submitted_at timestamptz, reviewed_by uuid references public.profiles(id), reviewed_at timestamptz,
 review_note text, awarded_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index task_completion_award_once on public.task_completions(assignment_id) where awarded_at is not null;
create table public.point_transactions (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id) on delete cascade,
 child_id uuid not null references public.child_profiles(id) on delete cascade, unit text not null check(unit in ('xp','reward_points')),
 amount integer not null check(amount<>0), source_type text not null, source_id uuid not null, created_at timestamptz not null default now(),
 foreign key(child_id,family_id) references public.child_profiles(id,family_id), unique(unit,source_type,source_id)
);
create table public.achievements (
 id uuid primary key default gen_random_uuid(), family_id uuid references public.families(id) on delete cascade,
 key text not null, name text not null, description text not null default '', created_at timestamptz not null default now(), unique(family_id,key)
);
create table public.child_achievements (
 child_id uuid not null references public.child_profiles(id) on delete cascade, achievement_id uuid not null references public.achievements(id) on delete cascade,
 earned_at timestamptz not null default now(), primary key(child_id,achievement_id)
);
create table public.rewards (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id) on delete cascade,
 name text not null, description text not null default '', point_cost integer not null check(point_cost>0), available boolean not null default true,
 redemption_limit integer check(redemption_limit is null or redemption_limit>=0), requires_approval boolean not null default true,
 created_at timestamptz not null default now(), unique(id,family_id)
);
create table public.reward_redemptions (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id) on delete cascade,
 reward_id uuid not null references public.rewards(id), child_id uuid not null references public.child_profiles(id),
 status text not null default 'requested' check(status in ('requested','approved','rejected','cancelled')),
 requested_at timestamptz not null default now(), decided_by uuid references public.profiles(id), decided_at timestamptz,
 transaction_id uuid references public.point_transactions(id), foreign key(child_id,family_id) references public.child_profiles(id,family_id),
 foreign key(reward_id,family_id) references public.rewards(id,family_id)
);
create table public.family_settings (
 family_id uuid primary key references public.families(id) on delete cascade, settings jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now()
);
create table public.notifications (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id) on delete cascade,
 user_id uuid references public.profiles(id) on delete cascade, child_id uuid references public.child_profiles(id) on delete cascade,
 kind text not null, title text not null, body text not null default '', read_at timestamptz, created_at timestamptz not null default now()
);
create index membership_user_idx on public.family_memberships(user_id,family_id);
create index assignments_child_idx on public.task_assignments(child_id,family_id);
create index completion_status_idx on public.task_completions(status,submitted_at);
create index task_due_idx on public.tasks(family_id,due_at) where status='active';
create index transactions_child_time_idx on public.point_transactions(child_id,created_at desc);
create index redemptions_queue_idx on public.reward_redemptions(family_id,status,requested_at);
create unique index one_pending_reward_per_child on public.reward_redemptions(child_id,reward_id) where status='requested';
create index child_invites_expiry_idx on public.child_link_invitations(expires_at) where redeemed_at is null and revoked_at is null;

create or replace function public.is_family_parent(fid uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from family_memberships m where m.family_id=fid and m.user_id=auth.uid() and m.role='parent') $$;
create or replace function public.can_access_child(cid uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from child_profiles c where c.id=cid and (c.auth_user_id=auth.uid() or public.is_family_parent(c.family_id))) $$;
create or replace function public.can_view_task(tid uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from tasks t where t.id=tid and (public.is_family_parent(t.family_id) or exists(
  select 1 from task_assignments a join child_profiles c on c.id=a.child_id where a.task_id=t.id and c.auth_user_id=auth.uid()))) $$;

create or replace function public.create_family(family_name text, display_name text)
returns uuid language plpgsql security definer set search_path=public as $$
declare fid uuid;
begin
 if auth.uid() is null then raise exception 'Sign-in required'; end if;
 if char_length(trim(family_name)) not between 1 and 100 or char_length(trim(display_name)) not between 1 and 80 then raise exception 'Invalid name'; end if;
 insert into profiles(id,display_name) values(auth.uid(),trim(display_name)) on conflict(id) do update set display_name=excluded.display_name;
 insert into families(name,created_by) values(trim(family_name),auth.uid()) returning id into fid;
 insert into family_memberships(family_id,user_id,role) values(fid,auth.uid(),'parent');
 insert into family_settings(family_id) values(fid);
 return fid;
end $$;

create or replace function public.create_guardian_invitation(fid uuid)
returns text language plpgsql security definer set search_path=public as $$
declare raw_token text;
begin
 if not public.is_family_parent(fid) then raise exception 'Parent membership required'; end if;
 raw_token:=encode(gen_random_bytes(24),'hex');
 insert into invitations(family_id,token_hash,intended_role,expires_at,created_by)
 values(fid,encode(digest(raw_token,'sha256'),'hex'),'parent',now()+interval '7 days',auth.uid());
 return raw_token;
end $$;

create or replace function public.redeem_guardian_invitation(raw_token text, display_name text)
returns uuid language plpgsql security definer set search_path=public as $$
declare invite record;
begin
 if auth.uid() is null then raise exception 'Sign-in required'; end if;
 if char_length(trim(display_name)) not between 1 and 80 then raise exception 'Invalid name'; end if;
 select * into invite from invitations where token_hash=encode(digest(raw_token,'sha256'),'hex') for update;
 if not found then raise exception 'Invitation is invalid or expired'; end if;
 if invite.redeemed_at is not null or invite.revoked_at is not null or invite.expires_at<=now() then raise exception 'Invitation is invalid or expired'; end if;
 insert into profiles(id,display_name) values(auth.uid(),trim(display_name)) on conflict(id) do update set display_name=excluded.display_name;
 insert into family_memberships(family_id,user_id,role) values(invite.family_id,auth.uid(),'parent') on conflict(family_id,user_id) do nothing;
 update invitations set redeemed_at=now() where id=invite.id;
 return invite.family_id;
end $$;

create or replace function public.create_child_invitation(cid uuid)
returns text language plpgsql security definer set search_path=public as $$
declare rowc record; raw_token text;
begin
 select * into rowc from child_profiles where id=cid for update;
 if not found then raise exception 'Child profile not found'; end if;
 if not public.is_family_parent(rowc.family_id) then raise exception 'Parent membership required'; end if;
 if rowc.auth_user_id is not null then raise exception 'Child profile is already linked'; end if;
 raw_token:=encode(gen_random_bytes(24),'hex');
 insert into child_link_invitations(family_id,child_id,token_hash,expires_at,created_by)
 values(rowc.family_id,cid,encode(digest(raw_token,'sha256'),'hex'),now()+interval '24 hours',auth.uid());
 return raw_token;
end $$;

create or replace function public.redeem_child_invitation(raw_token text, display_name text)
returns uuid language plpgsql security definer set search_path=public as $$
declare invite record;
begin
 if auth.uid() is null then raise exception 'Sign-in required'; end if;
 if char_length(trim(display_name)) not between 1 and 80 then raise exception 'Invalid name'; end if;
 select * into invite from child_link_invitations where token_hash=encode(digest(raw_token,'sha256'),'hex') for update;
 if not found then raise exception 'Child invitation is invalid or expired'; end if;
 if invite.redeemed_at is not null or invite.revoked_at is not null or invite.expires_at<=now() then raise exception 'Child invitation is invalid or expired'; end if;
 if exists(select 1 from family_memberships where family_id=invite.family_id and user_id=auth.uid()) then raise exception 'This account already belongs to the family'; end if;
 insert into profiles(id,display_name) values(auth.uid(),trim(display_name)) on conflict(id) do update set display_name=excluded.display_name;
 update child_profiles set auth_user_id=auth.uid() where id=invite.child_id and auth_user_id is null;
 if not found then raise exception 'Child profile is already linked'; end if;
 insert into family_memberships(family_id,user_id,role) values(invite.family_id,auth.uid(),'child');
 update child_link_invitations set redeemed_at=now() where id=invite.id;
 return invite.family_id;
end $$;

create or replace function public.assign_task(
 p_family_id uuid, p_child_id uuid, p_title text, p_description text, p_category text,
 p_xp integer, p_points integer, p_requires_approval boolean default true
) returns uuid language plpgsql security definer set search_path=public as $$
declare tid uuid; aid uuid;
begin
 if not public.is_family_parent(p_family_id) then raise exception 'Parent membership required'; end if;
 if char_length(trim(p_title)) not between 1 and 120 or p_xp not between 0 and 500 or p_points not between 0 and 500 then raise exception 'Invalid mission values'; end if;
 if not exists(select 1 from child_profiles where id=p_child_id and family_id=p_family_id) then raise exception 'Child is not in this family'; end if;
 insert into tasks(family_id,title,description,category,xp_reward,point_reward,requires_approval,created_by)
 values(p_family_id,trim(p_title),coalesce(p_description,''),trim(p_category),p_xp,p_points,coalesce(p_requires_approval,true),auth.uid()) returning id into tid;
 insert into task_assignments(family_id,task_id,child_id) values(p_family_id,tid,p_child_id) returning id into aid;
 insert into task_completions(assignment_id,status) values(aid,'assigned');
 return aid;
end $$;

create or replace function public.submit_completion(p_assignment_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare rowc record; rowt record;
begin
 select c.id as completion_id,c.status,a.family_id,a.child_id,a.task_id,ch.auth_user_id
 into rowc from task_completions c join task_assignments a on a.id=c.assignment_id
 join child_profiles ch on ch.id=a.child_id where a.id=p_assignment_id order by c.created_at desc limit 1 for update of c;
 if not found then raise exception 'Assigned mission not found'; end if;
 if not public.is_family_parent(rowc.family_id) and rowc.auth_user_id is distinct from auth.uid() then raise exception 'You cannot submit this family mission'; end if;
 if rowc.status not in ('assigned','in_progress','needs_revision') then raise exception 'Mission is not ready to submit'; end if;
 select * into rowt from tasks where id=rowc.task_id;
 if rowt.requires_approval then
  update task_completions set status='pending_approval',submitted_at=now(),updated_at=now(),review_note=null where id=rowc.completion_id;
 else
  update task_completions set status='approved',submitted_at=now(),reviewed_at=now(),awarded_at=now(),updated_at=now() where id=rowc.completion_id;
  if rowt.xp_reward>0 then insert into point_transactions(family_id,child_id,unit,amount,source_type,source_id) values(rowc.family_id,rowc.child_id,'xp',rowt.xp_reward,'task_completion',rowc.completion_id); end if;
  if rowt.point_reward>0 then insert into point_transactions(family_id,child_id,unit,amount,source_type,source_id) values(rowc.family_id,rowc.child_id,'reward_points',rowt.point_reward,'task_completion',rowc.completion_id); end if;
  update child_profiles set xp=xp+rowt.xp_reward,points=points+rowt.point_reward where id=rowc.child_id;
 end if;
end $$;

create or replace function public.request_reward(p_reward_id uuid, p_child_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare rw record; ch record; rid uuid;
begin
 select * into rw from rewards where id=p_reward_id for update;
 if not found then raise exception 'Reward is unavailable'; end if;
 if not rw.available then raise exception 'Reward is unavailable'; end if;
 select * into ch from child_profiles where id=p_child_id and family_id=rw.family_id for update;
 if not found then raise exception 'Child does not belong to this reward family'; end if;
 if not public.is_family_parent(rw.family_id) and ch.auth_user_id is distinct from auth.uid() then raise exception 'You cannot request a reward for this child'; end if;
 if ch.points<rw.point_cost then raise exception 'Not enough points'; end if;
 insert into reward_redemptions(family_id,reward_id,child_id,status) values(rw.family_id,rw.id,ch.id,'requested') returning id into rid;
 return rid;
end $$;

-- Approval records and awards in one transaction; completion and transaction uniqueness prevent repeats.
create or replace function public.review_completion(completion_id uuid, approve boolean, note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare rowc record; rowt record;
begin
 select c.*,a.family_id,a.child_id,a.task_id into rowc from task_completions c join task_assignments a on a.id=c.assignment_id where c.id=completion_id for update;
 if not found then raise exception 'Completion not found'; end if;
 if not public.is_family_parent(rowc.family_id) then raise exception 'Parent membership required'; end if;
 if rowc.status <> 'pending_approval' or rowc.awarded_at is not null then raise exception 'Completion is not awaiting review'; end if;
 update task_completions set status=case when approve then 'approved'::completion_status else 'needs_revision'::completion_status end,
 reviewed_by=auth.uid(),reviewed_at=now(),review_note=left(note,500),awarded_at=case when approve then now() else null end,updated_at=now() where id=completion_id;
 if approve then
  select * into rowt from tasks where id=rowc.task_id;
  if rowt.xp_reward>0 then insert into point_transactions(family_id,child_id,unit,amount,source_type,source_id) values(rowc.family_id,rowc.child_id,'xp',rowt.xp_reward,'task_completion',completion_id); end if;
  if rowt.point_reward>0 then insert into point_transactions(family_id,child_id,unit,amount,source_type,source_id) values(rowc.family_id,rowc.child_id,'reward_points',rowt.point_reward,'task_completion',completion_id); end if;
  update child_profiles set xp=xp+rowt.xp_reward,points=points+rowt.point_reward where id=rowc.child_id;
 end if;
end $$;

create or replace function public.decide_redemption(redemption_id uuid, approve boolean)
returns void language plpgsql security definer set search_path=public as $$
declare rr record;
begin
 select r.*,rw.point_cost,rw.available into rr from reward_redemptions r join rewards rw on rw.id=r.reward_id where r.id=redemption_id for update;
 if not found then raise exception 'Request not found'; end if;
 if not public.is_family_parent(rr.family_id) then raise exception 'Parent membership required'; end if;
 if rr.status<>'requested' then raise exception 'Request already decided'; end if;
 if approve then
  if not rr.available then raise exception 'Reward is unavailable'; end if;
  update child_profiles set points=points-rr.point_cost where id=rr.child_id and points>=rr.point_cost;
  if not found then raise exception 'Not enough points'; end if;
  insert into point_transactions(family_id,child_id,unit,amount,source_type,source_id) values(rr.family_id,rr.child_id,'reward_points',-rr.point_cost,'redemption',redemption_id);
  update reward_redemptions set status='approved',decided_by=auth.uid(),decided_at=now() where id=redemption_id;
 else update reward_redemptions set status='rejected',decided_by=auth.uid(),decided_at=now() where id=redemption_id;
 end if;
end $$;

alter table public.profiles enable row level security;
alter table public.families enable row level security;
alter table public.family_memberships enable row level security;
alter table public.child_profiles enable row level security;
alter table public.invitations enable row level security;
alter table public.child_link_invitations enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignments enable row level security;
alter table public.task_completions enable row level security;
alter table public.point_transactions enable row level security;
alter table public.achievements enable row level security;
alter table public.child_achievements enable row level security;
alter table public.rewards enable row level security;
alter table public.reward_redemptions enable row level security;
alter table public.family_settings enable row level security;
alter table public.notifications enable row level security;

create policy profiles_self_select on profiles for select using(id=auth.uid());
create policy profiles_self_update on profiles for update using(id=auth.uid()) with check(id=auth.uid());
create policy families_member_select on families for select using(exists(select 1 from family_memberships m where m.family_id=families.id and m.user_id=auth.uid()));
create policy families_parent_update on families for update using(public.is_family_parent(id)) with check(public.is_family_parent(id));
create policy memberships_visible on family_memberships for select using(user_id=auth.uid() or public.is_family_parent(family_memberships.family_id));
create policy memberships_parent_manage on family_memberships for all using(public.is_family_parent(family_id)) with check(public.is_family_parent(family_id));
create policy children_family_select on child_profiles for select using(public.can_access_child(id));
create policy children_parent_manage on child_profiles for all using(public.is_family_parent(family_id)) with check(public.is_family_parent(family_id));
create policy invitations_parent_manage on invitations for all using(public.is_family_parent(family_id)) with check(public.is_family_parent(family_id));
create policy child_invites_parent_manage on child_link_invitations for all using(public.is_family_parent(family_id)) with check(public.is_family_parent(family_id));
create policy tasks_family_select on tasks for select using(public.can_view_task(id));
create policy tasks_parent_manage on tasks for all using(public.is_family_parent(family_id)) with check(public.is_family_parent(family_id));
create policy assignments_family_select on task_assignments for select using(public.can_access_child(child_id));
create policy assignments_parent_manage on task_assignments for all using(public.is_family_parent(family_id)) with check(public.is_family_parent(family_id));
create policy completion_family_select on task_completions for select using(exists(select 1 from task_assignments a where a.id=assignment_id and public.can_access_child(a.child_id)));
create policy completion_child_submit on task_completions for insert with check(exists(select 1 from task_assignments a where a.id=assignment_id and public.can_access_child(a.child_id)) and status in ('assigned','in_progress','pending_approval'));
create policy completion_parent_review on task_completions for update using(exists(select 1 from task_assignments a where a.id=assignment_id and public.is_family_parent(a.family_id))) with check(exists(select 1 from task_assignments a where a.id=assignment_id and public.is_family_parent(a.family_id)));
create policy transactions_family_select on point_transactions for select using(public.can_access_child(child_id));
create policy achievements_family_select on achievements for select using(family_id is null or exists(select 1 from family_memberships m where m.family_id=achievements.family_id and m.user_id=auth.uid()));
create policy achievements_parent_manage on achievements for all using(family_id is not null and public.is_family_parent(family_id)) with check(family_id is not null and public.is_family_parent(family_id));
create policy child_achievements_select on child_achievements for select using(public.can_access_child(child_id));
create policy child_achievements_parent_manage on child_achievements for all using(exists(select 1 from child_profiles c where c.id=child_id and public.is_family_parent(c.family_id))) with check(exists(select 1 from child_profiles c where c.id=child_id and public.is_family_parent(c.family_id)));
create policy rewards_family_select on rewards for select using(exists(select 1 from family_memberships m where m.family_id=rewards.family_id and m.user_id=auth.uid()));
create policy rewards_parent_manage on rewards for all using(public.is_family_parent(family_id)) with check(public.is_family_parent(family_id));
create policy redemption_family_select on reward_redemptions for select using(public.can_access_child(child_id));
create policy redemption_child_request on reward_redemptions for insert with check(public.can_access_child(child_id) and status='requested');
create policy redemption_parent_decide on reward_redemptions for update using(public.is_family_parent(family_id)) with check(public.is_family_parent(family_id));
create policy settings_family_select on family_settings for select using(exists(select 1 from family_memberships m where m.family_id=family_settings.family_id and m.user_id=auth.uid() and m.role='parent'));
create policy settings_parent_manage on family_settings for all using(public.is_family_parent(family_id)) with check(public.is_family_parent(family_id));
create policy notifications_visible on notifications for select using(user_id=auth.uid() or (child_id is not null and public.can_access_child(child_id)));
create policy notifications_update_self on notifications for update using(user_id=auth.uid()) with check(user_id=auth.uid());

do $$
declare tbl text;
begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach tbl in array array['child_profiles','tasks','task_assignments','task_completions','point_transactions','rewards','reward_redemptions','child_achievements','notifications'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=tbl) then
    execute format('alter publication supabase_realtime add table public.%I',tbl);
   end if;
  end loop;
 end if;
end $$;

revoke all on function public.review_completion(uuid,boolean,text) from public, anon;
revoke all on function public.decide_redemption(uuid,boolean) from public, anon;
revoke all on function public.create_family(text,text) from public, anon;
revoke all on function public.create_guardian_invitation(uuid) from public, anon;
revoke all on function public.redeem_guardian_invitation(text,text) from public, anon;
revoke all on function public.create_child_invitation(uuid) from public, anon;
revoke all on function public.redeem_child_invitation(text,text) from public, anon;
revoke all on function public.assign_task(uuid,uuid,text,text,text,integer,integer,boolean) from public, anon;
revoke all on function public.submit_completion(uuid) from public, anon;
revoke all on function public.request_reward(uuid,uuid) from public, anon;
revoke all on function public.is_family_parent(uuid) from public, anon;
revoke all on function public.can_access_child(uuid) from public, anon;
revoke all on function public.can_view_task(uuid) from public, anon;
grant execute on function public.review_completion(uuid,boolean,text) to authenticated;
grant execute on function public.decide_redemption(uuid,boolean) to authenticated;
grant execute on function public.create_family(text,text) to authenticated;
grant execute on function public.create_guardian_invitation(uuid) to authenticated;
grant execute on function public.redeem_guardian_invitation(text,text) to authenticated;
grant execute on function public.create_child_invitation(uuid) to authenticated;
grant execute on function public.redeem_child_invitation(text,text) to authenticated;
grant execute on function public.assign_task(uuid,uuid,text,text,text,integer,integer,boolean) to authenticated;
grant execute on function public.submit_completion(uuid) to authenticated;
grant execute on function public.request_reward(uuid,uuid) to authenticated;
grant execute on function public.is_family_parent(uuid) to authenticated;
grant execute on function public.can_access_child(uuid) to authenticated;
grant execute on function public.can_view_task(uuid) to authenticated;
revoke update on public.task_completions, public.reward_redemptions, public.point_transactions, public.child_profiles from authenticated;
revoke insert on public.task_completions from authenticated;
revoke insert on public.reward_redemptions from authenticated;
grant update(display_name,age,theme) on public.child_profiles to authenticated;

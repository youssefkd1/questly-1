-- Short-lived, easy-to-share family join codes. The table is only accessed by
-- SECURITY DEFINER RPCs; clients never receive direct table access.
create table public.family_access_codes (
 id uuid primary key default gen_random_uuid(),
 family_id uuid not null references public.families(id) on delete cascade,
 child_id uuid,
 join_role public.member_role not null,
 code text not null unique check(code ~ '^[0-9]{6}$'),
 expires_at timestamptz not null,
 redeemed_at timestamptz,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 foreign key(child_id,family_id) references public.child_profiles(id,family_id),
 check ((join_role='parent' and child_id is null) or (join_role='child' and child_id is not null))
);
create unique index family_access_codes_active_target
 on public.family_access_codes(family_id,join_role,coalesce(child_id,'00000000-0000-0000-0000-000000000000'::uuid));
create index family_access_codes_expiry on public.family_access_codes(expires_at);
alter table public.family_access_codes enable row level security;
revoke all on public.family_access_codes from anon, authenticated;

create or replace function public.get_family_access_code(p_family_id uuid,p_child_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_role member_role; v_code text; v_bytes bytea; v_expiry timestamptz; v_target uuid;
begin
 if auth.uid() is null or not public.is_family_parent(p_family_id) then raise exception 'Parent membership required'; end if;
 v_role:=case when p_child_id is null then 'parent'::member_role else 'child'::member_role end;
 v_target:=coalesce(p_child_id,'00000000-0000-0000-0000-000000000000'::uuid);
 if p_child_id is not null and not exists(select 1 from child_profiles where id=p_child_id and family_id=p_family_id and auth_user_id is null) then
  raise exception 'Child profile is missing or already linked';
 end if;
 perform pg_advisory_xact_lock(hashtext(p_family_id::text||':'||v_target::text));
 delete from family_access_codes where expires_at<=now() or redeemed_at is not null;
 select code,expires_at into v_code,v_expiry from family_access_codes
  where family_id=p_family_id and join_role=v_role
   and coalesce(child_id,'00000000-0000-0000-0000-000000000000'::uuid)=v_target
   and expires_at>now() and redeemed_at is null;
 if v_code is not null then return jsonb_build_object('code',v_code,'expires_at',v_expiry,'role',v_role); end if;
 loop
  v_bytes:=gen_random_bytes(4);
  v_code:=lpad(((get_byte(v_bytes,0)::bigint*16777216 + get_byte(v_bytes,1)::bigint*65536 + get_byte(v_bytes,2)::bigint*256 + get_byte(v_bytes,3)::bigint) % 1000000)::text,6,'0');
  begin
   insert into family_access_codes(family_id,child_id,join_role,code,expires_at,created_by)
    values(p_family_id,p_child_id,v_role,v_code,now()+interval '15 minutes',auth.uid()) returning expires_at into v_expiry;
   exit;
  exception when unique_violation then
   v_code:=null;
  end;
 end loop;
 return jsonb_build_object('code',v_code,'expires_at',v_expiry,'role',v_role);
end $$;

create or replace function public.redeem_family_access_code(p_code text,p_display_name text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare invite family_access_codes%rowtype;
begin
 if auth.uid() is null then raise exception 'Sign-in required'; end if;
 if char_length(trim(p_display_name)) not between 1 and 80 then raise exception 'Enter a name between 1 and 80 characters'; end if;
 if trim(p_code) !~ '^[0-9]{6}$' then raise exception 'Enter the current six-digit family code'; end if;
 select * into invite from family_access_codes where code=trim(p_code) for update;
 if not found or invite.expires_at<=now() or invite.redeemed_at is not null then raise exception 'That code has expired or was already used. Ask the parent for the current code.'; end if;
 if exists(select 1 from family_memberships where family_id=invite.family_id and user_id=auth.uid()) then
  raise exception 'This account already belongs to that family';
 end if;
 insert into profiles(id,display_name) values(auth.uid(),trim(p_display_name))
  on conflict(id) do update set display_name=excluded.display_name;
 if invite.join_role='parent' then
  insert into family_memberships(family_id,user_id,role) values(invite.family_id,auth.uid(),'parent');
 else
  update child_profiles set auth_user_id=auth.uid()
   where id=invite.child_id and family_id=invite.family_id and auth_user_id is null;
  if not found then raise exception 'This child profile has already been linked. Ask the parent for help.'; end if;
  insert into family_memberships(family_id,user_id,role) values(invite.family_id,auth.uid(),'child');
  update family_access_codes set redeemed_at=now() where id=invite.id;
 end if;
 return jsonb_build_object('family_id',invite.family_id,'role',invite.join_role);
end $$;

revoke all on function public.get_family_access_code(uuid,uuid) from public,anon;
revoke all on function public.redeem_family_access_code(text,text) from public,anon;
grant execute on function public.get_family_access_code(uuid,uuid) to authenticated;
grant execute on function public.redeem_family_access_code(text,text) to authenticated;

-- pgcrypto may be installed outside the function's restricted search_path.
-- gen_random_uuid() is available from pg_catalog and provides the secure
-- randomness needed for a short-lived invitation code.
create or replace function public.get_family_access_code(p_family_id uuid,p_child_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_role member_role; v_code text; v_expiry timestamptz; v_target uuid; v_bytes bytea;
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
  v_bytes:=pg_catalog.decode(substr(replace(pg_catalog.gen_random_uuid()::text,'-',''),1,8),'hex');
  v_code:=lpad(((pg_catalog.get_byte(v_bytes,0)::bigint*16777216 + pg_catalog.get_byte(v_bytes,1)::bigint*65536 + pg_catalog.get_byte(v_bytes,2)::bigint*256 + pg_catalog.get_byte(v_bytes,3)::bigint) % 1000000)::text,6,'0');
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

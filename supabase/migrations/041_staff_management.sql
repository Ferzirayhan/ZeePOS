-- 041_staff_management.sql
-- In-app staff & cashier management for tenant admins

CREATE OR REPLACE FUNCTION create_staff_member(
  p_email TEXT,
  p_password TEXT,
  p_nama TEXT,
  p_username TEXT,
  p_role user_role DEFAULT 'kasir'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_tenant_id UUID := get_my_tenant_id();
  v_new_user_id UUID := gen_random_uuid();
  v_encrypted_pw TEXT;
BEGIN
  -- 1. Security check: Caller must be admin with valid tenant
  IF NOT is_admin() OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Hanya admin toko yang dapat menambahkan staf';
  END IF;

  -- 2. Input validation
  IF p_email IS NULL OR p_email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'Format email tidak valid';
  END IF;

  IF length(p_password) < 6 THEN
    RAISE EXCEPTION 'Password minimal 6 karakter';
  END IF;

  IF trim(COALESCE(p_nama, '')) = '' THEN
    RAISE EXCEPTION 'Nama staf wajib diisi';
  END IF;

  IF trim(COALESCE(p_username, '')) = '' THEN
    RAISE EXCEPTION 'Username staf wajib diisi';
  END IF;

  -- Check email duplication
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = lower(trim(p_email))) THEN
    RAISE EXCEPTION 'Email sudah terdaftar';
  END IF;

  -- Check username duplication
  IF EXISTS (SELECT 1 FROM profiles WHERE username = lower(trim(p_username))) THEN
    RAISE EXCEPTION 'Username sudah digunakan';
  END IF;

  v_encrypted_pw := extensions.crypt(p_password, extensions.gen_salt('bf'));

  -- 3. Create auth.users row
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    is_sso_user,
    is_anonymous
  )
  VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_new_user_id,
    'authenticated',
    'authenticated',
    lower(trim(p_email)),
    v_encrypted_pw,
    NOW(),
    NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('nama', trim(p_nama), 'username', lower(trim(p_username))),
    NOW(),
    NOW(),
    false,
    false
  );

  -- 4. Create public.profiles row
  INSERT INTO public.profiles (
    id,
    nama,
    username,
    role,
    tenant_id,
    is_active
  )
  VALUES (
    v_new_user_id,
    trim(p_nama),
    lower(trim(p_username)),
    p_role,
    v_tenant_id,
    true
  );

  -- 5. Audit log
  PERFORM insert_audit_log(
    auth.uid(),
    'staff',
    v_new_user_id::TEXT,
    'staff_created',
    'Staf baru ' || trim(p_nama) || ' (' || p_role::TEXT || ') berhasil didaftarkan.',
    jsonb_build_object('email', lower(trim(p_email)), 'username', lower(trim(p_username)), 'role', p_role::TEXT)
  );

  RETURN jsonb_build_object(
    'id', v_new_user_id,
    'email', lower(trim(p_email)),
    'nama', trim(p_nama),
    'username', lower(trim(p_username)),
    'role', p_role::TEXT
  );
END;
$$;

-- Function for admin to reset staff password
CREATE OR REPLACE FUNCTION reset_staff_password(
  p_user_id UUID,
  p_new_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_tenant_id UUID := get_my_tenant_id();
  v_target_profile profiles%ROWTYPE;
BEGIN
  IF NOT is_admin() OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Hanya admin toko yang dapat mereset password staf';
  END IF;

  IF length(p_new_password) < 6 THEN
    RAISE EXCEPTION 'Password baru minimal 6 karakter';
  END IF;

  SELECT *
  INTO v_target_profile
  FROM profiles
  WHERE id = p_user_id
    AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staf tidak ditemukan di toko ini';
  END IF;

  UPDATE auth.users
  SET
    encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
    updated_at = NOW()
  WHERE id = p_user_id;

  PERFORM insert_audit_log(
    auth.uid(),
    'staff',
    p_user_id::TEXT,
    'staff_password_reset',
    'Password untuk staf ' || v_target_profile.nama || ' telah direset.',
    '{}'::jsonb
  );

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'success', true
  );
END;
$$;

-- Migration 063: Set default tenant_id for customers to get_my_tenant_id()
ALTER TABLE public.customers 
ALTER COLUMN tenant_id SET DEFAULT get_my_tenant_id();

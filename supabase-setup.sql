-- شغّل الملف ده مرة واحدة بس في Supabase: SQL Editor -> New query -> الصق -> Run
-- بيعمل جدول لكل نوع بيانات في البرنامج (مرضى، زيارات، مدفوعات...) ويفعّل التحديث اللحظي.

do $$
declare
  t text;
  tables text[] := array[
    'patients','appointments','visits','visitServices','services','serviceCategories',
    'payments','expenses','expenseCategories','visitTypes','paymentMethods',
    'appointmentStatuses','patientSources','drugs','prescriptions','prescriptionItems',
    'prescriptionTemplates','treatmentPlans','doctors'
  ];
begin
  foreach t in array tables loop
    execute format('create table if not exists public.%I (
      sync_id uuid primary key,
      data jsonb not null,
      updated_at timestamptz not null default now(),
      deleted boolean not null default false
    )', t);
    execute format('create index if not exists %I on public.%I (updated_at)', t || '_updated_idx', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "clinic_all" on public.%I', t);
    execute format('create policy "clinic_all" on public.%I for all to anon using (true) with check (true)', t);
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when others then null;
    end;
  end loop;
end $$;

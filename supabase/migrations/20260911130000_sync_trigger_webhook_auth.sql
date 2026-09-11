-- Migration: Synchronize Database Trigger Authentication & Vault Health Diagnostic
-- Adds Authorization: Bearer <service_role_key> alongside x-webhook-secret to eliminate HTTP 401s on inter-agent triggers
-- Adds public.check_vault_secrets_health() RPC for autonomous SRE auditing

CREATE OR REPLACE FUNCTION public.trigger_trade_executor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
declare
  webhook_url text := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1';
  payload jsonb;
  request_id bigint;
  secret_val text;
  service_key text;
begin
  payload := jsonb_build_object(
    'type', TG_OP,
    'table', TG_TABLE_NAME,
    'schema', TG_TABLE_SCHEMA,
    'record', row_to_json(NEW),
    'old_record', row_to_json(OLD)
  );

  SELECT decrypted_secret INTO secret_val FROM vault.decrypted_secrets WHERE name = 'webhook_secret' LIMIT 1;
  SELECT decrypted_secret INTO service_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;

  select net.http_post(
    url := webhook_url || '/agent-trade',
    body := payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', COALESCE(secret_val, 'FALLBACK_SECRET_123'),
      'Authorization', 'Bearer ' || COALESCE(service_key, '')
    )
  ) into request_id;

  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.trigger_telegram_broadcast()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
declare
  webhook_url text := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1';
  payload jsonb;
  request_id bigint;
  secret_val text;
  service_key text;
begin
  SELECT decrypted_secret INTO secret_val FROM vault.decrypted_secrets WHERE name = 'webhook_secret' LIMIT 1;
  SELECT decrypted_secret INTO service_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;

  payload := jsonb_build_object(
    'type', TG_OP,
    'table', TG_TABLE_NAME,
    'schema', TG_TABLE_SCHEMA,
    'record', row_to_json(NEW),
    'old_record', row_to_json(OLD)
  );

  select net.http_post(
    url := webhook_url || '/telegram-broadcast',
    body := payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', COALESCE(secret_val, 'FALLBACK_SECRET_123'),
      'Authorization', 'Bearer ' || COALESCE(service_key, '')
    )
  ) into request_id;

  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.handle_rejected_signal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
declare
  secret_val text;
  service_key text;
BEGIN
  IF NEW.status = 'REJECTED' AND OLD.status != 'REJECTED' THEN
    SELECT decrypted_secret INTO secret_val FROM vault.decrypted_secrets WHERE name = 'webhook_secret' LIMIT 1;
    SELECT decrypted_secret INTO service_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
    PERFORM net.http_post(
      url:='https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-trade',
      headers:=jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', COALESCE(secret_val, 'FALLBACK_SECRET_123'),
        'Authorization', 'Bearer ' || COALESCE(service_key, '')
      ),
      body:=jsonb_build_object(
        'type', 'UPDATE',
        'table', 'trade_opportunities',
        'record', row_to_json(NEW),
        'old_record', row_to_json(OLD)
      )
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_vault_secrets_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $function$
DECLARE
  has_webhook_secret boolean;
  has_service_role_key boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name = 'webhook_secret' AND decrypted_secret IS NOT NULL) INTO has_webhook_secret;
  SELECT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key' AND decrypted_secret IS NOT NULL) INTO has_service_role_key;

  IF NOT has_webhook_secret THEN
    RETURN jsonb_build_object('is_desynced', true, 'message', 'Missing webhook_secret in vault.decrypted_secrets');
  ELSIF NOT has_service_role_key THEN
    RETURN jsonb_build_object('is_desynced', true, 'message', 'Missing service_role_key in vault.decrypted_secrets');
  ELSE
    RETURN jsonb_build_object('is_desynced', false, 'message', 'Vault secrets synchronized and healthy');
  END IF;
END;
$function$;

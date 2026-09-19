-- Imported history and WhatsApp Business App echoes are persistence-only.
-- The existing automatic-deal trigger must run only for genuinely live
-- Cloud API inbound messages. App-layer handlers already suppress unread,
-- automations, AI, public notifications and Meta attribution; this WHEN
-- clause is the database-level backstop for the one trigger side effect.

DROP TRIGGER IF EXISTS create_deal_on_whatsapp_inbound ON public.messages;

CREATE TRIGGER create_deal_on_whatsapp_inbound
  AFTER INSERT ON public.messages
  FOR EACH ROW
  WHEN (NEW.source = 'cloud_api')
  EXECUTE FUNCTION public.create_deal_on_whatsapp_inbound();

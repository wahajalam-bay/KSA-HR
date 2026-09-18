-- The acknowledgement the product promises and did not have.
--
-- "Acknowledge every application within 5 minutes" ships enabled and its action
-- names a template called `application_received`. There was no such template:
-- the rule was written against wording nobody had written, so every application
-- since the system was switched on would have failed the rule and left a failed
-- automation run behind it.
--
-- The wording lives here rather than in code so that Settings → Templates can
-- edit it, which is the whole reason templates are a table.
INSERT INTO email_templates (id, name, stage, lang, subject, body, sort_order)
VALUES (
  'tpl_ack',
  'Application received',
  'applied',
  'en',
  'We have your application — {{job_title}}',
  'Hi {{first_name}},' || chr(10) || chr(10) ||
  'Thank you for applying to {{job_title}} at Bayut KSA. Your application is with the '  ||
  'talent acquisition team and we read every one.' || chr(10) || chr(10) ||
  'If your experience matches what the role needs, we will be in touch within five '  ||
  'working days to arrange a short call. If we go another way this time, we will tell '  ||
  'you rather than leave you waiting.' || chr(10) || chr(10) ||
  'Best regards,' || chr(10) ||
  'Talent Acquisition — Bayut KSA',
  0
)
ON CONFLICT (id) DO NOTHING;

-- Point the rule at it by its id, so the action no longer depends on a stage
-- name that a pipeline template could rename.
UPDATE automation_rules
   SET actions = jsonb_build_array(
         jsonb_build_object('type', 'send_message', 'channel', 'Email', 'template', 'tpl_ack'))
 WHERE trigger = 'application.created'
   AND actions @> '[{"type": "send_message"}]'::jsonb;

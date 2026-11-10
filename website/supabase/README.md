# Original persistence source

The 21 migrations preserve the website's original database implementation: AI consent and atomic usage reservations, beta authorisation, Linux generation/grading provenance, feedback, generation jobs, diversity indexes and web-lab control-plane security.

They are historical source, not a complete new-install database baseline or a verified migration sequence for a new service. Some depend on schema that existed before the first retained migration. They have not been applied or connected to a database during portfolio preparation.

The local website demo does not use Supabase. Its synthetic data adapters replace the hosted services, so no project, account, database, key or migration is needed to run the demo.

`config.toml` is the original local CLI scaffold with a generic project label and reserved example email addresses. It is retained for source context. Linked-project caches, connection details, credentials, backups and provider state are excluded. The original production-provisioning script and private operational runbooks are also excluded.

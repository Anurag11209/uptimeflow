-- Domain expiry monitoring: adds a DOMAIN monitor type (registration/WHOIS
-- expiry, distinct from TLS cert expiry which SSL monitors already cover) and
-- a matching DOMAIN_EXPIRY_DAYS assertion source, mirroring how SSL_EXPIRY_DAYS
-- pairs with the SSL monitor type. No new columns: DOMAIN monitors reuse the
-- existing `host` field, the same way TCP/PING/DNS do.

ALTER TYPE "MonitorType" ADD VALUE IF NOT EXISTS 'DOMAIN';
ALTER TYPE "AssertionSource" ADD VALUE IF NOT EXISTS 'DOMAIN_EXPIRY_DAYS';

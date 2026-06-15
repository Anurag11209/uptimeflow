-- Incident management: add the RECOVERING monitor-health state (a monitor that
-- was DOWN and is now passing, but has not yet met its success threshold).
ALTER TYPE "MonitorHealth" ADD VALUE IF NOT EXISTS 'RECOVERING';

# Disaster Recovery Runbook

Scope: the AWS infrastructure defined in `infra/terraform`. Covers backups,
restore procedures, and recovery objectives for each stateful component.

## Recovery objectives

| Component | Strategy | RPO | RTO |
|---|---|---|---|
| RDS PostgreSQL | Automated backups + PITR; manual snapshots | ≤ 5 min (PITR) | ~30–60 min |
| ElastiCache Redis | Daily snapshots; treated as recoverable cache | ≤ 24 h | ~15 min |
| S3 (audit logs) | Versioning + lifecycle | ~0 (versioned) | minutes |
| Secrets Manager | 7-day recovery window on delete | n/a | minutes |
| ECS/ALB/VPC | Re-creatable from Terraform | n/a | ~20–40 min |

Redis holds sessions + BullMQ queues — it is **not** the system of record. A
failover signs users out (they re-authenticate) and re-drives unacked jobs.

## Backups (what runs automatically)

- **RDS**: `backup_retention_days` (prod 30) enables daily automated backups +
  point-in-time recovery. Backups are encrypted; `copy_tags_to_snapshot = true`.
  Final snapshot is taken on destroy when `deletion_protection = true`.
- **Redis**: `snapshot_retention_limit = 5` daily snapshots.
- **S3 audit logs**: versioned; noncurrent versions transition to STANDARD_IA and
  expire per `s3_noncurrent_expiration_days`.
- **State**: the Terraform S3 backend bucket is versioned (every apply is
  recoverable).

## Restore procedures

### RDS — point-in-time recovery

```bash
# Restore to a new instance at a timestamp (does not overwrite the original).
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier uptimeflow-production-postgres \
  --target-db-instance-identifier uptimeflow-production-postgres-restore \
  --restore-time 2026-06-28T12:00:00Z \
  --db-subnet-group-name <subnet-group> --no-publicly-accessible

# Validate the restored data, then cut over by updating the DATABASE_URL secret
# to the restored endpoint and forcing a new deployment:
aws secretsmanager put-secret-value --secret-id uptimeflow-production/database-url \
  --secret-string 'postgresql://USER:PASS@<restored-endpoint>:5432/uptimeflow?schema=public&sslmode=require'
aws ecs update-service --cluster uptimeflow-production --service uptimeflow-production-api    --force-new-deployment
aws ecs update-service --cluster uptimeflow-production --service uptimeflow-production-worker --force-new-deployment
```

### RDS — from a snapshot

`aws rds restore-db-instance-from-db-snapshot` with the snapshot id, then cut over
as above. To adopt the restored instance into Terraform, replace the source
endpoint or re-point via `terraform import`.

### Redis

Redis is a cache/queue. Preferred recovery is to let Terraform recreate the
replication group; clients reconnect and re-drive jobs. To restore data, create a
replication group from a snapshot (`snapshot_name`) and update the `redis-url`
secret to the new endpoint.

### S3 audit logs

Restore a deleted/overwritten object from its previous version:
`aws s3api list-object-versions` → `aws s3api get-object --version-id …`.

### Secrets Manager

A deleted secret can be restored within the 7-day recovery window:
`aws secretsmanager restore-secret --secret-id <name>`.

### Full region rebuild

1. Ensure the state bucket (or a replica) exists in the target region.
2. `terraform init` + `terraform apply -var-file=environments/production.tfvars`
   (set `aws_region`).
3. Restore RDS from the latest snapshot (copy the snapshot cross-region first if
   needed) and update the `database-url` secret.
4. Push images / let CI deploy; point DNS at the new ALB.

## Routine DR validation

- Quarterly: restore the latest RDS snapshot to a throwaway instance and run a
  read query to confirm integrity.
- Before major releases: confirm `terraform plan` is clean (no drift) and that the
  migration task succeeds against a staging restore.
- Verify CloudWatch alarms page the on-call SNS subscription (`alarm_email`).

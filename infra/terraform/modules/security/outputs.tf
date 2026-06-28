output "alb_sg_id" {
  value = aws_security_group.alb.id
}

output "api_sg_id" {
  value = aws_security_group.api.id
}

output "web_sg_id" {
  value = aws_security_group.web.id
}

output "worker_sg_id" {
  value = aws_security_group.worker.id
}

output "rds_sg_id" {
  value = aws_security_group.rds.id
}

output "redis_sg_id" {
  value = aws_security_group.redis.id
}

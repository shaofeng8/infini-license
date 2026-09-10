-- 初始数据
--
-- 注意：默认管理员与首把签名密钥**不在这里创建**。
-- 密码需要 scrypt 哈希，私钥需要用 LICENSE_MASTER_KEY 做 AES-256-GCM 加密，
-- 两者都无法在 SQL 里完成，由服务启动时的 BootstrapService 幂等创建。
-- 见 packages/server/src/modules/bootstrap/bootstrap.service.ts

USE `infini_license`;

INSERT INTO `lc_sequence` (`name`, `next_value`)
VALUES ('LIC-2026', 1), ('TRL-2026', 1)
ON DUPLICATE KEY UPDATE `name` = `name`;

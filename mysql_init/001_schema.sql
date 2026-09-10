-- InfiniSynapse License 服务 · 初始化 schema
-- 设计文档：docs/03-database-schema.md
--
-- 约定：
--   主键 _id VARCHAR(24)，由应用层 createObjectId() 生成
--   时间统一以 UTC 存 DATETIME(3)，展示层按 Asia/Shanghai 渲染
--   限额字段为 NULL 一律表示「不限制」

CREATE DATABASE IF NOT EXISTS `infini_license`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE `infini_license`;

-- ---------------------------------------------------------------------------
-- 客户
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `lc_customer` (
  `_id`           VARCHAR(24)  NOT NULL,
  `name`          VARCHAR(255) NOT NULL COMMENT '客户全称；试用自动创建时为 "试用客户 (hostname)"',
  `short_name`    VARCHAR(64)           DEFAULT NULL,
  `source`        VARCHAR(16)  NOT NULL DEFAULT 'manual' COMMENT 'manual 运营录入 / trial_auto 试用自动创建',
  `stage`         VARCHAR(16)  NOT NULL DEFAULT 'lead' COMMENT 'lead / trial / customer / churned',
  `contact_name`  VARCHAR(64)           DEFAULT NULL,
  `contact_phone` VARCHAR(32)           DEFAULT NULL,
  `contact_email` VARCHAR(128)          DEFAULT NULL,
  `industry`      VARCHAR(64)           DEFAULT NULL,
  `region`        VARCHAR(64)           DEFAULT NULL,
  `sales_owner`   VARCHAR(64)           DEFAULT NULL,
  `remark`        TEXT                  DEFAULT NULL,
  `status`        TINYINT      NOT NULL DEFAULT 1 COMMENT '1 正常 0 停用',
  `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`_id`),
  KEY `idx_customer_name` (`name`),
  KEY `idx_customer_stage` (`stage`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客户';

-- ---------------------------------------------------------------------------
-- 授权
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `lc_license` (
  `_id`                  VARCHAR(24)  NOT NULL,
  `license_no`           VARCHAR(32)  NOT NULL COMMENT '正式 LIC-2026-0007 / 试用 TRL-2026-004213',
  `customer_id`          VARCHAR(24)  NOT NULL,
  `type`                 VARCHAR(16)  NOT NULL DEFAULT 'formal' COMMENT 'formal / trial',
  `product`              VARCHAR(32)  NOT NULL DEFAULT 'infinisynapse',
  `edition`              VARCHAR(32)  NOT NULL DEFAULT 'enterprise',
  `status`               VARCHAR(16)  NOT NULL DEFAULT 'pending'
                         COMMENT '由日期派生并缓存：pending / active / expired；void 为人工作废',
  `start_at`             DATETIME(3)  NOT NULL,
  `end_at`               DATETIME(3)           DEFAULT NULL COMMENT 'NULL = 永久授权',
  `warn_days`            INT          NOT NULL DEFAULT 15 COMMENT '到期前多少天开始弹窗预警',

  -- 限额：NULL 一律表示不限制
  `max_users`            INT                   DEFAULT NULL,
  `max_concurrent_tasks` INT                   DEFAULT NULL,
  `token_quota`          BIGINT                DEFAULT NULL,
  `token_quota_period`   VARCHAR(16)           DEFAULT NULL COMMENT 'total / monthly',
  `task_quota`           BIGINT                DEFAULT NULL,
  `task_quota_period`    VARCHAR(16)           DEFAULT NULL,
  `over_limit_ratio`     DECIMAL(4,2) NOT NULL DEFAULT 1.10,
  `features_json`        JSON                  DEFAULT NULL COMMENT 'NULL = 全功能',

  `bind_mode`            VARCHAR(16)  NOT NULL DEFAULT 'tofu' COMMENT 'tofu / none',
  `max_instances`        INT          NOT NULL DEFAULT 1 COMMENT '仅试用模式可实际执行',
  `telemetry_enabled`    TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'formal 恒为 0，trial 恒为 1',

  `renewed_at`           DATETIME(3)           DEFAULT NULL COMMENT '最近一次续期时间',
  `renew_count`          INT          NOT NULL DEFAULT 0,
  `renewed_from_id`      VARCHAR(24)           DEFAULT NULL COMMENT '仅换合同主体/产品线时使用',
  `converted_from_id`    VARCHAR(24)           DEFAULT NULL COMMENT '由哪份试用转正而来',
  `contract_no`          VARCHAR(64)           DEFAULT NULL,
  `remark`               TEXT                  DEFAULT NULL,
  `created_by`           VARCHAR(24)           DEFAULT NULL COMMENT '试用自动签发时为 NULL',
  `created_at`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`_id`),
  UNIQUE KEY `uk_license_no` (`license_no`),
  KEY `idx_license_customer` (`customer_id`),
  KEY `idx_license_type_status_end` (`type`, `status`, `end_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='授权';

-- 业务编号序列：避免并发签发时编号冲突
CREATE TABLE IF NOT EXISTS `lc_sequence` (
  `name`       VARCHAR(32) NOT NULL COMMENT '如 LIC-2026 / TRL-2026',
  `next_value` BIGINT      NOT NULL DEFAULT 1,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='编号序列';

-- ---------------------------------------------------------------------------
-- 签名密钥与凭证
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `lc_signing_key` (
  `_id`                VARCHAR(24)     NOT NULL,
  `kid`                VARCHAR(32)     NOT NULL,
  `algorithm`          VARCHAR(16)     NOT NULL DEFAULT 'EdDSA',
  `public_key`         TEXT            NOT NULL COMMENT 'SPKI PEM',
  `private_key_cipher` VARBINARY(1024) NOT NULL COMMENT 'AES-256-GCM(PKCS8 PEM)',
  `status`             VARCHAR(16)     NOT NULL DEFAULT 'active' COMMENT 'active/retiring/retired',
  `client_since`       VARCHAR(32)              DEFAULT NULL
                       COMMENT '从哪个客户端版本起内置了该公钥；离线客户端无法接收新公钥，签发时据此告警',
  `remark`             VARCHAR(255)             DEFAULT NULL,
  `activated_at`       DATETIME(3)     NOT NULL,
  `retired_at`         DATETIME(3)              DEFAULT NULL,
  `created_at`         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`_id`),
  UNIQUE KEY `uk_signing_kid` (`kid`),
  KEY `idx_signing_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='签名密钥';

CREATE TABLE IF NOT EXISTS `lc_credential` (
  `_id`              VARCHAR(24) NOT NULL,
  `jti`              VARCHAR(40) NOT NULL,
  `license_id`       VARCHAR(24) NOT NULL,
  `instance_id`      VARCHAR(24)          DEFAULT NULL COMMENT '正式凭证签发时尚无实例，为 NULL',
  `kid`              VARCHAR(32) NOT NULL,
  `cred_type`        VARCHAR(16) NOT NULL COMMENT 'formal / trial',
  `issue_reason`     VARCHAR(16) NOT NULL DEFAULT 'issue'
                     COMMENT 'issue / renew / reissue / convert / trial_register / trial_extend',
  `issued_at`        DATETIME(3) NOT NULL,
  `valid_from`       DATETIME(3) NOT NULL,
  `valid_until`      DATETIME(3)          DEFAULT NULL,
  `payload_json`     JSON        NOT NULL,
  `jws`              LONGTEXT    NOT NULL COMMENT '完整凭证，支持后台重新下载',
  `checksum`         VARCHAR(32) NOT NULL COMMENT 'JWS 的 SHA-256 前 16 位，供人工核对',
  `download_count`   INT         NOT NULL DEFAULT 0,
  `last_download_at` DATETIME(3)          DEFAULT NULL,
  `superseded_by`    VARCHAR(24)          DEFAULT NULL COMMENT '被哪份新凭证取代',
  `created_by`       VARCHAR(24)          DEFAULT NULL,
  PRIMARY KEY (`_id`),
  UNIQUE KEY `uk_credential_jti` (`jti`),
  KEY `idx_credential_license` (`license_id`, `issued_at`),
  KEY `idx_credential_instance` (`instance_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='已签发凭证';

-- ---------------------------------------------------------------------------
-- 试用实例（正式客户零上报，不会产生记录）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `lc_instance` (
  `_id`               VARCHAR(24)     NOT NULL,
  `license_id`        VARCHAR(24)     NOT NULL,
  `customer_id`       VARCHAR(24)     NOT NULL,
  `fingerprint`       CHAR(64)        NOT NULL,
  `install_id`        CHAR(36)        NOT NULL,
  `host_signal_hash`  CHAR(64)                 DEFAULT NULL COMMENT '用于识别疑似重装',
  `db_signal`         CHAR(64)                 DEFAULT NULL,
  `secret_hash`       CHAR(64)        NOT NULL COMMENT 'SHA-256(instanceSecret)',
  `secret_cipher`     VARBINARY(512)  NOT NULL,
  `status`            VARCHAR(16)     NOT NULL DEFAULT 'active' COMMENT 'active/converted/expired',
  `trial_started_at`  DATETIME(3)     NOT NULL COMMENT '首次注册时间，重复注册不重置',
  `suspected_reset`   TINYINT(1)      NOT NULL DEFAULT 0,
  `reuse_count`       INT             NOT NULL DEFAULT 0,
  `drift_count`       INT             NOT NULL DEFAULT 0,
  `product_version`   VARCHAR(32)              DEFAULT NULL,
  `host_name`         VARCHAR(128)             DEFAULT NULL,
  `os_info`           VARCHAR(64)              DEFAULT NULL,
  `cpu_cores`         INT                      DEFAULT NULL,
  `deploy_kind`       VARCHAR(32)              DEFAULT NULL COMMENT 'docker/k8s/bare',
  `last_ip`           VARCHAR(64)              DEFAULT NULL,
  `last_heartbeat_at` DATETIME(3)              DEFAULT NULL,
  `last_usage_at`     DATETIME(3)              DEFAULT NULL,
  `created_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`_id`),
  UNIQUE KEY `uk_instance_fingerprint` (`fingerprint`),
  KEY `idx_instance_license` (`license_id`),
  KEY `idx_instance_install` (`install_id`),
  KEY `idx_instance_hostsignal` (`host_signal_hash`),
  KEY `idx_instance_heartbeat` (`last_heartbeat_at`),
  KEY `idx_instance_suspect` (`suspected_reset`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='试用实例';

-- ---------------------------------------------------------------------------
-- 心跳与用量（仅试用客户）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `lc_heartbeat` (
  `_id`              VARCHAR(24) NOT NULL,
  `instance_id`      VARCHAR(24) NOT NULL,
  `license_id`       VARCHAR(24) NOT NULL,
  `received_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `client_time`      DATETIME(3)          DEFAULT NULL,
  `clock_skew_sec`   INT                  DEFAULT NULL,
  `product_version`  VARCHAR(32)          DEFAULT NULL,
  `local_state`      VARCHAR(24)          DEFAULT NULL,
  `local_user_count` INT                  DEFAULT NULL,
  `local_counters`   JSON                 DEFAULT NULL,
  `ip`               VARCHAR(64)          DEFAULT NULL,
  PRIMARY KEY (`_id`),
  KEY `idx_hb_instance_time` (`instance_id`, `received_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='心跳日志，保留 90 天';

CREATE TABLE IF NOT EXISTS `lc_usage_batch` (
  `_id`               VARCHAR(24) NOT NULL,
  `batch_id`          CHAR(36)    NOT NULL,
  `instance_id`       VARCHAR(24) NOT NULL,
  `license_id`        VARCHAR(24) NOT NULL,
  `source`            VARCHAR(16) NOT NULL COMMENT 'app / proxy',
  `window_start`      DATETIME(3) NOT NULL,
  `window_end`        DATETIME(3) NOT NULL,
  `task_count`        INT         NOT NULL DEFAULT 0,
  `input_tokens`      BIGINT      NOT NULL DEFAULT 0,
  `output_tokens`     BIGINT      NOT NULL DEFAULT 0,
  `cache_read_tokens` BIGINT      NOT NULL DEFAULT 0,
  `client_sent_at`    DATETIME(3)          DEFAULT NULL,
  `received_at`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `anomaly`           VARCHAR(64)          DEFAULT NULL COMMENT '单调性等异常标记',
  PRIMARY KEY (`_id`),
  UNIQUE KEY `uk_batch` (`instance_id`, `batch_id`),
  KEY `idx_batch_license_time` (`license_id`, `window_end`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用量上报批次';

CREATE TABLE IF NOT EXISTS `lc_usage_task` (
  `_id`                VARCHAR(24)  NOT NULL,
  `license_id`         VARCHAR(24)  NOT NULL,
  `instance_id`        VARCHAR(24)  NOT NULL,
  `task_id`            VARCHAR(255) NOT NULL,
  `parent_task_id`     VARCHAR(255)          DEFAULT NULL,
  `user_ref`           CHAR(64)     NOT NULL COMMENT '假名用户标识',
  `source`             VARCHAR(16)  NOT NULL DEFAULT 'app',
  `status`             VARCHAR(24)           DEFAULT NULL,
  `started_at`         DATETIME(3)           DEFAULT NULL,
  `finished_at`        DATETIME(3)           DEFAULT NULL,
  `duration_ms`        INT                   DEFAULT NULL,
  `input_tokens`       BIGINT       NOT NULL DEFAULT 0,
  `output_tokens`      BIGINT       NOT NULL DEFAULT 0,
  `cache_read_tokens`  BIGINT       NOT NULL DEFAULT 0,
  `cache_write_tokens` BIGINT       NOT NULL DEFAULT 0,
  `llm_call_count`     INT          NOT NULL DEFAULT 0,
  `stat_date`          DATE         NOT NULL,
  `first_seen_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `last_seen_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`_id`),
  UNIQUE KEY `uk_usage_task` (`instance_id`, `task_id`),
  KEY `idx_usage_task_license_date` (`license_id`, `stat_date`),
  KEY `idx_usage_task_user` (`instance_id`, `user_ref`, `stat_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务级用量明细';

CREATE TABLE IF NOT EXISTS `lc_usage_daily` (
  `_id`                 VARCHAR(24) NOT NULL,
  `license_id`          VARCHAR(24) NOT NULL,
  `instance_id`         VARCHAR(24) NOT NULL,
  `stat_date`           DATE        NOT NULL,
  `task_count`          INT         NOT NULL DEFAULT 0,
  `task_success_count`  INT         NOT NULL DEFAULT 0,
  `task_failed_count`   INT         NOT NULL DEFAULT 0,
  `active_user_count`   INT         NOT NULL DEFAULT 0,
  `new_user_count`      INT         NOT NULL DEFAULT 0,
  `input_tokens`        BIGINT      NOT NULL DEFAULT 0,
  `output_tokens`       BIGINT      NOT NULL DEFAULT 0,
  `cache_read_tokens`   BIGINT      NOT NULL DEFAULT 0,
  `total_tokens`        BIGINT      NOT NULL DEFAULT 0,
  `llm_call_count`      BIGINT      NOT NULL DEFAULT 0,
  `proxy_input_tokens`  BIGINT      NOT NULL DEFAULT 0 COMMENT 'proxy 代理层口径，交叉核对',
  `proxy_output_tokens` BIGINT      NOT NULL DEFAULT 0,
  `updated_at`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`_id`),
  UNIQUE KEY `uk_usage_daily` (`instance_id`, `stat_date`),
  KEY `idx_usage_daily_license_date` (`license_id`, `stat_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用量日聚合';

CREATE TABLE IF NOT EXISTS `lc_user_ref` (
  `_id`           VARCHAR(24) NOT NULL,
  `license_id`    VARCHAR(24) NOT NULL,
  `instance_id`   VARCHAR(24) NOT NULL,
  `user_ref`      CHAR(64)    NOT NULL,
  `first_seen_at` DATETIME(3) NOT NULL,
  `last_seen_at`  DATETIME(3) NOT NULL,
  `task_count`    BIGINT      NOT NULL DEFAULT 0,
  `total_tokens`  BIGINT      NOT NULL DEFAULT 0,
  PRIMARY KEY (`_id`),
  UNIQUE KEY `uk_user_ref` (`instance_id`, `user_ref`),
  KEY `idx_user_ref_license` (`license_id`, `last_seen_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='假名用户';

-- ---------------------------------------------------------------------------
-- 客户端协议的防护存储
--
-- 这两张表原本设计用 Redis。改用 MySQL 是因为：本服务是内部运营系统，试用
-- 心跳每小时一次、用量每 15 分钟一次，千级实例也只有每小时千级请求，MySQL
-- 毫无压力；为此多引一个 Redis 运维依赖不划算。两者都封在 service 后面，
-- 将来量级真上来了换 Redis 只需改一个类。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `lc_replay_nonce` (
  `instance_id` VARCHAR(24) NOT NULL,
  `nonce`       CHAR(36)    NOT NULL,
  `expires_at`  DATETIME(3) NOT NULL,
  -- 主键即防重放判据：插入冲突就是重放，不需要先查再插
  PRIMARY KEY (`instance_id`, `nonce`),
  KEY `idx_nonce_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='HMAC 防重放 nonce，过期由定时任务清理';

CREATE TABLE IF NOT EXISTS `lc_rate_limit` (
  -- bucket 里已经带了时间窗口，例如 ip:1.2.3.4:h2026090914
  `bucket`     VARCHAR(160) NOT NULL,
  `hits`       INT          NOT NULL DEFAULT 0,
  `expires_at` DATETIME(3)  NOT NULL,
  PRIMARY KEY (`bucket`),
  KEY `idx_rate_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='固定窗口限流计数';

-- ---------------------------------------------------------------------------
-- 管理员与审计
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `lc_admin_user` (
  `_id`             VARCHAR(24)  NOT NULL,
  `username`        VARCHAR(64)  NOT NULL,
  `password_hash`   VARCHAR(255) NOT NULL COMMENT 'scrypt$N$r$p$salt$hash',
  `real_name`       VARCHAR(64)           DEFAULT NULL,
  `role`            VARCHAR(16)  NOT NULL DEFAULT 'viewer' COMMENT 'owner/ops/sales/viewer',
  `status`          TINYINT      NOT NULL DEFAULT 1,
  `failed_attempts` INT          NOT NULL DEFAULT 0,
  `locked_until`    DATETIME(3)           DEFAULT NULL,
  `last_login_at`   DATETIME(3)           DEFAULT NULL,
  `last_login_ip`   VARCHAR(64)           DEFAULT NULL,
  `created_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`_id`),
  UNIQUE KEY `uk_admin_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='后台管理员';

CREATE TABLE IF NOT EXISTS `lc_audit_log` (
  `_id`         VARCHAR(24)  NOT NULL,
  `actor_id`    VARCHAR(24)           DEFAULT NULL,
  `actor_name`  VARCHAR(64)           DEFAULT NULL,
  `action`      VARCHAR(64)  NOT NULL COMMENT 'license.issue / credential.download ...',
  `target_type` VARCHAR(32)           DEFAULT NULL,
  `target_id`   VARCHAR(64)           DEFAULT NULL,
  `summary`     VARCHAR(255)          DEFAULT NULL,
  `detail_json` JSON                  DEFAULT NULL,
  `ip`          VARCHAR(64)           DEFAULT NULL,
  `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`_id`),
  KEY `idx_audit_created` (`created_at`),
  KEY `idx_audit_target` (`target_type`, `target_id`),
  KEY `idx_audit_actor` (`actor_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='操作审计';

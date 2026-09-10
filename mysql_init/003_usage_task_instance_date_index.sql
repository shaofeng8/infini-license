-- ---------------------------------------------------------------------------
-- lc_usage_task 补一个 (instance_id, stat_date) 索引
--
-- P8 压测发现的。`usage.service.ts` 的 recomputeDaily 是**每批上报都跑一次**
-- 的，它的取数条件是 `WHERE instance_id = ? AND stat_date = ?`，而 001 建的三个
-- 索引没有一个能同时用上这两列：
--
--   uk_usage_task              (instance_id, task_id)            → 只能用 instance_id 前缀
--   idx_usage_task_license_date(license_id, stat_date)           → 不以 instance_id 开头
--   idx_usage_task_user        (instance_id, user_ref, stat_date) → 跳不过中间的 user_ref
--
-- 于是优化器只能拿 instance_id 前缀走 uk_usage_task，扫完这个实例的**全部**
-- 行再用 where 过滤出当天那点数据。代价随单个实例的累积行数线性增长，而它是
-- 只增不减的 —— 也就是说这条语句会越跑越慢，且慢在客户上报的路径上。
--
-- 实测（100 万行，其中一个重度实例占 60 万行、单日 3,334 行）：
--
--   补索引前  扫 490,049 行  4856 ms   使用 uk_usage_task
--   补索引后  扫   3,334 行    19.8 ms 使用 idx_usage_task_instance_date
--
-- 245 倍。建索引本身在这个规模上耗时 3.5 秒。
--
-- 代价是明细表多一个索引、写入多一份维护开销。值得：读侧是每批上报一次的
-- 必经路径，写侧本来就是批量 upsert，多一个二级索引的边际成本远小于一次
-- 全实例扫描。
--
-- 顺带记一下压测里另外两个结论，避免以后重复排查：
--
-- 1. 管理端「按授权拉一段时间的明细」在重度授权上没用 idx_usage_task_license_date
--    而选了全表扫。这是优化器的正确判断，不是缺陷 —— 那个授权占了全表 60%，
--    走索引再回表比顺序扫更贵。对照验证：换一个占全表 2% 的授权，同样的语句
--    立刻用上该索引（6,558 行 / 76 ms）。P6 用量分析页真正落地时，若要支持
--    「单一大客户跨月汇总」，届时该考虑的是覆盖索引或预聚合表（lc_usage_daily
--    已经在那儿了），不是现在加索引。
-- 2. 聚合语句里的 new_user_count 子查询用了 DATE(r.first_seen_at) = ?，函数包住
--    了列，索引用不上。目前不痛（lc_user_ref 是按实例收敛的小表，实测 3.5 ms），
--    但它是个已知的非 sargable 写法，用户量大的实例上会先在这里出问题。
-- ---------------------------------------------------------------------------

-- MySQL 没有 CREATE INDEX IF NOT EXISTS，靠 information_schema 判一下，
-- 否则重复执行会报 1061。
SET @exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'lc_usage_task'
     AND INDEX_NAME = 'idx_usage_task_instance_date'
);

SET @ddl = IF(
  @exists = 0,
  'CREATE INDEX `idx_usage_task_instance_date` ON `lc_usage_task` (`instance_id`, `stat_date`)',
  'DO 0'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

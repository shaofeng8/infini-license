/**
 * 业务错误码
 *
 * 格式 `code:message`，由 BusinessException 拆分。HTTP 状态恒为 200，
 * 业务码放在响应体的 code 字段里 —— 与 infini-proxy 保持一致的约定。
 *
 * 号段划分：
 *   1000-1099 通用
 *   1100-1199 管理员认证
 *   1200-1299 客户与授权
 *   1300-1399 凭证与密钥
 *   1400-1499 试用客户端协议
 */
export enum ErrorEnum {
  // 通用 -------------------------------------------------------------------
  DEFAULT = '0:未知错误',
  SERVER_ERROR = '500:服务器繁忙，请稍后再试',
  PARAM_INVALID = '1000:参数校验失败',
  RESOURCE_NOT_FOUND = '1001:资源不存在',
  OPERATION_NOT_ALLOWED = '1002:当前状态不允许该操作',
  TOO_MANY_REQUESTS = '1003:请求过于频繁，请稍后再试',

  // 管理员认证 -------------------------------------------------------------
  INVALID_CREDENTIALS = '1100:用户名或密码错误',
  ACCOUNT_DISABLED = '1101:账号已停用',
  ACCOUNT_LOCKED = '1102:登录失败次数过多，账号已临时锁定',
  TOKEN_INVALID = '1103:登录状态已失效，请重新登录',
  PERMISSION_DENIED = '1104:没有该操作的权限',
  OLD_PASSWORD_WRONG = '1105:原密码不正确',
  WEAK_PASSWORD = '1106:密码强度不足，需 12 位以上且包含大小写字母与数字',

  // 客户与授权 -------------------------------------------------------------
  CUSTOMER_NOT_FOUND = '1200:客户不存在',
  CUSTOMER_DISABLED = '1201:客户已停用',
  LICENSE_NOT_FOUND = '1202:授权不存在',
  LICENSE_VOIDED = '1203:授权已作废',
  LICENSE_TERM_INVALID = '1204:有效期区间不合法',
  LICENSE_TERM_TOO_LONG = '1205:单次签发有效期超过上限',
  LICENSE_TYPE_MISMATCH = '1206:该操作不适用于此授权类型',
  TRIAL_ALREADY_CONVERTED = '1207:该试用授权已转正',

  // 凭证与密钥 -------------------------------------------------------------
  SIGNING_KEY_NOT_FOUND = '1300:签名密钥不存在',
  NO_ACTIVE_SIGNING_KEY = '1301:没有可用的签名密钥，请先生成',
  SIGNING_KEY_RETIRED = '1302:签名密钥已停用，无法用于签发',
  LAST_ACTIVE_KEY = '1303:这是最后一把可用密钥，停用后将无法签发',
  CREDENTIAL_NOT_FOUND = '1304:凭证不存在',
  MASTER_KEY_MISSING = '1305:未配置 LICENSE_MASTER_KEY，无法进行密钥操作',
  MASTER_KEY_MISMATCH = '1306:主密钥无法解密该私钥，请检查 LICENSE_MASTER_KEY 是否被更换',
  KEY_BUNDLE_INVALID = '1307:密钥导出包无法解析，请确认文件完整且口令正确',
  KEY_BUNDLE_MISMATCH = '1308:导出包里的公私钥不配对，拒绝导入',
  SIGNING_KEY_EXISTS = '1309:该 kid 已存在，导入前请先确认是否重复',

  // 试用客户端协议 ---------------------------------------------------------
  INSTANCE_NOT_FOUND = '1400:实例未注册',
  SIGNATURE_INVALID = '1401:请求签名校验失败',
  TIMESTAMP_SKEW = '1402:请求时间戳偏差过大',
  NONCE_REPLAY = '1403:请求重放',
  TRIAL_DISABLED = '1404:试用注册已关闭',
  FINGERPRINT_MISMATCH = '1405:机器指纹与注册时不一致',
  BATCH_DUPLICATED = '1406:该批次已上报',
}

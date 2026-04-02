package model

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/bytedance/gopkg/util/gopool"
	"gorm.io/gorm"
)

type Token struct {
	Id                 int            `json:"id"`
	UserId             int            `json:"user_id" gorm:"index"`
	Key                string         `json:"key" gorm:"type:char(48);uniqueIndex"`
	Status             int            `json:"status" gorm:"default:1"`
	Name               string         `json:"name" gorm:"index" `
	CreatedTime        int64          `json:"created_time" gorm:"bigint"`
	AccessedTime       int64          `json:"accessed_time" gorm:"bigint"`
	ExpiredTime        int64          `json:"expired_time" gorm:"bigint;default:-1"` // -1 means never expired
	RemainQuota        int            `json:"remain_quota" gorm:"default:0"`
	UnlimitedQuota     bool           `json:"unlimited_quota"`
	ModelLimitsEnabled bool           `json:"model_limits_enabled"`
	ModelLimits        string         `json:"model_limits" gorm:"type:text"`
	AllowIps           *string        `json:"allow_ips" gorm:"default:''"`
	UsedQuota          int            `json:"used_quota" gorm:"default:0"` // used quota
	Group              string         `json:"group" gorm:"default:''"`
	CrossGroupRetry         bool           `json:"cross_group_retry"`                                         // 跨分组重试，仅auto分组有效
	QuotaLimitPeriod        string         `json:"quota_limit_period" gorm:"type:varchar(16);default:'never'"` // never/daily/weekly/monthly/custom
	QuotaLimitCustomSeconds int64          `json:"quota_limit_custom_seconds" gorm:"type:bigint;default:0"`
	QuotaLimit              int            `json:"quota_limit" gorm:"default:0"`
	QuotaLimitUsed          int            `json:"quota_limit_used" gorm:"default:0"`
	QuotaLimitResetTime     int64          `json:"quota_limit_reset_time" gorm:"type:bigint;default:0"`
	DeletedAt               gorm.DeletedAt `gorm:"index"`
}

func (token *Token) Clean() {
	token.Key = ""
}

func MaskTokenKey(key string) string {
	if key == "" {
		return ""
	}
	if len(key) <= 4 {
		return strings.Repeat("*", len(key))
	}
	if len(key) <= 8 {
		return key[:2] + "****" + key[len(key)-2:]
	}
	return key[:4] + "**********" + key[len(key)-4:]
}

func (token *Token) GetFullKey() string {
	return token.Key
}

func (token *Token) GetMaskedKey() string {
	return MaskTokenKey(token.Key)
}

func (token *Token) GetIpLimits() []string {
	// delete empty spaces
	//split with \n
	ipLimits := make([]string, 0)
	if token.AllowIps == nil {
		return ipLimits
	}
	cleanIps := strings.ReplaceAll(*token.AllowIps, " ", "")
	if cleanIps == "" {
		return ipLimits
	}
	ips := strings.Split(cleanIps, "\n")
	for _, ip := range ips {
		ip = strings.TrimSpace(ip)
		ip = strings.ReplaceAll(ip, ",", "")
		if ip != "" {
			ipLimits = append(ipLimits, ip)
		}
	}
	return ipLimits
}

// buildUserTokenQuery builds the base query with filters for user token listing
func buildUserTokenQuery(userId int, tokenName string, tokenKey string, status int, group string) *gorm.DB {
	query := DB.Model(&Token{}).Where("user_id = ?", userId)
	if tokenName != "" {
		query = query.Where("name LIKE ? ESCAPE '!'", "%"+escapeLikeInput(tokenName)+"%")
	}
	if tokenKey != "" {
		query = query.Where(commonKeyCol+" LIKE ? ESCAPE '!'", "%"+escapeLikeInput(tokenKey)+"%")
	}
	if status != 0 {
		query = query.Where("status = ?", status)
	}
	if group != "" {
		query = query.Where(commonGroupCol+" = ?", group)
	}
	return query
}

func GetAllUserTokens(userId int, startIdx int, num int, tokenName string, tokenKey string, status int, group string) ([]*Token, error) {
	var tokens []*Token
	query := buildUserTokenQuery(userId, tokenName, tokenKey, status, group)
	err := query.Order("id desc").Limit(num).Offset(startIdx).Find(&tokens).Error
	return tokens, err
}

// sanitizeLikePattern 校验并清洗用户输入的 LIKE 搜索模式。
// 规则：
//  1. 转义 ! 和 _（使用 ! 作为 ESCAPE 字符，兼容 MySQL/PostgreSQL/SQLite）
//  2. 连续的 % 合并为单个 %
//  3. 最多允许 2 个 %
//  4. 含 % 时（模糊搜索），去掉 % 后关键词长度必须 >= 2
//  5. 不含 % 时按精确匹配
func sanitizeLikePattern(input string) (string, error) {
	// 1. 先转义 ESCAPE 字符 ! 自身，再转义 _
	//    使用 ! 而非 \ 作为 ESCAPE 字符，避免 MySQL 中反斜杠的字符串转义问题
	input = strings.ReplaceAll(input, "!", "!!")
	input = strings.ReplaceAll(input, `_`, `!_`)

	// 2. 连续的 % 直接拒绝
	if strings.Contains(input, "%%") {
		return "", errors.New("搜索模式中不允许包含连续的 % 通配符")
	}

	// 3. 统计 % 数量，不得超过 2
	count := strings.Count(input, "%")
	if count > 2 {
		return "", errors.New("搜索模式中最多允许包含 2 个 % 通配符")
	}

	// 4. 含 % 时，去掉 % 后关键词长度必须 >= 2
	if count > 0 {
		stripped := strings.ReplaceAll(input, "%", "")
		if len(stripped) < 2 {
			return "", errors.New("使用模糊搜索时，关键词长度至少为 2 个字符")
		}
		return input, nil
	}

	// 5. 无 % 时，精确全匹配
	return input, nil
}

const searchHardLimit = 100

func SearchUserTokens(userId int, keyword string, token string, offset int, limit int) (tokens []*Token, total int64, err error) {
	// model 层强制截断
	if limit <= 0 || limit > searchHardLimit {
		limit = searchHardLimit
	}
	if offset < 0 {
		offset = 0
	}

	if token != "" {
		token = strings.TrimPrefix(token, "sk-")
	}

	// 超量用户（令牌数超过上限）只允许精确搜索，禁止模糊搜索
	maxTokens := operation_setting.GetMaxUserTokens()
	hasFuzzy := strings.Contains(keyword, "%") || strings.Contains(token, "%")
	if hasFuzzy {
		count, err := CountUserTokens(userId, "", "", 0)
		if err != nil {
			common.SysLog("failed to count user tokens: " + err.Error())
			return nil, 0, errors.New("获取令牌数量失败")
		}
		if int(count) > maxTokens {
			return nil, 0, errors.New("令牌数量超过上限，仅允许精确搜索，请勿使用 % 通配符")
		}
	}

	baseQuery := DB.Model(&Token{}).Where("user_id = ?", userId)

	// 非空才加 LIKE 条件，空则跳过（不过滤该字段）
	if keyword != "" {
		keywordPattern, err := sanitizeLikePattern(keyword)
		if err != nil {
			return nil, 0, err
		}
		baseQuery = baseQuery.Where("name LIKE ? ESCAPE '!'", keywordPattern)
	}
	if token != "" {
		tokenPattern, err := sanitizeLikePattern(token)
		if err != nil {
			return nil, 0, err
		}
		baseQuery = baseQuery.Where(commonKeyCol+" LIKE ? ESCAPE '!'", tokenPattern)
	}

	// 先查匹配总数（用于分页，受 maxTokens 上限保护，避免全表 COUNT）
	err = baseQuery.Limit(maxTokens).Count(&total).Error
	if err != nil {
		common.SysError("failed to count search tokens: " + err.Error())
		return nil, 0, errors.New("搜索令牌失败")
	}

	// 再分页查数据
	err = baseQuery.Order("id desc").Offset(offset).Limit(limit).Find(&tokens).Error
	if err != nil {
		common.SysError("failed to search tokens: " + err.Error())
		return nil, 0, errors.New("搜索令牌失败")
	}
	return tokens, total, nil
}

func ValidateUserToken(key string) (token *Token, err error) {
	if key == "" {
		return nil, errors.New("未提供令牌")
	}
	token, err = GetTokenByKey(key, false)
	if err == nil {
		if token.Status == common.TokenStatusExhausted {
			keyPrefix := key[:3]
			keySuffix := key[len(key)-3:]
			return token, errors.New("该令牌额度已用尽 TokenStatusExhausted[sk-" + keyPrefix + "***" + keySuffix + "]")
		} else if token.Status == common.TokenStatusExpired {
			return token, errors.New("该令牌已过期")
		}
		if token.Status != common.TokenStatusEnabled {
			return token, errors.New("该令牌状态不可用")
		}
		if token.ExpiredTime != -1 && token.ExpiredTime < common.GetTimestamp() {
			if !common.RedisEnabled {
				token.Status = common.TokenStatusExpired
				err := token.SelectUpdate()
				if err != nil {
					common.SysLog("failed to update token status" + err.Error())
				}
			}
			return token, errors.New("该令牌已过期")
		}
		if !token.UnlimitedQuota && token.RemainQuota <= 0 {
			if !common.RedisEnabled {
				// in this case, we can make sure the token is exhausted
				token.Status = common.TokenStatusExhausted
				err := token.SelectUpdate()
				if err != nil {
					common.SysLog("failed to update token status" + err.Error())
				}
			}
			keyPrefix := key[:3]
			keySuffix := key[len(key)-3:]
			return token, fmt.Errorf("[sk-%s***%s] 该令牌额度已用尽 !token.UnlimitedQuota && token.RemainQuota = %d", keyPrefix, keySuffix, token.RemainQuota)
		}
		return token, nil
	}
	common.SysLog("ValidateUserToken: failed to get token: " + err.Error())
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errors.New("无效的令牌")
	} else {
		return nil, errors.New("无效的令牌，数据库查询出错，请联系管理员")
	}
}

func GetTokenByIds(id int, userId int) (*Token, error) {
	if id == 0 || userId == 0 {
		return nil, errors.New("id 或 userId 为空！")
	}
	token := Token{Id: id, UserId: userId}
	var err error = nil
	err = DB.First(&token, "id = ? and user_id = ?", id, userId).Error
	return &token, err
}

func GetTokenById(id int) (*Token, error) {
	if id == 0 {
		return nil, errors.New("id 为空！")
	}
	token := Token{Id: id}
	var err error = nil
	err = DB.First(&token, "id = ?", id).Error
	if shouldUpdateRedis(true, err) {
		gopool.Go(func() {
			if err := cacheSetToken(token); err != nil {
				common.SysLog("failed to update user status cache: " + err.Error())
			}
		})
	}
	return &token, err
}

func GetTokenByKey(key string, fromDB bool) (token *Token, err error) {
	defer func() {
		// Update Redis cache asynchronously on successful DB read
		if shouldUpdateRedis(fromDB, err) && token != nil {
			gopool.Go(func() {
				if err := cacheSetToken(*token); err != nil {
					common.SysLog("failed to update user status cache: " + err.Error())
				}
			})
		}
	}()
	if !fromDB && common.RedisEnabled {
		// Try Redis first
		token, err := cacheGetTokenByKey(key)
		if err == nil {
			return token, nil
		}
		// Don't return error - fall through to DB
	}
	fromDB = true
	err = DB.Where(commonKeyCol+" = ?", key).First(&token).Error
	return token, err
}

func (token *Token) Insert() error {
	var err error
	err = DB.Create(token).Error
	return err
}

// Update Make sure your token's fields is completed, because this will update non-zero values
func (token *Token) Update() (err error) {
	defer func() {
		if shouldUpdateRedis(true, err) {
			gopool.Go(func() {
				err := cacheSetToken(*token)
				if err != nil {
					common.SysLog("failed to update token cache: " + err.Error())
				}
			})
		}
	}()
	err = DB.Model(token).Select("name", "status", "expired_time", "remain_quota", "unlimited_quota",
		"model_limits_enabled", "model_limits", "allow_ips", "group", "cross_group_retry",
		"quota_limit_period", "quota_limit_custom_seconds", "quota_limit", "quota_limit_used", "quota_limit_reset_time").Updates(token).Error
	return err
}

func (token *Token) SelectUpdate() (err error) {
	defer func() {
		if shouldUpdateRedis(true, err) {
			gopool.Go(func() {
				err := cacheSetToken(*token)
				if err != nil {
					common.SysLog("failed to update token cache: " + err.Error())
				}
			})
		}
	}()
	// This can update zero values
	return DB.Model(token).Select("accessed_time", "status").Updates(token).Error
}

func (token *Token) Delete() (err error) {
	defer func() {
		if shouldUpdateRedis(true, err) {
			gopool.Go(func() {
				err := cacheDeleteToken(token.Key)
				if err != nil {
					common.SysLog("failed to delete token cache: " + err.Error())
				}
			})
		}
	}()
	err = DB.Delete(token).Error
	return err
}

func (token *Token) IsModelLimitsEnabled() bool {
	return token.ModelLimitsEnabled
}

func (token *Token) GetModelLimits() []string {
	if token.ModelLimits == "" {
		return []string{}
	}
	return strings.Split(token.ModelLimits, ",")
}

func (token *Token) GetModelLimitsMap() map[string]bool {
	limits := token.GetModelLimits()
	limitsMap := make(map[string]bool)
	for _, limit := range limits {
		limitsMap[limit] = true
	}
	return limitsMap
}

func DisableModelLimits(tokenId int) error {
	token, err := GetTokenById(tokenId)
	if err != nil {
		return err
	}
	token.ModelLimitsEnabled = false
	token.ModelLimits = ""
	return token.Update()
}

func DeleteTokenById(id int, userId int) (err error) {
	// Why we need userId here? In case user want to delete other's token.
	if id == 0 || userId == 0 {
		return errors.New("id 或 userId 为空！")
	}
	token := Token{Id: id, UserId: userId}
	err = DB.Where(token).First(&token).Error
	if err != nil {
		return err
	}
	return token.Delete()
}

func IncreaseTokenQuota(tokenId int, key string, quota int) (err error) {
	if quota < 0 {
		return errors.New("quota 不能为负数！")
	}
	if common.RedisEnabled {
		gopool.Go(func() {
			err := cacheIncrTokenQuota(key, int64(quota))
			if err != nil {
				common.SysLog("failed to increase token quota: " + err.Error())
			}
			err = cacheDecrTokenQuotaLimitUsed(key, int64(quota))
			if err != nil {
				common.SysLog("failed to decrease token quota limit used: " + err.Error())
			}
		})
	}
	if common.BatchUpdateEnabled {
		addNewRecord(BatchUpdateTypeTokenQuota, tokenId, quota)
		addNewRecord(BatchUpdateTypeTokenQuotaLimitUsed, tokenId, -quota)
		return nil
	}
	return increaseTokenQuota(tokenId, quota)
}

func increaseTokenQuota(id int, quota int) (err error) {
	err = DB.Model(&Token{}).Where("id = ?", id).Updates(
		map[string]interface{}{
			"remain_quota":     gorm.Expr("remain_quota + ?", quota),
			"used_quota":       gorm.Expr("used_quota - ?", quota),
			"quota_limit_used": gorm.Expr("CASE WHEN quota_limit_used >= ? THEN quota_limit_used - ? ELSE 0 END", quota, quota),
			"accessed_time":    common.GetTimestamp(),
		},
	).Error
	return err
}

func DecreaseTokenQuota(id int, key string, quota int) (err error) {
	if quota < 0 {
		return errors.New("quota 不能为负数！")
	}
	if common.RedisEnabled {
		gopool.Go(func() {
			err := cacheDecrTokenQuota(key, int64(quota))
			if err != nil {
				common.SysLog("failed to decrease token quota: " + err.Error())
			}
			err = cacheIncrTokenQuotaLimitUsed(key, int64(quota))
			if err != nil {
				common.SysLog("failed to increase token quota limit used: " + err.Error())
			}
		})
	}
	if common.BatchUpdateEnabled {
		addNewRecord(BatchUpdateTypeTokenQuota, id, -quota)
		addNewRecord(BatchUpdateTypeTokenQuotaLimitUsed, id, quota)
		return nil
	}
	return decreaseTokenQuota(id, quota)
}

func decreaseTokenQuota(id int, quota int) (err error) {
	err = DB.Model(&Token{}).Where("id = ?", id).Updates(
		map[string]interface{}{
			"remain_quota":     gorm.Expr("remain_quota - ?", quota),
			"used_quota":       gorm.Expr("used_quota + ?", quota),
			"quota_limit_used": gorm.Expr("quota_limit_used + ?", quota),
			"accessed_time":    common.GetTimestamp(),
		},
	).Error
	return err
}

// CountUserTokens returns total number of tokens for the given user, used for pagination
func CountUserTokens(userId int, tokenName string, tokenKey string, status int, group ...string) (int64, error) {
	var total int64
	g := ""
	if len(group) > 0 {
		g = group[0]
	}
	query := buildUserTokenQuery(userId, tokenName, tokenKey, status, g)
	err := query.Count(&total).Error
	return total, err
}

// BatchUpdateTokenQuota updates remain_quota and unlimited_quota for a batch of tokens
func BatchUpdateTokenQuota(ids []int, userId int, remainQuota int, unlimitedQuota bool) (int, error) {
	if len(ids) == 0 {
		return 0, errors.New("ids 不能为空！")
	}

	tx := DB.Begin()

	var tokens []Token
	if err := tx.Where("user_id = ? AND id IN (?)", userId, ids).Find(&tokens).Error; err != nil {
		tx.Rollback()
		return 0, err
	}

	result := tx.Model(&Token{}).Where("user_id = ? AND id IN (?)", userId, ids).Updates(map[string]interface{}{
		"remain_quota":    remainQuota,
		"unlimited_quota": unlimitedQuota,
	})
	if result.Error != nil {
		tx.Rollback()
		return 0, result.Error
	}

	if err := tx.Commit().Error; err != nil {
		return 0, err
	}

	if common.RedisEnabled {
		gopool.Go(func() {
			for _, t := range tokens {
				_ = cacheDeleteToken(t.Key)
			}
		})
	}

	return int(result.RowsAffected), nil
}

// BatchUpdateTokenPeriodicQuota updates periodic quota fields for a batch of tokens
func BatchUpdateTokenPeriodicQuota(ids []int, userId int, period string, quotaLimit int, customSeconds int64) (int, error) {
	if len(ids) == 0 {
		return 0, errors.New("ids 不能为空！")
	}

	tx := DB.Begin()

	var tokens []Token
	if err := tx.Where("user_id = ? AND id IN (?)", userId, ids).Find(&tokens).Error; err != nil {
		tx.Rollback()
		return 0, err
	}

	updates := map[string]interface{}{}
	if period == TokenQuotaLimitNever {
		updates["quota_limit_period"] = TokenQuotaLimitNever
		updates["quota_limit"] = 0
		updates["quota_limit_custom_seconds"] = 0
		updates["quota_limit_used"] = 0
		updates["quota_limit_reset_time"] = 0
	} else {
		resetTime := CalcTokenQuotaLimitNextResetTime(time.Now(), period, customSeconds)
		updates["quota_limit_period"] = period
		updates["quota_limit"] = quotaLimit
		updates["quota_limit_custom_seconds"] = customSeconds
		updates["quota_limit_used"] = 0
		updates["quota_limit_reset_time"] = resetTime
	}

	result := tx.Model(&Token{}).Where("user_id = ? AND id IN (?)", userId, ids).Updates(updates)
	if result.Error != nil {
		tx.Rollback()
		return 0, result.Error
	}

	if err := tx.Commit().Error; err != nil {
		return 0, err
	}

	if common.RedisEnabled {
		gopool.Go(func() {
			for _, t := range tokens {
				_ = cacheDeleteToken(t.Key)
			}
		})
	}

	return int(result.RowsAffected), nil
}

// BatchDeleteTokens 删除指定用户的一组令牌，返回成功删除数量
func BatchDeleteTokens(ids []int, userId int) (int, error) {
	if len(ids) == 0 {
		return 0, errors.New("ids 不能为空！")
	}

	tx := DB.Begin()

	var tokens []Token
	if err := tx.Where("user_id = ? AND id IN (?)", userId, ids).Find(&tokens).Error; err != nil {
		tx.Rollback()
		return 0, err
	}

	if err := tx.Where("user_id = ? AND id IN (?)", userId, ids).Delete(&Token{}).Error; err != nil {
		tx.Rollback()
		return 0, err
	}

	if err := tx.Commit().Error; err != nil {
		return 0, err
	}

	if common.RedisEnabled {
		gopool.Go(func() {
			for _, t := range tokens {
				_ = cacheDeleteToken(t.Key)
			}
		})
	}

	return len(tokens), nil
}

// escapeLikeInput escapes special characters for LIKE queries
func escapeLikeInput(input string) string {
	input = strings.ReplaceAll(input, "!", "!!")
	input = strings.ReplaceAll(input, "%", "!%")
	input = strings.ReplaceAll(input, "_", "!_")
	return input
}

// TokenWithUser carries username alongside token data for admin queries
type TokenWithUser struct {
	Token
	Username string `json:"username"`
}

// buildAdminTokenQuery builds the base query with filters for admin token listing
func buildAdminTokenQuery(username, tokenName, tokenKey string, status int) *gorm.DB {
	query := DB.Table("tokens").
		Joins("LEFT JOIN users ON tokens.user_id = users.id").
		Where("tokens.deleted_at IS NULL")

	if username != "" {
		query = query.Where("users.username LIKE ? ESCAPE '!'", "%"+escapeLikeInput(username)+"%")
	}
	if tokenName != "" {
		query = query.Where("tokens.name LIKE ? ESCAPE '!'", "%"+escapeLikeInput(tokenName)+"%")
	}
	if tokenKey != "" {
		query = query.Where("tokens."+commonKeyCol+" LIKE ? ESCAPE '!'", "%"+escapeLikeInput(tokenKey)+"%")
	}
	if status != 0 {
		query = query.Where("tokens.status = ?", status)
	}
	return query
}

// GetAllTokensAdmin returns paginated tokens with username, supports filtering by username/token name/token key/status
func GetAllTokensAdmin(startIdx, num int, username, tokenName, tokenKey string, status int) ([]*TokenWithUser, error) {
	var tokens []*TokenWithUser
	query := buildAdminTokenQuery(username, tokenName, tokenKey, status).
		Select("tokens.*, users.username")
	err := query.Order("tokens.id desc").Offset(startIdx).Limit(num).Find(&tokens).Error
	return tokens, err
}

// CountTokensAdmin counts tokens matching the same filters as GetAllTokensAdmin
func CountTokensAdmin(username, tokenName, tokenKey string, status int) (int64, error) {
	var total int64
	query := buildAdminTokenQuery(username, tokenName, tokenKey, status)
	err := query.Count(&total).Error
	return total, err
}

// GetTokenByIdAdmin gets a single token by ID without user_id restriction
func GetTokenByIdAdmin(id int) (*Token, error) {
	if id == 0 {
		return nil, errors.New("id 为空！")
	}
	var token Token
	err := DB.First(&token, "id = ?", id).Error
	return &token, err
}

// UpdateTokenAdmin updates a token without user_id restriction (admin only)
func UpdateTokenAdmin(token *Token) (err error) {
	defer func() {
		if shouldUpdateRedis(true, err) {
			gopool.Go(func() {
				err := cacheSetToken(*token)
				if err != nil {
					common.SysLog("failed to update token cache: " + err.Error())
				}
			})
		}
	}()
	err = DB.Model(token).Select("name", "status", "expired_time", "remain_quota", "unlimited_quota",
		"model_limits_enabled", "model_limits", "allow_ips", "group", "cross_group_retry",
		"quota_limit_period", "quota_limit_custom_seconds", "quota_limit", "quota_limit_used", "quota_limit_reset_time").Updates(token).Error
	return err
}

// DeleteTokenByIdAdmin deletes a single token by ID without user_id restriction
func DeleteTokenByIdAdmin(id int) error {
	if id == 0 {
		return errors.New("id 为空！")
	}
	var token Token
	err := DB.First(&token, "id = ?", id).Error
	if err != nil {
		return err
	}
	return token.Delete()
}

// BatchDeleteTokensAdmin deletes tokens by IDs without user_id restriction
func BatchDeleteTokensAdmin(ids []int) (int, error) {
	if len(ids) == 0 {
		return 0, errors.New("ids 不能为空！")
	}

	tx := DB.Begin()

	var tokens []Token
	if err := tx.Where("id IN (?)", ids).Find(&tokens).Error; err != nil {
		tx.Rollback()
		return 0, err
	}

	if err := tx.Where("id IN (?)", ids).Delete(&Token{}).Error; err != nil {
		tx.Rollback()
		return 0, err
	}

	if err := tx.Commit().Error; err != nil {
		return 0, err
	}

	if common.RedisEnabled {
		gopool.Go(func() {
			for _, t := range tokens {
				_ = cacheDeleteToken(t.Key)
			}
		})
	}

	return len(tokens), nil
}

// ==================== Token Periodic Quota Limit ====================

const (
	TokenQuotaLimitNever   = "never"
	TokenQuotaLimitDaily   = "daily"
	TokenQuotaLimitWeekly  = "weekly"
	TokenQuotaLimitMonthly = "monthly"
	TokenQuotaLimitCustom  = "custom"
)

func NormalizeTokenQuotaLimitPeriod(period string) string {
	switch period {
	case TokenQuotaLimitDaily, TokenQuotaLimitWeekly, TokenQuotaLimitMonthly, TokenQuotaLimitCustom:
		return period
	default:
		return TokenQuotaLimitNever
	}
}

func CalcTokenQuotaLimitNextResetTime(base time.Time, period string, customSeconds int64) int64 {
	switch period {
	case TokenQuotaLimitDaily:
		next := time.Date(base.Year(), base.Month(), base.Day()+1, 0, 0, 0, 0, base.Location())
		return next.Unix()
	case TokenQuotaLimitWeekly:
		daysUntilMonday := (8 - int(base.Weekday())) % 7
		if daysUntilMonday == 0 {
			daysUntilMonday = 7
		}
		next := time.Date(base.Year(), base.Month(), base.Day()+daysUntilMonday, 0, 0, 0, 0, base.Location())
		return next.Unix()
	case TokenQuotaLimitMonthly:
		next := time.Date(base.Year(), base.Month()+1, 1, 0, 0, 0, 0, base.Location())
		return next.Unix()
	case TokenQuotaLimitCustom:
		if customSeconds <= 0 {
			customSeconds = 86400
		}
		return base.Unix() + customSeconds
	default:
		return 0
	}
}

func (token *Token) IsQuotaLimitEnabled() bool {
	return token.QuotaLimitPeriod != TokenQuotaLimitNever &&
		token.QuotaLimitPeriod != "" &&
		token.QuotaLimit > 0
}

func (token *Token) QuotaLimitRemaining() int {
	if !token.IsQuotaLimitEnabled() {
		return -1
	}
	remaining := token.QuotaLimit - token.QuotaLimitUsed
	if remaining < 0 {
		return 0
	}
	return remaining
}

func (token *Token) MaybeResetQuotaLimit(now int64) bool {
	if !token.IsQuotaLimitEnabled() {
		return false
	}
	if token.QuotaLimitResetTime <= 0 || now < token.QuotaLimitResetTime {
		return false
	}
	for token.QuotaLimitResetTime > 0 && token.QuotaLimitResetTime <= now {
		base := time.Unix(token.QuotaLimitResetTime, 0)
		token.QuotaLimitResetTime = CalcTokenQuotaLimitNextResetTime(base, token.QuotaLimitPeriod, token.QuotaLimitCustomSeconds)
	}
	token.QuotaLimitUsed = 0
	return true
}

func PersistTokenQuotaLimitReset(token *Token) error {
	err := DB.Model(&Token{}).Where("id = ?", token.Id).Updates(map[string]interface{}{
		"quota_limit_used":       0,
		"quota_limit_reset_time": token.QuotaLimitResetTime,
	}).Error
	if err != nil {
		return err
	}
	if common.RedisEnabled {
		gopool.Go(func() {
			if cacheErr := cacheSetToken(*token); cacheErr != nil {
				common.SysLog("failed to update token cache after quota limit reset: " + cacheErr.Error())
			}
		})
	}
	return nil
}

func increaseTokenQuotaLimitUsed(id int, delta int) error {
	if delta == 0 {
		return nil
	}
	if delta > 0 {
		return DB.Model(&Token{}).Where("id = ?", id).Update(
			"quota_limit_used", gorm.Expr("quota_limit_used + ?", delta),
		).Error
	}
	absDelta := -delta
	return DB.Model(&Token{}).Where("id = ?", id).Update(
		"quota_limit_used", gorm.Expr("CASE WHEN quota_limit_used >= ? THEN quota_limit_used - ? ELSE 0 END", absDelta, absDelta),
	).Error
}

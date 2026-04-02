package controller

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

func buildMaskedTokenResponse(token *model.Token) *model.Token {
	if token == nil {
		return nil
	}
	maskedToken := *token
	maskedToken.Key = token.GetMaskedKey()
	return &maskedToken
}

func buildMaskedTokenResponses(tokens []*model.Token) []*model.Token {
	maskedTokens := make([]*model.Token, 0, len(tokens))
	for _, token := range tokens {
		maskedTokens = append(maskedTokens, buildMaskedTokenResponse(token))
	}
	return maskedTokens
}

func GetAllTokens(c *gin.Context) {
	userId := c.GetInt("id")
	pageInfo := common.GetPageQuery(c)
	tokenName := c.Query("token_name")
	tokenKey := c.Query("token")
	group := c.Query("group")
	status, _ := strconv.Atoi(c.DefaultQuery("status", "0"))

	if tokenKey != "" {
		tokenKey = strings.TrimPrefix(tokenKey, "sk-")
	}

	tokens, err := model.GetAllUserTokens(userId, pageInfo.GetStartIdx(), pageInfo.GetPageSize(), tokenName, tokenKey, status, group)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// Lazy reset periodic quota for display: check and persist any overdue resets
	now := common.GetTimestamp()
	for _, t := range tokens {
		if t.MaybeResetQuotaLimit(now) {
			if resetErr := model.PersistTokenQuotaLimitReset(t); resetErr != nil {
				common.SysLog("failed to persist token quota limit reset on list: " + resetErr.Error())
			}
		}
	}
	total, _ := model.CountUserTokens(userId, tokenName, tokenKey, status, group)
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(buildMaskedTokenResponses(tokens))
	common.ApiSuccess(c, pageInfo)
}

func SearchTokens(c *gin.Context) {
	userId := c.GetInt("id")
	keyword := c.Query("keyword")
	token := c.Query("token")

	pageInfo := common.GetPageQuery(c)

	tokens, total, err := model.SearchUserTokens(userId, keyword, token, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(buildMaskedTokenResponses(tokens))
	common.ApiSuccess(c, pageInfo)
}

func GetToken(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	userId := c.GetInt("id")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	token, err := model.GetTokenByIds(id, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, buildMaskedTokenResponse(token))
}

func GetTokenKey(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	userId := c.GetInt("id")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	token, err := model.GetTokenByIds(id, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"key": token.GetFullKey(),
	})
}

func GetTokenStatus(c *gin.Context) {
	tokenId := c.GetInt("token_id")
	userId := c.GetInt("id")
	token, err := model.GetTokenByIds(tokenId, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	expiredAt := token.ExpiredTime
	if expiredAt == -1 {
		expiredAt = 0
	}
	c.JSON(http.StatusOK, gin.H{
		"object":          "credit_summary",
		"total_granted":   token.RemainQuota,
		"total_used":      0, // not supported currently
		"total_available": token.RemainQuota,
		"expires_at":      expiredAt * 1000,
	})
}

func GetTokenUsage(c *gin.Context) {
	authHeader := c.GetHeader("Authorization")
	if authHeader == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"message": "No Authorization header",
		})
		return
	}

	parts := strings.Split(authHeader, " ")
	if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"message": "Invalid Bearer token",
		})
		return
	}
	tokenKey := parts[1]

	token, err := model.GetTokenByKey(strings.TrimPrefix(tokenKey, "sk-"), false)
	if err != nil {
		common.SysError("failed to get token by key: " + err.Error())
		common.ApiErrorI18n(c, i18n.MsgTokenGetInfoFailed)
		return
	}

	expiredAt := token.ExpiredTime
	if expiredAt == -1 {
		expiredAt = 0
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    true,
		"message": "ok",
		"data": gin.H{
			"object":               "token_usage",
			"name":                 token.Name,
			"total_granted":        token.RemainQuota + token.UsedQuota,
			"total_used":           token.UsedQuota,
			"total_available":      token.RemainQuota,
			"unlimited_quota":      token.UnlimitedQuota,
			"model_limits":         token.GetModelLimitsMap(),
			"model_limits_enabled": token.ModelLimitsEnabled,
			"expires_at":           expiredAt,
		},
	})
}

func AddToken(c *gin.Context) {
	token := model.Token{}
	err := c.ShouldBindJSON(&token)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if len(token.Name) > 50 {
		common.ApiErrorI18n(c, i18n.MsgTokenNameTooLong)
		return
	}
	// 非无限额度时，检查额度值是否超出有效范围
	if !token.UnlimitedQuota {
		if token.RemainQuota < 0 {
			common.ApiErrorI18n(c, i18n.MsgTokenQuotaNegative)
			return
		}
		maxQuotaValue := int((1000000000 * common.QuotaPerUnit))
		if token.RemainQuota > maxQuotaValue {
			common.ApiErrorI18n(c, i18n.MsgTokenQuotaExceedMax, map[string]any{"Max": maxQuotaValue})
			return
		}
	}
	// 检查用户令牌数量是否已达上限
	maxTokens := operation_setting.GetMaxUserTokens()
	count, err := model.CountUserTokens(c.GetInt("id"), "", "", 0)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if int(count) >= maxTokens {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": fmt.Sprintf("已达到最大令牌数量限制 (%d)", maxTokens),
		})
		return
	}
	key, err := common.GenerateKey()
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgTokenGenerateFailed)
		common.SysLog("failed to generate token key: " + err.Error())
		return
	}
	// Validate periodic quota limit
	period := model.NormalizeTokenQuotaLimitPeriod(token.QuotaLimitPeriod)
	if period != model.TokenQuotaLimitNever {
		if !model.IsQuotaLimitAllowed(c.GetInt("id")) {
			common.ApiError(c, fmt.Errorf("您没有配置周期限额的权限"))
			return
		}
		if token.QuotaLimit <= 0 {
			common.ApiError(c, fmt.Errorf("启用周期限额时必须设置限额值"))
			return
		}
	}
	if period == model.TokenQuotaLimitCustom && token.QuotaLimitCustomSeconds <= 0 {
		common.ApiError(c, fmt.Errorf("自定义周期必须设置秒数"))
		return
	}
	cleanToken := model.Token{
		UserId:                  c.GetInt("id"),
		Name:                    token.Name,
		Key:                     key,
		CreatedTime:             common.GetTimestamp(),
		AccessedTime:            common.GetTimestamp(),
		ExpiredTime:             token.ExpiredTime,
		RemainQuota:             token.RemainQuota,
		UnlimitedQuota:          token.UnlimitedQuota,
		ModelLimitsEnabled:      token.ModelLimitsEnabled,
		ModelLimits:             token.ModelLimits,
		AllowIps:                token.AllowIps,
		Group:                   token.Group,
		CrossGroupRetry:         token.CrossGroupRetry,
		QuotaLimitPeriod:        period,
		QuotaLimitCustomSeconds: token.QuotaLimitCustomSeconds,
		QuotaLimit:              token.QuotaLimit,
	}
	if period != model.TokenQuotaLimitNever && cleanToken.QuotaLimit > 0 {
		cleanToken.QuotaLimitResetTime = model.CalcTokenQuotaLimitNextResetTime(time.Now(), period, cleanToken.QuotaLimitCustomSeconds)
	}
	err = cleanToken.Insert()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
}

func DeleteToken(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	userId := c.GetInt("id")
	err := model.DeleteTokenById(id, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
}

func UpdateToken(c *gin.Context) {
	userId := c.GetInt("id")
	statusOnly := c.Query("status_only")
	token := model.Token{}
	err := c.ShouldBindJSON(&token)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if len(token.Name) > 50 {
		common.ApiErrorI18n(c, i18n.MsgTokenNameTooLong)
		return
	}
	if !token.UnlimitedQuota {
		if token.RemainQuota < 0 {
			common.ApiErrorI18n(c, i18n.MsgTokenQuotaNegative)
			return
		}
		maxQuotaValue := int((1000000000 * common.QuotaPerUnit))
		if token.RemainQuota > maxQuotaValue {
			common.ApiErrorI18n(c, i18n.MsgTokenQuotaExceedMax, map[string]any{"Max": maxQuotaValue})
			return
		}
	}
	cleanToken, err := model.GetTokenByIds(token.Id, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if token.Status == common.TokenStatusEnabled {
		if cleanToken.Status == common.TokenStatusExpired && cleanToken.ExpiredTime <= common.GetTimestamp() && cleanToken.ExpiredTime != -1 {
			common.ApiErrorI18n(c, i18n.MsgTokenExpiredCannotEnable)
			return
		}
		if cleanToken.Status == common.TokenStatusExhausted && cleanToken.RemainQuota <= 0 && !cleanToken.UnlimitedQuota {
			common.ApiErrorI18n(c, i18n.MsgTokenExhaustedCannotEable)
			return
		}
	}
	if statusOnly != "" {
		cleanToken.Status = token.Status
	} else {
		// If you add more fields, please also update token.Update()
		cleanToken.Name = token.Name
		cleanToken.ExpiredTime = token.ExpiredTime
		cleanToken.RemainQuota = token.RemainQuota
		cleanToken.UnlimitedQuota = token.UnlimitedQuota
		cleanToken.ModelLimitsEnabled = token.ModelLimitsEnabled
		cleanToken.ModelLimits = token.ModelLimits
		cleanToken.AllowIps = token.AllowIps
		cleanToken.Group = token.Group
		cleanToken.CrossGroupRetry = token.CrossGroupRetry
		// Periodic quota limit fields
		newPeriod := model.NormalizeTokenQuotaLimitPeriod(token.QuotaLimitPeriod)
		if newPeriod != model.TokenQuotaLimitNever {
			if !model.IsQuotaLimitAllowed(userId) {
				common.ApiError(c, fmt.Errorf("您没有配置周期限额的权限"))
				return
			}
			if token.QuotaLimit <= 0 {
				common.ApiError(c, fmt.Errorf("启用周期限额时必须设置限额值"))
				return
			}
		}
		if newPeriod == model.TokenQuotaLimitCustom && token.QuotaLimitCustomSeconds <= 0 {
			common.ApiError(c, fmt.Errorf("自定义周期必须设置秒数"))
			return
		}
		periodChanged := newPeriod != cleanToken.QuotaLimitPeriod || token.QuotaLimitCustomSeconds != cleanToken.QuotaLimitCustomSeconds
		cleanToken.QuotaLimitPeriod = newPeriod
		cleanToken.QuotaLimitCustomSeconds = token.QuotaLimitCustomSeconds
		cleanToken.QuotaLimit = token.QuotaLimit
		if periodChanged && newPeriod != model.TokenQuotaLimitNever {
			cleanToken.QuotaLimitUsed = 0
			cleanToken.QuotaLimitResetTime = model.CalcTokenQuotaLimitNextResetTime(time.Now(), newPeriod, cleanToken.QuotaLimitCustomSeconds)
		}
		if newPeriod == model.TokenQuotaLimitNever {
			cleanToken.QuotaLimitUsed = 0
			cleanToken.QuotaLimitResetTime = 0
		}
	}
	err = cleanToken.Update()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    buildMaskedTokenResponse(cleanToken),
	})
}

type TokenBatchUpdate struct {
	Ids                     []int  `json:"ids"`
	Action                  string `json:"action"` // "set_quota" | "set_periodic_quota"
	RemainQuota             int    `json:"remain_quota"`
	UnlimitedQuota          bool   `json:"unlimited_quota"`
	QuotaLimitPeriod        string `json:"quota_limit_period"`
	QuotaLimit              int    `json:"quota_limit"`
	QuotaLimitCustomSeconds int64  `json:"quota_limit_custom_seconds"`
}

func BatchUpdateTokens(c *gin.Context) {
	req := TokenBatchUpdate{}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.SysLog(fmt.Sprintf("BatchUpdateTokens: JSON bind error: %v", err))
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	common.SysLog(fmt.Sprintf("BatchUpdateTokens: action=%s, ids=%v, period=%s, quota_limit=%d, custom_seconds=%d, remain_quota=%d, unlimited=%v",
		req.Action, req.Ids, req.QuotaLimitPeriod, req.QuotaLimit, req.QuotaLimitCustomSeconds, req.RemainQuota, req.UnlimitedQuota))
	if len(req.Ids) == 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	userId := c.GetInt("id")

	switch req.Action {
	case "set_quota":
		if !req.UnlimitedQuota {
			if req.RemainQuota < 0 {
				common.ApiErrorI18n(c, i18n.MsgTokenQuotaNegative)
				return
			}
			maxQuotaValue := int(1000000000 * common.QuotaPerUnit)
			if req.RemainQuota > maxQuotaValue {
				common.ApiErrorI18n(c, i18n.MsgTokenQuotaExceedMax, map[string]any{"Max": maxQuotaValue})
				return
			}
		}
		count, err := model.BatchUpdateTokenQuota(req.Ids, userId, req.RemainQuota, req.UnlimitedQuota)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "",
			"data":    count,
		})

	case "set_periodic_quota":
		period := model.NormalizeTokenQuotaLimitPeriod(req.QuotaLimitPeriod)
		if period != model.TokenQuotaLimitNever {
			if !model.IsQuotaLimitAllowed(userId) {
				common.ApiError(c, fmt.Errorf("您没有配置周期限额的权限"))
				return
			}
			if req.QuotaLimit <= 0 {
				common.ApiError(c, fmt.Errorf("启用周期限额时必须设置限额值"))
				return
			}
		}
		if period == model.TokenQuotaLimitCustom && req.QuotaLimitCustomSeconds <= 0 {
			common.ApiError(c, fmt.Errorf("自定义周期必须设置秒数"))
			return
		}
		count, err := model.BatchUpdateTokenPeriodicQuota(req.Ids, userId, period, req.QuotaLimit, req.QuotaLimitCustomSeconds)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "",
			"data":    count,
		})

	default:
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
	}
}

type TokenBatch struct {
	Ids []int `json:"ids"`
}

func DeleteTokenBatch(c *gin.Context) {
	tokenBatch := TokenBatch{}
	if err := c.ShouldBindJSON(&tokenBatch); err != nil || len(tokenBatch.Ids) == 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	userId := c.GetInt("id")
	count, err := model.BatchDeleteTokens(tokenBatch.Ids, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    count,
	})
}

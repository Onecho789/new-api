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

	"github.com/gin-gonic/gin"
)

func GetAllTokensAdmin(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	username := c.Query("username")
	tokenName := c.Query("token_name")
	tokenKey := c.Query("token")
	status, _ := strconv.Atoi(c.DefaultQuery("status", "0"))

	if tokenKey != "" {
		tokenKey = strings.TrimPrefix(tokenKey, "sk-")
	}

	tokens, err := model.GetAllTokensAdmin(pageInfo.GetStartIdx(), pageInfo.GetPageSize(), username, tokenName, tokenKey, status)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// Lazy reset periodic quota for display
	now := common.GetTimestamp()
	for _, t := range tokens {
		if t.Token.MaybeResetQuotaLimit(now) {
			if resetErr := model.PersistTokenQuotaLimitReset(&t.Token); resetErr != nil {
				common.SysLog("failed to persist token quota limit reset on admin list: " + resetErr.Error())
			}
		}
	}
	total, _ := model.CountTokensAdmin(username, tokenName, tokenKey, status)
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(tokens)
	common.ApiSuccess(c, pageInfo)
}

func GetTokenAdmin(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	token, err := model.GetTokenByIdAdmin(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    token,
	})
}

func UpdateTokenAdmin(c *gin.Context) {
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
	cleanToken, err := model.GetTokenByIdAdmin(token.Id)
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
	cleanToken.Name = token.Name
	cleanToken.Status = token.Status
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
	if newPeriod != model.TokenQuotaLimitNever && token.QuotaLimit <= 0 {
		common.ApiError(c, fmt.Errorf("启用周期限额时必须设置限额值"))
		return
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

	err = model.UpdateTokenAdmin(cleanToken)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    cleanToken,
	})
}

func DeleteTokenAdmin(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	err := model.DeleteTokenByIdAdmin(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
}

func DeleteTokenBatchAdmin(c *gin.Context) {
	tokenBatch := TokenBatch{}
	if err := c.ShouldBindJSON(&tokenBatch); err != nil || len(tokenBatch.Ids) == 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	count, err := model.BatchDeleteTokensAdmin(tokenBatch.Ids)
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

package controller

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func personalGroupRatioTarget(c *gin.Context) (*model.User, bool) {
	if c.GetInt("id") <= 0 || c.GetInt("role") < common.RoleAdminUser {
		common.ApiErrorStatus(c, http.StatusForbidden, common.NewMessage("No permission to access users of same or higher level"))
		return nil, false
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
		return nil, false
	}
	user, err := model.GetUserById(id, false)
	if err != nil {
		common.ApiErrorT(c, "Database error, please contact the administrator")
		return nil, false
	}
	if !canManageTargetRole(c.GetInt("role"), user.Role) {
		common.ApiErrorStatus(c, http.StatusForbidden, common.NewMessage("No permission to access users of same or higher level"))
		return nil, false
	}
	return user, true
}

func GetUserGroupRatios(c *gin.Context) {
	user, ok := personalGroupRatioTarget(c)
	if !ok {
		return
	}
	writePersonalGroupRatios(c, user.Id, time.Now())
}

func ListUserGroupRatios(c *gin.Context) {
	if c.GetInt("id") <= 0 || c.GetInt("role") < common.RoleAdminUser {
		common.ApiErrorStatus(c, http.StatusForbidden, common.NewMessage("No permission to access users of same or higher level"))
		return
	}
	page, pageSize := 1, 20
	for key, target := range map[string]*int{"p": &page, "page_size": &pageSize} {
		if value, present := c.GetQuery(key); present {
			parsed, err := strconv.Atoi(value)
			if err != nil || parsed < 1 {
				common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
				return
			}
			*target = parsed
		}
	}
	pageSize = min(pageSize, 100)
	userID := 0
	if value, present := c.GetQuery("user_id"); present {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed <= 0 {
			common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
			return
		}
		userID = parsed
	}
	result, err := model.ListManagedUserGroupRatios(c.Request.Context(), c.GetInt("id"), model.UserGroupRatioListOptions{
		Page: page, PageSize: pageSize, UserID: userID,
		Keyword: strings.TrimSpace(c.Query("keyword")), Group: c.Query("group"), Status: c.Query("status"),
	}, time.Now())
	if err != nil {
		var message *common.Message
		if errors.As(err, &message) {
			common.ApiErrorStatus(c, http.StatusBadRequest, message)
		} else {
			common.ApiErrorT(c, "Database error, please contact the administrator")
		}
		return
	}
	common.ApiSuccess(c, result)
}

func UpdateUserGroupRatios(c *gin.Context) {
	user, ok := personalGroupRatioTarget(c)
	if !ok {
		return
	}
	var input struct {
		Rules *[]struct {
			Group             string   `json:"group"`
			Ratio             *float64 `json:"ratio"`
			MinDailyQuota     *int64   `json:"min_daily_quota"`
			Enabled           *bool    `json:"enabled"`
			Version           *int64   `json:"version"`
			DailyCheckEnabled *bool    `json:"daily_check_enabled"`
			StartsAt          *int64   `json:"starts_at"`
			EndsAt            *int64   `json:"ends_at"`
			DurationSeconds   *int64   `json:"duration_seconds"`
		} `json:"rules"`
	}
	if err := common.DecodeJson(c.Request.Body, &input); err != nil || input.Rules == nil {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
		return
	}
	rules := make([]model.UserGroupRatioInput, 0, len(*input.Rules))
	groups := make([]string, 0, len(*input.Rules))
	for _, rule := range *input.Rules {
		if rule.Ratio == nil || rule.Enabled == nil || (rule.MinDailyQuota == nil && (rule.DailyCheckEnabled == nil || *rule.DailyCheckEnabled)) {
			common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
			return
		}
		minimum := int64(0)
		if rule.MinDailyQuota != nil {
			minimum = *rule.MinDailyQuota
		}
		rules = append(rules, model.UserGroupRatioInput{
			Group: rule.Group, Ratio: *rule.Ratio, MinDailyQuota: minimum, Enabled: *rule.Enabled, Version: rule.Version,
			DailyCheckEnabled: rule.DailyCheckEnabled, StartsAt: rule.StartsAt, EndsAt: rule.EndsAt, DurationSeconds: rule.DurationSeconds,
		})
		groups = append(groups, rule.Group)
	}
	now := time.Now()
	if err := model.UpdateUserGroupRatioRules(c.GetInt("id"), user.Id, rules, now); err != nil {
		if errors.Is(err, model.ErrPersonalGroupAlreadyExists) {
			common.ApiErrorStatus(c, http.StatusConflict, model.ErrPersonalGroupAlreadyExists)
			return
		}
		if errors.Is(err, model.ErrPersonalGroupVersionConflict) {
			common.ApiErrorStatus(c, http.StatusConflict, model.ErrPersonalGroupVersionConflict)
			return
		}
		var message *common.Message
		if errors.As(err, &message) {
			common.ApiErrorStatus(c, http.StatusBadRequest, message)
		} else {
			common.ApiErrorT(c, "Database error, please contact the administrator")
		}
		return
	}
	recordManageAuditFor(c, user.Id, "user.update", map[string]any{
		"id": user.Id, "username": user.Username, "changed_fields": []string{"personal_group_ratios"}, "groups": groups,
	})
	writePersonalGroupRatios(c, user.Id, now)
}

func DeleteUserGroupRatio(c *gin.Context) {
	user, ok := personalGroupRatioTarget(c)
	if !ok {
		return
	}
	var input struct {
		Group   string `json:"group"`
		Version int64  `json:"version"`
	}
	if err := common.DecodeJson(c.Request.Body, &input); err != nil || input.Version <= 0 {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
		return
	}
	now := time.Now()
	if err := model.DeleteUserGroupRatioRule(c.GetInt("id"), user.Id, input.Group, input.Version, now); err != nil {
		if errors.Is(err, model.ErrPersonalGroupVersionConflict) {
			common.ApiErrorStatus(c, http.StatusConflict, model.ErrPersonalGroupVersionConflict)
			return
		}
		var message *common.Message
		if errors.As(err, &message) {
			common.ApiErrorStatus(c, http.StatusBadRequest, message)
		} else {
			common.ApiErrorT(c, "Database error, please contact the administrator")
		}
		return
	}
	recordManageAuditFor(c, user.Id, "user.update", map[string]any{
		"id": user.Id, "username": user.Username, "changed_fields": []string{"personal_group_ratios"},
		"groups": []string{input.Group}, "personal_group_ratio_action": "delete", "version": input.Version,
	})
	writePersonalGroupRatios(c, user.Id, now)
}

func writePersonalGroupRatios(c *gin.Context, userID int, at time.Time) {
	rules, err := model.GetPersonalGroupRatioRules(userID, at)
	if err != nil {
		common.ApiErrorT(c, "Database error, please contact the administrator")
		return
	}
	common.ApiSuccess(c, gin.H{"user_id": userID, "timezone": model.PersonalGroupRatioTimezone, "day": model.PersonalGroupRatioDay(at), "rules": rules})
}

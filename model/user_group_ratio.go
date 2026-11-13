package model

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"
	"gorm.io/gorm"
)

const PersonalGroupRatioTimezone = "Asia/Shanghai"

var (
	personalGroupRatioLocation      = time.FixedZone(PersonalGroupRatioTimezone, 8*60*60)
	ErrPersonalGroupRatioInvalid    = common.NewMessage("Personal group ratio must be between 0 and 1000")
	ErrPersonalGroupMinimumInvalid  = common.NewMessage("Daily minimum quota must be a positive safe integer")
	ErrPersonalGroupInvalid         = common.NewMessage("Personal group ratio requires an existing group")
	ErrPersonalGroupDuplicate       = common.NewMessage("Personal group ratio groups must be unique")
	ErrPersonalGroupAlreadyExists   = common.NewMessage("A group discount already exists for this user and group. Edit or delete the existing discount first.")
	ErrPersonalGroupValidityInvalid = common.NewMessage("Invalid group discount validity period.")
	ErrPersonalGroupVersionConflict = common.NewMessage("Group discount changed. Reload it before saving again.")
	ErrPersonalGroupIntentConflict  = errors.New("personal group spend intent conflicts with its immutable settlement")
	ErrPersonalGroupPolicyChanged   = errors.New("personal group ratio policy changed before quota reservation")
)

type PersonalGroupRatioSnapshot = types.PersonalGroupRatioSnapshot

// UserGroupRatio preserves disabled policies and the decision that disabled them.
type UserGroupRatio struct {
	ID                int     `json:"id"`
	UserID            int     `json:"user_id" gorm:"not null;uniqueIndex:idx_user_group_ratio,priority:1"`
	Group             string  `json:"group" gorm:"column:group_name;type:varchar(64);not null"`
	GroupKey          string  `json:"-" gorm:"type:char(64);not null;uniqueIndex:idx_user_group_ratio,priority:2"`
	Ratio             float64 `json:"ratio" gorm:"not null"`
	MinDailyQuota     int64   `json:"min_daily_quota" gorm:"type:bigint;not null"`
	Enabled           bool    `json:"enabled" gorm:"not null;index"`
	StartsAt          int64   `json:"starts_at" gorm:"type:bigint;not null;default:0"`
	EndsAt            int64   `json:"ends_at" gorm:"type:bigint;not null;default:0"`
	Version           int64   `json:"version" gorm:"type:bigint;not null"`
	EnabledAt         int64   `json:"enabled_at" gorm:"type:bigint;not null"`
	DisabledAt        int64   `json:"disabled_at" gorm:"type:bigint;not null"`
	DisableReason     string  `json:"disable_reason" gorm:"type:varchar(32);not null"`
	CheckedThroughDay string  `json:"-" gorm:"type:varchar(10);not null"`
	LastCheckDay      string  `json:"last_check_day" gorm:"type:varchar(10);not null"`
	LastCheckAt       int64   `json:"last_check_at" gorm:"type:bigint;not null"`
	LastCheckQuota    int64   `json:"last_check_quota" gorm:"type:bigint;not null"`
	LastCheckStatus   string  `json:"last_check_status" gorm:"type:varchar(16);not null"`
	CreatedTime       int64   `json:"created_at" gorm:"type:bigint;not null"`
	UpdatedTime       int64   `json:"updated_at" gorm:"type:bigint;not null"`
}

// UserGroupSpendIntent is an accounting fence, not an atomic wallet transaction.
// A crash or ambiguous funding failure leaves it pending and blocks revocation.
type UserGroupSpendIntent struct {
	ID            int
	RequestKey    string  `gorm:"type:varchar(191);not null;uniqueIndex"`
	RuleID        int     `gorm:"not null;index:idx_personal_spend_pending,priority:1"`
	Version       int64   `gorm:"type:bigint;not null"`
	Day           string  `gorm:"type:varchar(10);not null;index:idx_personal_spend_pending,priority:3"`
	Status        string  `gorm:"type:varchar(16);not null;index:idx_personal_spend_pending,priority:2"`
	Kind          string  `gorm:"type:varchar(16);not null"`
	Ratio         float64 `gorm:"not null"`
	Quota         int64   `gorm:"type:bigint;not null"`
	CreatedTime   int64   `gorm:"type:bigint;not null"`
	CompletedTime int64   `gorm:"type:bigint;not null"`
}

type UserGroupSpendDaily struct {
	ID     int
	RuleID int    `gorm:"not null;uniqueIndex:idx_personal_spend_day,priority:1"`
	Day    string `gorm:"type:varchar(10);not null;uniqueIndex:idx_personal_spend_day,priority:2"`
	Quota  int64  `gorm:"type:bigint;not null"`
}

type UserGroupRatioInput struct {
	Group             string  `json:"group"`
	Ratio             float64 `json:"ratio"`
	MinDailyQuota     int64   `json:"min_daily_quota"`
	Enabled           bool    `json:"enabled"`
	Version           *int64  `json:"version,omitempty"`
	DailyCheckEnabled *bool   `json:"daily_check_enabled,omitempty"`
	StartsAt          *int64  `json:"starts_at,omitempty"`
	EndsAt            *int64  `json:"ends_at,omitempty"`
	DurationSeconds   *int64  `json:"duration_seconds,omitempty"`
}

type UserGroupRatioView struct {
	UserGroupRatio
	TodayQuota        int64  `json:"today_quota"`
	TodayPending      int64  `json:"today_pending"`
	Status            string `json:"status"`
	DailyCheckEnabled bool   `json:"daily_check_enabled" gorm:"-"`
}

type UserGroupRatioListOptions struct {
	Page, PageSize int
	UserID         int
	Keyword        string
	Group          string
	Status         string
}

type UserGroupRatioListItem struct {
	UserGroupRatioView
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	UserRole    int    `json:"user_role"`
}

type UserGroupRatioList struct {
	Items    []UserGroupRatioListItem `json:"items"`
	Total    int64                    `json:"total"`
	Page     int                      `json:"p"`
	PageSize int                      `json:"page_size"`
	Day      string                   `json:"day"`
	Timezone string                   `json:"timezone"`
}

// ListManagedUserGroupRatios applies the same target-role boundary as edits.
// Only the requested page's accounting rows are fetched, with no per-rule queries.
func ListManagedUserGroupRatios(ctx context.Context, actorID int, options UserGroupRatioListOptions, at time.Time) (*UserGroupRatioList, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if actorID <= 0 {
		return nil, common.NewMessage("No permission to access users of same or higher level")
	}
	var actor User
	if err := DB.WithContext(ctx).Select("id", "role", "status").First(&actor, actorID).Error; err != nil {
		return nil, err
	}
	if actor.Role < common.RoleAdminUser || actor.Status != common.UserStatusEnabled {
		return nil, common.NewMessage("No permission to access users of same or higher level")
	}
	if options.Page < 1 || options.Page > 1000000 || options.PageSize < 1 || options.PageSize > 100 || options.UserID < 0 || utf8.RuneCountInString(options.Keyword) > 128 {
		return nil, common.NewMessage("Invalid parameters")
	}
	day := PersonalGroupRatioDay(at)
	local := at.In(personalGroupRatioLocation)
	start := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, personalGroupRatioLocation)
	query := DB.WithContext(ctx).Model(&UserGroupRatio{}).
		Joins("JOIN users ON users.id = user_group_ratios.user_id AND users.deleted_at IS NULL").
		Where("user_group_ratios.disable_reason <> ?", "deleted")
	if actor.Role != common.RoleRootUser {
		query = query.Where("users.role < ?", actor.Role)
	}
	if options.UserID > 0 {
		query = query.Where("user_group_ratios.user_id = ?", options.UserID)
	}
	if options.Group != "" {
		query = query.Where("user_group_ratios.group_key = ?", personalGroupRatioKey(options.Group))
	}
	if keyword := strings.TrimSpace(options.Keyword); keyword != "" {
		pattern := "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(strings.ToLower(keyword)) + "%"
		condition := "(LOWER(users.username) LIKE ? ESCAPE '!' OR LOWER(users.display_name) LIKE ? ESCAPE '!')"
		args := []any{pattern, pattern}
		if id, err := strconv.Atoi(keyword); err == nil && id > 0 {
			condition = "(users.id = ? OR LOWER(users.username) LIKE ? ESCAPE '!' OR LOWER(users.display_name) LIKE ? ESCAPE '!')"
			args = []any{id, pattern, pattern}
		}
		query = query.Where(condition, args...)
	}
	switch options.Status {
	case "":
	case "auto_disabled":
		query = query.Where("user_group_ratios.enabled = ? AND user_group_ratios.disable_reason = ?", false, "below_daily_minimum")
	case "manually_disabled":
		query = query.Where("user_group_ratios.enabled = ? AND user_group_ratios.disable_reason <> ?", false, "below_daily_minimum")
	case "scheduled":
		query = query.Where("user_group_ratios.enabled = ? AND user_group_ratios.starts_at > ?", true, at.Unix())
	case "expired":
		query = query.Where("user_group_ratios.enabled = ? AND user_group_ratios.ends_at > 0 AND user_group_ratios.ends_at <= ?", true, at.Unix())
	case "active", "pending_settlement", "grace_period":
		query = query.Where("user_group_ratios.enabled = ? AND user_group_ratios.starts_at <= ? AND (user_group_ratios.ends_at = 0 OR user_group_ratios.ends_at > ?)", true, at.Unix(), at.Unix())
		activation := "(CASE WHEN user_group_ratios.starts_at > user_group_ratios.enabled_at THEN user_group_ratios.starts_at ELSE user_group_ratios.enabled_at END)"
		grace := "(" + activation + " >= ? AND " + activation + " < ?)"
		if options.Status == "grace_period" {
			query = query.Where("user_group_ratios.min_daily_quota > 0 AND "+grace, start.Unix(), start.AddDate(0, 0, 1).Unix())
		} else if options.Status == "pending_settlement" {
			query = query.Where("user_group_ratios.min_daily_quota > 0 AND NOT "+grace+" AND user_group_ratios.last_check_status = ?", start.Unix(), start.AddDate(0, 0, 1).Unix(), "pending")
		} else {
			query = query.Where("(user_group_ratios.min_daily_quota = 0 OR (NOT "+grace+" AND user_group_ratios.last_check_status <> ?))", start.Unix(), start.AddDate(0, 0, 1).Unix(), "pending")
		}
	default:
		return nil, common.NewMessage("Invalid parameters")
	}
	result := &UserGroupRatioList{Items: make([]UserGroupRatioListItem, 0), Page: options.Page, PageSize: options.PageSize, Day: day, Timezone: PersonalGroupRatioTimezone}
	if err := query.Session(&gorm.Session{}).Count(&result.Total).Error; err != nil {
		return nil, err
	}
	if err := query.Select("user_group_ratios.*, users.username, users.display_name, users.role AS user_role").
		Order("user_group_ratios.id DESC").Offset((options.Page - 1) * options.PageSize).Limit(options.PageSize).Scan(&result.Items).Error; err != nil {
		return nil, err
	}
	if len(result.Items) == 0 {
		return result, nil
	}
	ids := make([]int, 0, len(result.Items))
	for _, item := range result.Items {
		ids = append(ids, item.ID)
	}
	var dailies []UserGroupSpendDaily
	if err := DB.WithContext(ctx).Where("rule_id IN ? AND day = ?", ids, day).Find(&dailies).Error; err != nil {
		return nil, err
	}
	spend := make(map[int]int64, len(dailies))
	for _, daily := range dailies {
		spend[daily.RuleID] = daily.Quota
	}
	var pending []struct {
		RuleID       int
		PendingCount int64
	}
	if err := DB.WithContext(ctx).Model(&UserGroupSpendIntent{}).Select("rule_id, COUNT(*) AS pending_count").
		Where("rule_id IN ? AND day <= ? AND status = ?", ids, day, "pending").Group("rule_id").Scan(&pending).Error; err != nil {
		return nil, err
	}
	waiting := make(map[int]int64, len(pending))
	for _, intent := range pending {
		waiting[intent.RuleID] = intent.PendingCount
	}
	for i := range result.Items {
		item := &result.Items[i]
		item.TodayQuota, item.TodayPending = spend[item.ID], waiting[item.ID]
		item.Status = personalGroupRatioStatus(item.UserGroupRatio, at)
		item.DailyCheckEnabled = item.MinDailyQuota > 0
	}
	return result, nil
}

func personalGroupRatioStatus(rule UserGroupRatio, at time.Time) string {
	switch {
	case !rule.Enabled && rule.DisableReason == "below_daily_minimum":
		return "auto_disabled"
	case !rule.Enabled:
		return "manually_disabled"
	case rule.EndsAt > 0 && at.Unix() >= rule.EndsAt:
		return "expired"
	case at.Unix() < rule.StartsAt:
		return "scheduled"
	case rule.MinDailyQuota == 0:
		return "active"
	case PersonalGroupRatioDay(at) == PersonalGroupRatioDay(time.Unix(max(rule.EnabledAt, rule.StartsAt), 0)):
		return "grace_period"
	case rule.LastCheckStatus == "pending":
		return "pending_settlement"
	default:
		return "active"
	}
}

// IsEffectiveAt checks the validity window when pricing a new request. It does
// not depend on the assessment worker running at either boundary.
func (rule UserGroupRatio) IsEffectiveAt(at time.Time) bool {
	return rule.Enabled && rule.DisableReason != "deleted" && rule.StartsAt <= at.Unix() && (rule.EndsAt == 0 || at.Unix() < rule.EndsAt)
}

// Exact group identity must not depend on the database's default collation.
func personalGroupRatioKey(group string) string {
	digest := sha256.Sum256([]byte(group))
	return hex.EncodeToString(digest[:])
}

func (rule *UserGroupRatio) BeforeSave(_ *gorm.DB) error {
	rule.GroupKey = personalGroupRatioKey(rule.Group)
	return nil
}

func PersonalGroupRatioDay(at time.Time) string {
	return at.In(personalGroupRatioLocation).Format(time.DateOnly)
}

func ListUserGroupRatios(userID int) ([]UserGroupRatio, error) {
	rules := make([]UserGroupRatio, 0)
	if userID <= 0 {
		return rules, nil
	}
	if DB == nil {
		return nil, errors.New("personal group ratio database is not initialized")
	}
	err := DB.Where("user_id = ? AND disable_reason <> ?", userID, "deleted").Order("id asc").Find(&rules).Error
	return rules, err
}

func ResolvePersonalGroupRatio(userID int, group string, at time.Time) (*PersonalGroupRatioSnapshot, error) {
	if userID <= 0 || group == "" {
		return nil, nil
	}
	if DB == nil {
		return nil, errors.New("personal group ratio database is not initialized")
	}
	var rule UserGroupRatio
	err := DB.Where("user_id = ? AND group_key = ? AND enabled = ?", userID, personalGroupRatioKey(group), true).First(&rule).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !rule.IsEffectiveAt(at) {
		return nil, nil
	}
	if math.IsNaN(rule.Ratio) || math.IsInf(rule.Ratio, 0) || rule.Ratio < 0 || rule.Ratio > 1000 {
		return nil, ErrPersonalGroupRatioInvalid
	}
	return &PersonalGroupRatioSnapshot{RuleID: rule.ID, UserID: rule.UserID, Group: rule.Group, Version: rule.Version, Ratio: rule.Ratio, PricedAt: at.Unix()}, nil
}

func GetPersonalGroupRatioRules(userID int, at time.Time) ([]UserGroupRatioView, error) {
	rules, err := ListUserGroupRatios(userID)
	if err != nil {
		return nil, err
	}
	views := make([]UserGroupRatioView, 0, len(rules))
	day := PersonalGroupRatioDay(at)
	for _, rule := range rules {
		view := UserGroupRatioView{UserGroupRatio: rule, Status: personalGroupRatioStatus(rule, at), DailyCheckEnabled: rule.MinDailyQuota > 0}
		var daily UserGroupSpendDaily
		err := DB.Where("rule_id = ? AND day = ?", rule.ID, day).First(&daily).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		view.TodayQuota = daily.Quota
		if err := DB.Model(&UserGroupSpendIntent{}).Where("rule_id = ? AND day <= ? AND status = ?", rule.ID, day, "pending").Count(&view.TodayPending).Error; err != nil {
			return nil, err
		}
		views = append(views, view)
	}
	return views, nil
}

// UpdateUserGroupRatioRules serializes edits on the target user and rechecks
// role boundaries in the transaction, including a concurrent target promotion.
func UpdateUserGroupRatioRules(actorID, userID int, input []UserGroupRatioInput, at time.Time) error {
	if len(input) > 100 {
		return common.NewMessage("At most 100 personal group ratios can be updated at once")
	}
	seen := make(map[string]bool, len(input))
	for _, rule := range input {
		if rule.Group == "" || strings.TrimSpace(rule.Group) != rule.Group || utf8.RuneCountInString(rule.Group) > 64 || rule.Group == "auto" || !ratio_setting.ContainsGroupRatio(rule.Group) {
			return ErrPersonalGroupInvalid
		}
		if seen[rule.Group] {
			return ErrPersonalGroupDuplicate
		}
		seen[rule.Group] = true
		if math.IsNaN(rule.Ratio) || math.IsInf(rule.Ratio, 0) || rule.Ratio < 0 || rule.Ratio > 1000 {
			return ErrPersonalGroupRatioInvalid
		}
		if rule.MinDailyQuota < 0 || rule.MinDailyQuota > common.MaxWalletQuota || (rule.MinDailyQuota == 0 && (rule.DailyCheckEnabled == nil || *rule.DailyCheckEnabled)) {
			return ErrPersonalGroupMinimumInvalid
		}
		if rule.Version != nil && *rule.Version < 0 {
			return common.NewMessage("Invalid parameters")
		}
		for _, timestamp := range []*int64{rule.StartsAt, rule.EndsAt} {
			if timestamp != nil && (*timestamp < 0 || *timestamp > ratio_setting.MaxGroupRatioTimestamp) {
				return ErrPersonalGroupValidityInvalid
			}
		}
		if rule.DurationSeconds != nil && (*rule.DurationSeconds != 7200 || !rule.Enabled || rule.StartsAt != nil || rule.EndsAt != nil || at.Unix() <= 0 || at.Unix() > ratio_setting.MaxGroupRatioTimestamp-7200) {
			return ErrPersonalGroupValidityInvalid
		}
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := lockPersonalGroupRatioManagementUsers(tx, actorID, userID); err != nil {
			return err
		}
		for _, update := range input {
			var rule UserGroupRatio
			err := lockForUpdate(tx).Where("user_id = ? AND group_key = ?", userID, personalGroupRatioKey(update.Group)).First(&rule).Error
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			deleted := err == nil && rule.DisableReason == "deleted"
			if deleted {
				// Only an explicit create can restore a removed policy. Old editors,
				// including clients without versions, must never resurrect it.
				if update.Version == nil || *update.Version != 0 {
					return ErrPersonalGroupVersionConflict
				}
			} else if update.Version != nil {
				if *update.Version == 0 && err == nil {
					return ErrPersonalGroupAlreadyExists
				}
				if *update.Version != rule.Version {
					return ErrPersonalGroupVersionConflict
				}
			}
			startsAt, endsAt := rule.StartsAt, rule.EndsAt
			if deleted {
				startsAt, endsAt = 0, 0
			}
			if update.DurationSeconds != nil {
				startsAt, endsAt = at.Unix(), at.Unix()+*update.DurationSeconds
			} else {
				if update.StartsAt != nil {
					startsAt = *update.StartsAt
				}
				if update.EndsAt != nil {
					endsAt = *update.EndsAt
				}
			}
			if endsAt > 0 && (endsAt <= startsAt || (update.Enabled && endsAt <= at.Unix())) {
				return ErrPersonalGroupValidityInvalid
			}
			minimum := update.MinDailyQuota
			if update.DailyCheckEnabled != nil && !*update.DailyCheckEnabled {
				minimum = 0
			}
			if err == nil && !deleted && rule.Ratio == update.Ratio && rule.MinDailyQuota == minimum && rule.Enabled == update.Enabled && rule.StartsAt == startsAt && rule.EndsAt == endsAt {
				continue
			}
			rule.UserID, rule.Group = userID, update.Group
			rule.Ratio, rule.MinDailyQuota, rule.Enabled = update.Ratio, minimum, update.Enabled
			rule.StartsAt, rule.EndsAt = startsAt, endsAt
			rule.Version++
			rule.UpdatedTime = at.Unix()
			if rule.CreatedTime == 0 {
				rule.CreatedTime = at.Unix()
			}
			if update.Enabled || deleted {
				rule.EnabledAt = 0
				rule.CheckedThroughDay, rule.LastCheckDay, rule.LastCheckAt, rule.LastCheckQuota, rule.LastCheckStatus = "", "", 0, 0, ""
			}
			if update.Enabled {
				rule.EnabledAt, rule.DisabledAt, rule.DisableReason = at.Unix(), 0, ""
			} else {
				rule.DisabledAt, rule.DisableReason = at.Unix(), "manual"
			}
			if err := tx.Save(&rule).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// DeleteUserGroupRatioRule retains the rule identity and accounting records so
// requests priced before deletion can still settle with their frozen snapshots.
func DeleteUserGroupRatioRule(actorID, userID int, group string, version int64, at time.Time) error {
	if group == "" || strings.TrimSpace(group) != group || utf8.RuneCountInString(group) > 64 || version <= 0 {
		return common.NewMessage("Invalid parameters")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := lockPersonalGroupRatioManagementUsers(tx, actorID, userID); err != nil {
			return err
		}
		var rule UserGroupRatio
		err := lockForUpdate(tx).Where("user_id = ? AND group_key = ?", userID, personalGroupRatioKey(group)).First(&rule).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrPersonalGroupVersionConflict
		}
		if err != nil {
			return err
		}
		if rule.Version != version || rule.DisableReason == "deleted" {
			return ErrPersonalGroupVersionConflict
		}
		rule.Enabled, rule.DisableReason, rule.DisabledAt = false, "deleted", at.Unix()
		rule.Version++
		rule.UpdatedTime = at.Unix()
		return tx.Save(&rule).Error
	})
}

// User locks serialize management actions and prevent role changes from racing
// the authorization decision. All actions acquire them in the same order.
func lockPersonalGroupRatioManagementUsers(tx *gorm.DB, actorID, userID int) error {
	ids := []int{actorID, userID}
	slices.Sort(ids)
	var users []User
	if err := lockForUpdate(tx).Select("id", "role", "status").Where("id IN ?", ids).Order("id").Find(&users).Error; err != nil {
		return err
	}
	var actor, target *User
	for i := range users {
		if users[i].Id == actorID {
			actor = &users[i]
		}
		if users[i].Id == userID {
			target = &users[i]
		}
	}
	if actor == nil || target == nil || actor.Status != common.UserStatusEnabled || actor.Role < common.RoleAdminUser || (actor.Role != common.RoleRootUser && actor.Role <= target.Role) {
		return common.NewMessage("No permission to update users of same or higher permission level")
	}
	return nil
}

func BeginPersonalGroupSpendIntent(key string, snapshot *PersonalGroupRatioSnapshot, quota int, at time.Time) error {
	return beginPersonalGroupSpend(key, snapshot, quota, at, "final")
}

func BeginPersonalGroupSpendGuard(key string, snapshot *PersonalGroupRatioSnapshot, at time.Time) error {
	return beginPersonalGroupSpend(key, snapshot, 0, at, "guard")
}

func beginPersonalGroupSpend(key string, snapshot *PersonalGroupRatioSnapshot, quota int, at time.Time, kind string) error {
	if snapshot == nil || snapshot.RuleID <= 0 || snapshot.UserID <= 0 || snapshot.Version <= 0 || key == "" || len(key) > 191 || quota < 0 || int64(quota) > common.MaxWalletQuota || math.IsNaN(snapshot.Ratio) || math.IsInf(snapshot.Ratio, 0) || snapshot.Ratio < 0 || snapshot.Ratio > 1000 {
		return ErrPersonalGroupIntentConflict
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var rule UserGroupRatio
		if err := lockForUpdate(tx).First(&rule, snapshot.RuleID).Error; err != nil {
			return err
		}
		if rule.UserID != snapshot.UserID || rule.Group != snapshot.Group || snapshot.Version > rule.Version {
			return ErrPersonalGroupIntentConflict
		}
		var existing UserGroupSpendIntent
		err := tx.Where("request_key = ?", key).First(&existing).Error
		if err == nil {
			if existing.RuleID != snapshot.RuleID || existing.Version != snapshot.Version || existing.Ratio != snapshot.Ratio || existing.Quota != int64(quota) || existing.Kind != kind || existing.Status == "canceled" {
				return ErrPersonalGroupIntentConflict
			}
			// The initial day stays immutable if an idempotent retry crosses midnight.
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if kind == "guard" {
			// First pricing freezes time as well as the multiplier: a request
			// accepted before expiry may reserve or retry after the end time.
			pricedDuringWindow := snapshot.PricedAt > 0 && rule.IsEffectiveAt(time.Unix(snapshot.PricedAt, 0))
			if snapshot.PricedAt == 0 {
				pricedDuringWindow = rule.StartsAt == 0 && rule.EndsAt == 0
			}
			if !rule.Enabled || rule.Version != snapshot.Version || rule.Ratio != snapshot.Ratio || !pricedDuringWindow {
				return ErrPersonalGroupPolicyChanged
			}
		}
		return tx.Create(&UserGroupSpendIntent{RequestKey: key, RuleID: snapshot.RuleID, Version: snapshot.Version, Ratio: snapshot.Ratio, Day: PersonalGroupRatioDay(at), Quota: int64(quota), Kind: kind, Status: "pending", CreatedTime: at.Unix()}).Error
	})
}

func CompletePersonalGroupSpendIntent(key string) error {
	return finishPersonalGroupSpend(key, "completed")
}
func CancelPersonalGroupSpendIntent(key string) error {
	return finishPersonalGroupSpend(key, "canceled")
}

func finishPersonalGroupSpend(key, status string) error {
	var record UserGroupSpendIntent
	if err := DB.Where("request_key = ?", key).First(&record).Error; err != nil {
		return err
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var rule UserGroupRatio
		if err := lockForUpdate(tx).First(&rule, record.RuleID).Error; err != nil {
			return err
		}
		if err := lockForUpdate(tx).First(&record, record.ID).Error; err != nil {
			return err
		}
		if record.Status == status {
			return nil
		}
		if record.Status != "pending" {
			return ErrPersonalGroupIntentConflict
		}
		if status == "completed" && record.Kind == "final" {
			var daily UserGroupSpendDaily
			err := tx.Where("rule_id = ? AND day = ?", record.RuleID, record.Day).First(&daily).Error
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			daily.RuleID, daily.Day = record.RuleID, record.Day
			// The total only needs to distinguish a met threshold; saturating here
			// keeps daily sums safe for both SQL integers and browser JSON numbers.
			if record.Quota > common.MaxWalletQuota-daily.Quota {
				daily.Quota = common.MaxWalletQuota
				common.SysError(common.LogText("Personal group daily quota saturated at the safe integer limit"))
			} else {
				daily.Quota += record.Quota
			}
			if err := tx.Save(&daily).Error; err != nil {
				return err
			}
		}
		return tx.Model(&record).Updates(map[string]any{"status": status, "completed_time": time.Now().Unix()}).Error
	})
}

// CheckPersonalGroupRatios assesses every missed complete Shanghai calendar day
// after 00:10. Row locks serialize independent masters and settlement writers.
func CheckPersonalGroupRatios(at time.Time) error {
	return CheckPersonalGroupRatiosWithContext(context.Background(), at)
}

func CheckPersonalGroupRatiosWithContext(ctx context.Context, at time.Time) error {
	local := at.In(personalGroupRatioLocation)
	cutoff := time.Date(local.Year(), local.Month(), local.Day(), 0, 10, 0, 0, personalGroupRatioLocation)
	lastDay := local.AddDate(0, 0, -1)
	if local.Before(cutoff) {
		lastDay = local.AddDate(0, 0, -2)
	}
	endDay := PersonalGroupRatioDay(lastDay)
	var ids []int
	listContext, cancelList := context.WithTimeout(ctx, 10*time.Second)
	err := DB.WithContext(listContext).Model(&UserGroupRatio{}).Where("enabled = ?", true).Order("id").Pluck("id", &ids).Error
	cancelList()
	if err != nil {
		return err
	}
	var failures []error
	for _, id := range ids {
		if err := ctx.Err(); err != nil {
			return errors.Join(append(failures, err)...)
		}
		// A locked or broken policy must not indefinitely delay other users.
		ruleContext, cancelRule := context.WithTimeout(ctx, 5*time.Second)
		err := DB.WithContext(ruleContext).Transaction(func(tx *gorm.DB) error {
			var rule UserGroupRatio
			if err := lockForUpdate(tx).First(&rule, id).Error; err != nil {
				return err
			}
			if !rule.Enabled || at.Unix() < rule.StartsAt {
				return nil
			}
			if err := reconcileCompletedPersonalGroupGuards(tx, &rule); err != nil {
				return err
			}
			if !rule.IsEffectiveAt(at) || rule.MinDailyQuota == 0 {
				return nil
			}
			activationDay := PersonalGroupRatioDay(time.Unix(max(rule.EnabledAt, rule.StartsAt), 0))
			start, err := time.ParseInLocation(time.DateOnly, activationDay, personalGroupRatioLocation)
			if err != nil {
				return err
			}
			if rule.CheckedThroughDay != "" {
				start, err = time.ParseInLocation(time.DateOnly, rule.CheckedThroughDay, personalGroupRatioLocation)
				if err != nil {
					return err
				}
				start = start.AddDate(0, 0, 1)
			}
			changed := false
			for day := start; PersonalGroupRatioDay(day) <= endDay; day = day.AddDate(0, 0, 1) {
				if err := ruleContext.Err(); err != nil {
					return err
				}
				date := PersonalGroupRatioDay(day)
				rule.LastCheckDay, rule.LastCheckAt, rule.LastCheckQuota = date, at.Unix(), 0
				changed = true
				if date == activationDay {
					rule.CheckedThroughDay, rule.LastCheckStatus = date, "grace"
					continue
				}
				var daily UserGroupSpendDaily
				err := tx.Where("rule_id = ? AND day = ?", rule.ID, date).First(&daily).Error
				if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
					return err
				}
				rule.LastCheckQuota = daily.Quota
				var pending int64
				if err := tx.Model(&UserGroupSpendIntent{}).Where("rule_id = ? AND status = ? AND day <= ?", rule.ID, "pending", date).Count(&pending).Error; err != nil {
					return err
				}
				if pending > 0 {
					rule.LastCheckStatus = "pending"
					break
				}
				rule.CheckedThroughDay = date
				if daily.Quota < rule.MinDailyQuota {
					rule.Enabled, rule.DisabledAt, rule.DisableReason, rule.LastCheckStatus = false, at.Unix(), "below_daily_minimum", "disabled"
					rule.Version++
					break
				}
				rule.LastCheckStatus = "passed"
			}
			if !changed {
				return nil
			}
			rule.UpdatedTime = at.Unix()
			return tx.Save(&rule).Error
		})
		cancelRule()
		if err != nil {
			failures = append(failures, fmt.Errorf("personal group ratio %d: %w", id, err))
		}
	}
	return errors.Join(failures...)
}

// A durable completed final intent proves that funding and daily accounting
// succeeded. Recover only its leftover guards, without replaying money movement.
// The caller holds this rule's lock; reading immutable completed finals needs no
// other rule locks, including when a request retried through a different group.
func reconcileCompletedPersonalGroupGuards(tx *gorm.DB, rule *UserGroupRatio) error {
	lastID := 0
	for {
		var guards []UserGroupSpendIntent
		if err := tx.Where("rule_id = ? AND status = ? AND kind = ? AND id > ?", rule.ID, "pending", "guard", lastID).
			Order("id").Limit(100).Find(&guards).Error; err != nil {
			return err
		}
		if len(guards) == 0 {
			return nil
		}
		lastID = guards[len(guards)-1].ID
		keys := make([]string, 0, len(guards))
		guardIDs := make(map[string][]int, len(guards))
		for _, guard := range guards {
			prefix, suffix, ok := strings.Cut(guard.RequestKey, ":guard:")
			if !ok || !strings.HasPrefix(prefix, "personal:") || prefix == "personal:" || suffix != fmt.Sprintf("%d:%d", guard.RuleID, guard.Version) {
				continue
			}
			key := prefix + ":final"
			keys = append(keys, key)
			guardIDs[key] = append(guardIDs[key], guard.ID)
		}
		if len(keys) == 0 {
			continue
		}
		var completed []string
		if err := tx.Model(&UserGroupSpendIntent{}).
			Joins("JOIN user_group_ratios ON user_group_ratios.id = user_group_spend_intents.rule_id").
			Where("user_group_ratios.user_id = ? AND user_group_spend_intents.request_key IN ? AND user_group_spend_intents.kind = ? AND user_group_spend_intents.status = ?", rule.UserID, keys, "final", "completed").
			Pluck("user_group_spend_intents.request_key", &completed).Error; err != nil {
			return err
		}
		for _, key := range completed {
			if err := tx.Model(&UserGroupSpendIntent{}).Where("id IN ? AND status = ?", guardIDs[key], "pending").
				Updates(map[string]any{"status": "canceled", "completed_time": time.Now().Unix()}).Error; err != nil {
				return err
			}
		}
	}
}

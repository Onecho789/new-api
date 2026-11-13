package model

import (
	"context"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// The previous personal-discount schema, before validity columns existed.
type personalGroupRatioBeforeValidity struct {
	ID                int
	UserID            int     `gorm:"not null;uniqueIndex:idx_user_group_ratio,priority:1"`
	Group             string  `gorm:"column:group_name;type:varchar(64);not null"`
	GroupKey          string  `gorm:"type:char(64);not null;uniqueIndex:idx_user_group_ratio,priority:2"`
	Ratio             float64 `gorm:"not null"`
	MinDailyQuota     int64   `gorm:"type:bigint;not null"`
	Enabled           bool    `gorm:"not null;index"`
	Version           int64   `gorm:"type:bigint;not null"`
	EnabledAt         int64   `gorm:"type:bigint;not null"`
	DisabledAt        int64   `gorm:"type:bigint;not null"`
	DisableReason     string  `gorm:"type:varchar(32);not null"`
	CheckedThroughDay string  `gorm:"type:varchar(10);not null"`
	LastCheckDay      string  `gorm:"type:varchar(10);not null"`
	LastCheckAt       int64   `gorm:"type:bigint;not null"`
	LastCheckQuota    int64   `gorm:"type:bigint;not null"`
	LastCheckStatus   string  `gorm:"type:varchar(16);not null"`
	CreatedTime       int64   `gorm:"type:bigint;not null"`
	UpdatedTime       int64   `gorm:"type:bigint;not null"`
}

func (personalGroupRatioBeforeValidity) TableName() string { return "user_group_ratios" }

func TestPersonalGroupRatiosDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(filepath.Join(t.TempDir(), "personal-ratio.db") + "?_pragma=busy_timeout(30000)&_txlock=immediate")
			case "mysql":
				dsn := os.Getenv("PERSONAL_RATIO_MYSQL_DSN")
				if dsn == "" {
					t.Skip("PERSONAL_RATIO_MYSQL_DSN is not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("PERSONAL_RATIO_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("PERSONAL_RATIO_POSTGRES_DSN is not configured")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(4)
			if dialect == "sqlite" {
				sqlDB.SetMaxOpenConns(1)
			}
			previousDB, previousType := DB, common.MainDatabaseType()
			DB = db
			common.SetMainDatabaseType(common.DatabaseType(dialect))
			initCol()
			previousGroups := ratio_setting.GetGroupRatioCopy()
			groups, err := common.Marshal(map[string]float64{"default": 1, "personal-test-b": 2, "CaseGroup": 1, "casegroup": 1})
			require.NoError(t, err)
			require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(string(groups)))
			t.Cleanup(func() {
				DB = previousDB
				common.SetMainDatabaseType(previousType)
				initCol()
				encoded, err := common.Marshal(previousGroups)
				assert.NoError(t, err)
				assert.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(string(encoded)))
				assert.NoError(t, sqlDB.Close())
			})
			var legacyRule personalGroupRatioBeforeValidity
			if os.Getenv("PERSONAL_RATIO_UPGRADE") == "1" {
				require.NoError(t, db.AutoMigrate(&User{}, &personalGroupRatioBeforeValidity{}, &UserGroupSpendIntent{}, &UserGroupSpendDaily{}))
				legacyUser := User{Username: "personal-upgrade", AffCode: "personal-upgrade", Role: common.RoleCommonUser, Status: common.UserStatusEnabled}
				require.NoError(t, db.Create(&legacyUser).Error)
				legacyRule = personalGroupRatioBeforeValidity{
					UserID: legacyUser.Id, Group: "default", GroupKey: personalGroupRatioKey("default"), Ratio: 0.35, MinDailyQuota: 100,
					Version: 7, EnabledAt: 1793577600, DisabledAt: 1793664000, DisableReason: "manual",
					CheckedThroughDay: "2026-11-02", LastCheckDay: "2026-11-02", LastCheckAt: 1793664600, LastCheckQuota: 30, LastCheckStatus: "passed",
					CreatedTime: 1793577600, UpdatedTime: 1793664000,
				}
				require.NoError(t, db.Create(&legacyRule).Error)
				require.NoError(t, db.Create(&UserGroupSpendDaily{RuleID: legacyRule.ID, Day: "2026-11-02", Quota: 30}).Error)
				require.NoError(t, db.Create(&UserGroupSpendIntent{RequestKey: "upgrade-completed", RuleID: legacyRule.ID, Version: 7, Day: "2026-11-02", Status: "completed", Kind: "final", Ratio: 0.35, Quota: 30}).Error)
			}
			for range 2 {
				require.NoError(t, db.AutoMigrate(&User{}, &UserGroupRatio{}, &UserGroupSpendIntent{}, &UserGroupSpendDaily{}))
			}
			if legacyRule.ID > 0 {
				var preserved personalGroupRatioBeforeValidity
				require.NoError(t, db.First(&preserved, legacyRule.ID).Error)
				assert.Equal(t, legacyRule, preserved, "both migrations preserve all previous fields")
				var upgraded UserGroupRatio
				require.NoError(t, db.First(&upgraded, legacyRule.ID).Error)
				assert.Zero(t, upgraded.StartsAt)
				assert.Zero(t, upgraded.EndsAt)
				views, err := GetPersonalGroupRatioRules(legacyRule.UserID, time.Unix(1793664600, 0))
				require.NoError(t, err)
				require.Len(t, views, 1)
				assert.True(t, views[0].DailyCheckEnabled)
				assert.True(t, db.Migrator().HasIndex(&UserGroupRatio{}, "idx_user_group_ratio"))
				duplicate := legacyRule
				duplicate.ID = 0
				assert.Error(t, db.Create(&duplicate).Error, "the original uniqueness constraint survives migration")
				oldSnapshot := &PersonalGroupRatioSnapshot{RuleID: legacyRule.ID, UserID: legacyRule.UserID, Group: legacyRule.Group, Version: 7, Ratio: 0.35}
				require.NoError(t, BeginPersonalGroupSpendIntent("upgrade-old-final", oldSnapshot, 20, time.Date(2026, 11, 2, 12, 0, 0, 0, personalGroupRatioLocation)))
				require.NoError(t, CompletePersonalGroupSpendIntent("upgrade-old-final"))
				require.NoError(t, CompletePersonalGroupSpendIntent("upgrade-old-final"))
				var daily UserGroupSpendDaily
				require.NoError(t, db.Where("rule_id = ? AND day = ?", legacyRule.ID, "2026-11-02").First(&daily).Error)
				assert.EqualValues(t, 50, daily.Quota, "migration retains history and old snapshots settle exactly once")
				t.Log("previous schema upgraded twice; data, old settlement, defaults and unique index verified")
			}
			var version string
			query := "SELECT version()"
			if dialect == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Logf("database version: %s", version)
			root := User{Username: "personal-root", AffCode: "personal-root", Role: common.RoleRootUser, Status: common.UserStatusEnabled}
			user := User{Username: "personal-user", AffCode: "personal-user", Role: common.RoleCommonUser, Status: common.UserStatusEnabled}
			admin := User{Username: "personal-admin", AffCode: "personal-admin", Role: common.RoleAdminUser, Status: common.UserStatusEnabled}
			require.NoError(t, db.Create(&root).Error)
			require.NoError(t, db.Create(&user).Error)
			require.NoError(t, db.Create(&admin).Error)
			at := func(day, hour, minute int) time.Time {
				return time.Date(2026, 11, day, hour, minute, 0, 0, personalGroupRatioLocation)
			}
			first := UserGroupRatioInput{Group: "default", Ratio: 0, MinDailyQuota: 100, Enabled: true}
			second := UserGroupRatioInput{Group: "personal-test-b", Ratio: 0.5, MinDailyQuota: 100, Enabled: true}
			require.NoError(t, UpdateUserGroupRatioRules(root.Id, user.Id, []UserGroupRatioInput{first, second}, at(10, 10, 0)))
			snapshot, err := ResolvePersonalGroupRatio(user.Id, "default", at(10, 10, 0))
			require.NoError(t, err)
			require.NotNil(t, snapshot)
			assert.Zero(t, snapshot.Ratio)
			assert.EqualValues(t, 1, snapshot.Version)
			missing, err := ResolvePersonalGroupRatio(admin.Id, "default", at(10, 10, 0))
			require.NoError(t, err)
			assert.Nil(t, missing)

			t.Run("exact_group_identity_with_default_database_collation", func(t *testing.T) {
				upper := UserGroupRatioInput{Group: "CaseGroup", Ratio: 0.4, MinDailyQuota: 100, Enabled: true}
				lower := UserGroupRatioInput{Group: "casegroup", Ratio: 0.7, MinDailyQuota: 100, Enabled: true}
				require.NoError(t, UpdateUserGroupRatioRules(root.Id, admin.Id, []UserGroupRatioInput{upper, lower}, at(10, 10, 0)))
				upperSnapshot, err := ResolvePersonalGroupRatio(admin.Id, upper.Group, at(10, 10, 0))
				require.NoError(t, err)
				lowerSnapshot, err := ResolvePersonalGroupRatio(admin.Id, lower.Group, at(10, 10, 0))
				require.NoError(t, err)
				require.NotNil(t, upperSnapshot)
				require.NotNil(t, lowerSnapshot)
				assert.NotEqual(t, upperSnapshot.RuleID, lowerSnapshot.RuleID)
				assert.Equal(t, 0.4, upperSnapshot.Ratio)
				assert.Equal(t, 0.7, lowerSnapshot.Ratio)
				assert.Error(t, db.Create(&UserGroupRatio{UserID: admin.Id, Group: "CaseGroup", Enabled: true}).Error, "exact duplicate must still be rejected")
			})

			t.Run("validation_and_role_boundaries", func(t *testing.T) {
				for _, ratio := range []float64{-1, 1000.1, math.NaN(), math.Inf(1)} {
					invalid := first
					invalid.Ratio = ratio
					assert.ErrorIs(t, UpdateUserGroupRatioRules(root.Id, user.Id, []UserGroupRatioInput{invalid}, at(10, 11, 0)), ErrPersonalGroupRatioInvalid)
				}
				for _, quota := range []int64{-1, 0, common.MaxWalletQuota + 1} {
					invalid := first
					invalid.MinDailyQuota = quota
					assert.ErrorIs(t, UpdateUserGroupRatioRules(root.Id, user.Id, []UserGroupRatioInput{invalid}, at(10, 11, 0)), ErrPersonalGroupMinimumInvalid)
				}
				invalid := first
				invalid.Group = "missing"
				assert.ErrorIs(t, UpdateUserGroupRatioRules(root.Id, user.Id, []UserGroupRatioInput{invalid}, at(10, 11, 0)), ErrPersonalGroupInvalid)
				assert.ErrorIs(t, UpdateUserGroupRatioRules(root.Id, user.Id, []UserGroupRatioInput{first, first}, at(10, 11, 0)), ErrPersonalGroupDuplicate)
				assert.Error(t, UpdateUserGroupRatioRules(admin.Id, root.Id, []UserGroupRatioInput{first}, at(10, 11, 0)))
				assert.Error(t, UpdateUserGroupRatioRules(user.Id, user.Id, []UserGroupRatioInput{first}, at(10, 11, 0)))
				require.NoError(t, UpdateUserGroupRatioRules(admin.Id, user.Id, []UserGroupRatioInput{first}, at(10, 11, 0)))
				unchanged, err := ResolvePersonalGroupRatio(user.Id, "default", at(10, 11, 0))
				require.NoError(t, err)
				assert.Equal(t, snapshot.RuleID, unchanged.RuleID)
				assert.Equal(t, snapshot.Version, unchanged.Version, "unchanged settings must not restart grace or bump version")
				assert.Equal(t, snapshot.Ratio, unchanged.Ratio)
				assert.Equal(t, at(10, 11, 0).Unix(), unchanged.PricedAt)
			})

			t.Run("shanghai_grace_cutoff_and_actual_group", func(t *testing.T) {
				assert.Equal(t, "2026-11-11", PersonalGroupRatioDay(time.Date(2026, 11, 10, 16, 0, 0, 0, time.UTC)))
				require.NoError(t, CheckPersonalGroupRatios(at(11, 0, 9)))
				rules, err := ListUserGroupRatios(user.Id)
				require.NoError(t, err)
				assert.Empty(t, rules[0].LastCheckDay)
				require.NoError(t, CheckPersonalGroupRatios(at(11, 0, 10)))
				rules, err = ListUserGroupRatios(user.Id)
				require.NoError(t, err)
				assert.True(t, rules[0].Enabled)
				assert.Equal(t, "grace", rules[0].LastCheckStatus)
				require.NoError(t, BeginPersonalGroupSpendIntent("first-final", snapshot, 100, at(11, 23, 59)))
				require.NoError(t, BeginPersonalGroupSpendIntent("first-final", snapshot, 100, at(12, 0, 1)))
				assert.ErrorIs(t, BeginPersonalGroupSpendIntent("first-final", snapshot, 101, at(11, 23, 59)), ErrPersonalGroupIntentConflict)
				// Two independent completion calls are serialized by the policy row lock.
				var wg sync.WaitGroup
				errors := make(chan error, 2)
				for range 2 {
					wg.Go(func() { errors <- CompletePersonalGroupSpendIntent("first-final") })
				}
				wg.Wait()
				close(errors)
				for err := range errors {
					require.NoError(t, err)
				}
				require.NoError(t, CheckPersonalGroupRatios(at(12, 0, 9)))
				rules, err = ListUserGroupRatios(user.Id)
				require.NoError(t, err)
				assert.True(t, rules[1].Enabled)
				require.NoError(t, CheckPersonalGroupRatios(at(12, 0, 10)))
				rules, err = ListUserGroupRatios(user.Id)
				require.NoError(t, err)
				assert.True(t, rules[0].Enabled)
				assert.EqualValues(t, 100, rules[0].LastCheckQuota)
				assert.Equal(t, "passed", rules[0].LastCheckStatus)
				assert.False(t, rules[1].Enabled, "another actual group's spend must not qualify this group")
				assert.Equal(t, "below_daily_minimum", rules[1].DisableReason)
				assert.Equal(t, second.Ratio, rules[1].Ratio)
				assert.Equal(t, second.MinDailyQuota, rules[1].MinDailyQuota)
			})

			t.Run("old_version_pending_and_settlement_day", func(t *testing.T) {
				require.NoError(t, BeginPersonalGroupSpendGuard("old-inflight-guard", snapshot, at(12, 1, 0)))
				updated := first
				updated.Ratio = 0.25
				require.NoError(t, UpdateUserGroupRatioRules(root.Id, user.Id, []UserGroupRatioInput{updated}, at(12, 9, 0)))
				current, err := ResolvePersonalGroupRatio(user.Id, "default", at(12, 9, 0))
				require.NoError(t, err)
				assert.Greater(t, current.Version, snapshot.Version)
				assert.Equal(t, 0.0, snapshot.Ratio, "existing request snapshot stays frozen")
				assert.ErrorIs(t, BeginPersonalGroupSpendGuard("late-stale-guard", snapshot, at(12, 10, 0)), ErrPersonalGroupPolicyChanged)
				require.NoError(t, CheckPersonalGroupRatios(at(14, 0, 10)))
				rules, err := ListUserGroupRatios(user.Id)
				require.NoError(t, err)
				assert.True(t, rules[0].Enabled)
				assert.Equal(t, "pending", rules[0].LastCheckStatus)
				// A previous-version task completes on Nov 13 and qualifies that day's current policy.
				require.NoError(t, BeginPersonalGroupSpendIntent("old-task-final", snapshot, 100, at(13, 23, 59)))
				require.NoError(t, CompletePersonalGroupSpendIntent("old-task-final"))
				require.NoError(t, CancelPersonalGroupSpendIntent("old-inflight-guard"))
				require.NoError(t, CancelPersonalGroupSpendIntent("old-inflight-guard"))
				views, err := GetPersonalGroupRatioRules(user.Id, at(13, 23, 59))
				require.NoError(t, err)
				assert.EqualValues(t, 100, views[0].TodayQuota)
				assert.Zero(t, views[0].TodayPending)
				require.NoError(t, CheckPersonalGroupRatios(at(14, 0, 10)))
				rules, err = ListUserGroupRatios(user.Id)
				require.NoError(t, err)
				assert.True(t, rules[0].Enabled)
				assert.Equal(t, "2026-11-13", rules[0].LastCheckDay)
				assert.Equal(t, "passed", rules[0].LastCheckStatus)
				assert.EqualValues(t, 100, rules[0].LastCheckQuota)
			})

			t.Run("ambiguous_funding_and_reenable", func(t *testing.T) {
				current, err := ResolvePersonalGroupRatio(user.Id, "default", at(14, 10, 0))
				require.NoError(t, err)
				require.NoError(t, BeginPersonalGroupSpendIntent("ambiguous-final", current, 20, at(14, 23, 59)))
				require.NoError(t, CheckPersonalGroupRatios(at(15, 0, 10)))
				views, err := GetPersonalGroupRatioRules(user.Id, at(15, 0, 10))
				require.NoError(t, err)
				assert.Equal(t, "pending_settlement", views[0].Status)
				assert.EqualValues(t, 1, views[0].TodayPending)
				require.NoError(t, CompletePersonalGroupSpendIntent("ambiguous-final"))
				require.NoError(t, CheckPersonalGroupRatios(at(15, 0, 10)))
				views, err = GetPersonalGroupRatioRules(user.Id, at(15, 0, 10))
				require.NoError(t, err)
				assert.Equal(t, "auto_disabled", views[0].Status)
				assert.EqualValues(t, 20, views[0].LastCheckQuota)
				assert.ErrorIs(t, CancelPersonalGroupSpendIntent("ambiguous-final"), ErrPersonalGroupIntentConflict)
				require.NoError(t, UpdateUserGroupRatioRules(root.Id, user.Id, []UserGroupRatioInput{first}, at(15, 12, 0)))
				views, err = GetPersonalGroupRatioRules(user.Id, at(15, 12, 0))
				require.NoError(t, err)
				assert.Equal(t, "grace_period", views[0].Status)
				assert.Empty(t, views[0].DisableReason)
				disabled := first
				disabled.Enabled = false
				require.NoError(t, UpdateUserGroupRatioRules(root.Id, user.Id, []UserGroupRatioInput{disabled}, at(15, 13, 0)))
				views, err = GetPersonalGroupRatioRules(user.Id, at(15, 13, 0))
				require.NoError(t, err)
				assert.Equal(t, "manually_disabled", views[0].Status)
				assert.Equal(t, "manual", views[0].DisableReason)
				missing, err := ResolvePersonalGroupRatio(user.Id, "default", at(15, 13, 0))
				require.NoError(t, err)
				assert.Nil(t, missing)
			})

			t.Run("funding_is_durable_with_batch_updates_enabled", func(t *testing.T) {
				previousBatch, previousRedis := common.BatchUpdateEnabled, common.RedisEnabled
				common.BatchUpdateEnabled, common.RedisEnabled = true, false
				t.Cleanup(func() { common.BatchUpdateEnabled, common.RedisEnabled = previousBatch, previousRedis })
				require.NoError(t, db.Model(&User{}).Where("id = ?", user.Id).Update("quota", 1000).Error)
				reserved, err := TryReserveUserQuotaSync(user.Id, 300)
				require.NoError(t, err)
				require.True(t, reserved)
				var stored User
				require.NoError(t, db.First(&stored, user.Id).Error)
				assert.Equal(t, 700, stored.Quota)
				require.NoError(t, DecreaseUserQuotaSync(user.Id, 50))
				require.NoError(t, db.First(&stored, user.Id).Error)
				assert.Equal(t, 650, stored.Quota)
				require.NoError(t, IncreaseUserQuota(user.Id, 350, true))
				require.NoError(t, db.First(&stored, user.Id).Error)
				assert.Equal(t, 1000, stored.Quota)
				reserved, err = TryReserveUserQuotaSync(user.Id, 1001)
				require.NoError(t, err)
				assert.False(t, reserved)
				require.NoError(t, db.First(&stored, user.Id).Error)
				assert.Equal(t, 1000, stored.Quota)
			})

			t.Run("recover_only_guards_with_confirmed_final_accounting", func(t *testing.T) {
				for _, tc := range []struct {
					name, finalStatus                string
					otherGroup, otherUser, recovered bool
					expired, noDailyCheck            bool
				}{
					{"completed", "completed", false, false, true, false, false},
					{"completed_retry_group", "completed", true, false, true, false, false},
					{"unconfirmed", "pending", false, false, false, false, false},
					{"canceled", "canceled", false, false, false, false, false},
					{"missing", "", false, false, false, false, false},
					{"different_user", "completed", false, true, false, false, false},
					{"expired", "completed", false, false, true, true, false},
					{"expired_pending", "pending", false, false, false, true, false},
					{"no_daily_check", "completed", false, false, true, false, true},
				} {
					t.Run(tc.name, func(t *testing.T) {
						owner := User{Username: "recovery-" + tc.name, AffCode: "recovery-" + tc.name, Role: common.RoleCommonUser, Status: common.UserStatusEnabled}
						require.NoError(t, db.Create(&owner).Error)
						input := UserGroupRatioInput{Group: "default", Ratio: 0.5, MinDailyQuota: 100, Enabled: true}
						if tc.expired {
							input.EndsAt = new(at(11, 23, 59).Unix())
						}
						if tc.noDailyCheck {
							input.DailyCheckEnabled = new(false)
						}
						require.NoError(t, UpdateUserGroupRatioRules(root.Id, owner.Id, []UserGroupRatioInput{input}, at(10, 10, 0)))
						guardSnapshot, err := ResolvePersonalGroupRatio(owner.Id, "default", at(11, 10, 0))
						require.NoError(t, err)
						guardKey := fmt.Sprintf("personal:%s:guard:%d:%d", tc.name, guardSnapshot.RuleID, guardSnapshot.Version)
						require.NoError(t, BeginPersonalGroupSpendGuard(guardKey, guardSnapshot, at(11, 10, 0)))
						finalSnapshot := guardSnapshot
						if tc.otherGroup || tc.otherUser {
							finalUser := owner.Id
							if tc.otherUser {
								finalUser = root.Id
							}
							input.Group = "personal-test-b"
							require.NoError(t, UpdateUserGroupRatioRules(root.Id, finalUser, []UserGroupRatioInput{input}, at(10, 10, 0)))
							finalSnapshot, err = ResolvePersonalGroupRatio(finalUser, input.Group, at(11, 10, 0))
							require.NoError(t, err)
						}
						finalKey := "personal:" + tc.name + ":final"
						if tc.finalStatus != "" {
							require.NoError(t, BeginPersonalGroupSpendIntent(finalKey, finalSnapshot, 100, at(11, 11, 0)))
							if tc.finalStatus == "completed" {
								require.NoError(t, CompletePersonalGroupSpendIntent(finalKey))
							} else if tc.finalStatus == "canceled" {
								require.NoError(t, CancelPersonalGroupSpendIntent(finalKey))
							}
						}
						for range 2 {
							require.NoError(t, CheckPersonalGroupRatios(at(12, 0, 10)))
						}
						var guard UserGroupSpendIntent
						require.NoError(t, db.Where("request_key = ?", guardKey).First(&guard).Error)
						var rule UserGroupRatio
						require.NoError(t, db.First(&rule, guardSnapshot.RuleID).Error)
						if tc.recovered {
							assert.Equal(t, "canceled", guard.Status)
							assert.Equal(t, !tc.otherGroup, rule.Enabled, "spend belongs to the final actual group")
						} else {
							assert.Equal(t, "pending", guard.Status)
							assert.True(t, rule.Enabled)
							if !tc.expired {
								assert.Equal(t, "pending", rule.LastCheckStatus)
							}
						}
						if tc.expired || tc.noDailyCheck {
							assert.Empty(t, rule.LastCheckStatus, "accounting reconciliation does not resume skipped daily assessment")
							assert.Equal(t, guardSnapshot.Version, rule.Version)
						}
						if tc.finalStatus == "completed" {
							var daily UserGroupSpendDaily
							require.NoError(t, db.Where("rule_id = ? AND day = ?", finalSnapshot.RuleID, "2026-11-11").First(&daily).Error)
							assert.EqualValues(t, 100, daily.Quota, "recovery never counts final spending twice")
						}
					})
				}
			})

			t.Run("one_rule_error_does_not_block_other_users", func(t *testing.T) {
				broken := UserGroupRatio{UserID: root.Id, Group: "CaseGroup", Enabled: true, Version: 1, MinDailyQuota: 100, EnabledAt: at(10, 10, 0).Unix()}
				healthy := UserGroupRatio{UserID: root.Id, Group: "casegroup", Enabled: true, Version: 1, MinDailyQuota: 100, EnabledAt: at(10, 10, 0).Unix()}
				require.NoError(t, db.Create(&broken).Error)
				require.NoError(t, db.Create(&healthy).Error)
				injected := errors.New("one policy read failed")
				require.NoError(t, db.Callback().Query().After("gorm:query").Register("personal-ratio:isolated-error", func(tx *gorm.DB) {
					if record, ok := tx.Statement.Dest.(*UserGroupRatio); ok && record.ID == broken.ID {
						_ = tx.AddError(injected)
					}
				}))
				err := CheckPersonalGroupRatios(at(12, 0, 10))
				require.NoError(t, db.Callback().Query().Remove("personal-ratio:isolated-error"))
				require.ErrorIs(t, err, injected)
				require.NoError(t, db.First(&broken, broken.ID).Error)
				require.NoError(t, db.First(&healthy, healthy.ID).Error)
				assert.True(t, broken.Enabled, "database errors must not revoke discounts")
				assert.False(t, healthy.Enabled, "later rules must still be assessed")
				require.NoError(t, CheckPersonalGroupRatios(at(12, 0, 10)))
				require.NoError(t, db.First(&broken, broken.ID).Error)
				assert.False(t, broken.Enabled, "next sweep retries the failed rule")
			})

			t.Run("cancellation_releases_database_waits", func(t *testing.T) {
				ctx, cancel := context.WithCancel(context.Background())
				cancel()
				assert.ErrorIs(t, CheckPersonalGroupRatiosWithContext(ctx, at(12, 0, 10)), context.Canceled)
				// SQLite has no FOR UPDATE. Its connection-pool wait and the real
				// row-lock wait on server databases must both honor cancellation.
				var locked UserGroupRatio
				require.NoError(t, db.Where("enabled = ?", true).Order("id").First(&locked).Error)
				tx := db.Begin()
				require.NoError(t, tx.Error)
				require.NoError(t, lockForUpdate(tx).First(&locked, locked.ID).Error)
				ctx, cancel = context.WithTimeout(context.Background(), 200*time.Millisecond)
				err := CheckPersonalGroupRatiosWithContext(ctx, at(12, 0, 10))
				cancel()
				require.NoError(t, tx.Rollback().Error)
				require.ErrorIs(t, err, context.DeadlineExceeded)
				require.NoError(t, CheckPersonalGroupRatios(at(12, 0, 10)), "worker remains usable after cancellation")
			})

			t.Run("deletion_preserves_accounting_and_recreation_versions", func(t *testing.T) {
				target := User{Username: "personal-delete", AffCode: "personal-delete", Role: common.RoleCommonUser, Status: common.UserStatusEnabled}
				require.NoError(t, db.Create(&target).Error)
				zero := int64(0)
				input := UserGroupRatioInput{Group: "default", Ratio: 0.4, MinDailyQuota: 100, Enabled: true, Version: &zero}
				other := UserGroupRatioInput{Group: "personal-test-b", Ratio: 0.6, MinDailyQuota: 100, Enabled: true, Version: &zero}
				require.NoError(t, UpdateUserGroupRatioRules(root.Id, target.Id, []UserGroupRatioInput{input, other}, at(20, 10, 0)))
				original, err := ResolvePersonalGroupRatio(target.Id, input.Group, at(20, 10, 0))
				require.NoError(t, err)
				require.NotNil(t, original)
				otherOriginal, err := ResolvePersonalGroupRatio(target.Id, other.Group, at(20, 10, 0))
				require.NoError(t, err)
				require.NotNil(t, otherOriginal)
				require.NoError(t, BeginPersonalGroupSpendIntent("delete-completed", original, 25, at(20, 11, 0)))
				require.NoError(t, CompletePersonalGroupSpendIntent("delete-completed"))
				require.NoError(t, BeginPersonalGroupSpendIntent("delete-pending", original, 30, at(20, 11, 0)))
				require.NoError(t, BeginPersonalGroupSpendGuard("delete-guard", original, at(20, 11, 0)))
				// Representative saved assessment state must not leak into a new grant.
				require.NoError(t, db.Model(&UserGroupRatio{}).Where("id = ?", original.RuleID).Updates(map[string]any{
					"checked_through_day": "2026-11-19", "last_check_day": "2026-11-19", "last_check_at": at(20, 0, 10).Unix(),
					"last_check_quota": 100, "last_check_status": "met",
				}).Error)
				require.NoError(t, DeleteUserGroupRatioRule(admin.Id, target.Id, input.Group, original.Version, at(20, 12, 0)))
				var deleted UserGroupRatio
				require.NoError(t, db.First(&deleted, original.RuleID).Error)
				assert.False(t, deleted.Enabled)
				assert.Equal(t, "deleted", deleted.DisableReason)
				assert.Equal(t, original.Version+1, deleted.Version)
				assert.Equal(t, at(20, 12, 0).Unix(), deleted.DisabledAt)
				resolved, err := ResolvePersonalGroupRatio(target.Id, input.Group, at(20, 12, 0))
				require.NoError(t, err)
				assert.Nil(t, resolved)
				rules, err := ListUserGroupRatios(target.Id)
				require.NoError(t, err)
				require.Len(t, rules, 1)
				assert.Equal(t, otherOriginal.RuleID, rules[0].ID)
				views, err := GetPersonalGroupRatioRules(target.Id, at(20, 12, 0))
				require.NoError(t, err)
				require.Len(t, views, 1)
				assert.Equal(t, otherOriginal.RuleID, views[0].ID)
				for _, actorID := range []int{root.Id, admin.Id} {
					listed, err := ListManagedUserGroupRatios(context.Background(), actorID, UserGroupRatioListOptions{Page: 1, PageSize: 20, UserID: target.Id}, at(20, 12, 0))
					require.NoError(t, err)
					assert.EqualValues(t, 1, listed.Total)
					require.Len(t, listed.Items, 1)
					assert.Equal(t, otherOriginal.RuleID, listed.Items[0].ID)
					for _, status := range []string{"", "manually_disabled"} {
						listed, err = ListManagedUserGroupRatios(context.Background(), actorID, UserGroupRatioListOptions{Page: 1, PageSize: 20, UserID: target.Id, Group: input.Group, Status: status}, at(20, 12, 0))
						require.NoError(t, err)
						assert.Zero(t, listed.Total)
						assert.Empty(t, listed.Items)
					}
				}
				var daily UserGroupSpendDaily
				require.NoError(t, db.Where("rule_id = ? AND day = ?", original.RuleID, "2026-11-20").First(&daily).Error)
				assert.EqualValues(t, 25, daily.Quota)
				var pendingCount int64
				require.NoError(t, db.Model(&UserGroupSpendIntent{}).Where("rule_id = ? AND status = ?", original.RuleID, "pending").Count(&pendingCount).Error)
				assert.EqualValues(t, 2, pendingCount, "deletion must retain pending final intents and guards")
				for _, version := range []*int64{nil, &original.Version, &deleted.Version} {
					stale := input
					stale.Version = version
					assert.ErrorIs(t, UpdateUserGroupRatioRules(root.Id, target.Id, []UserGroupRatioInput{stale}, at(20, 12, 0)), ErrPersonalGroupVersionConflict)
				}
				assert.ErrorIs(t, DeleteUserGroupRatioRule(root.Id, target.Id, input.Group, original.Version, at(20, 12, 0)), ErrPersonalGroupVersionConflict)
				assert.ErrorIs(t, DeleteUserGroupRatioRule(root.Id, target.Id, input.Group, deleted.Version, at(20, 12, 0)), ErrPersonalGroupVersionConflict)
				assert.ErrorIs(t, BeginPersonalGroupSpendGuard("delete-late-guard", original, at(20, 12, 0)), ErrPersonalGroupPolicyChanged)
				require.NoError(t, CompletePersonalGroupSpendIntent("delete-pending"))
				require.NoError(t, CompletePersonalGroupSpendIntent("delete-pending"))
				require.NoError(t, BeginPersonalGroupSpendIntent("delete-late-final", original, 20, at(20, 12, 0)))
				require.NoError(t, CompletePersonalGroupSpendIntent("delete-late-final"))
				// Recreate while disabled with identical values: this is not a no-op.
				input.Enabled = false
				require.NoError(t, UpdateUserGroupRatioRules(root.Id, target.Id, []UserGroupRatioInput{input}, at(20, 13, 0)))
				var recreated UserGroupRatio
				require.NoError(t, db.First(&recreated, original.RuleID).Error)
				assert.Equal(t, deleted.Version+1, recreated.Version)
				assert.Equal(t, "manual", recreated.DisableReason)
				assert.Zero(t, recreated.EnabledAt)
				assert.Empty(t, recreated.CheckedThroughDay)
				assert.Empty(t, recreated.LastCheckDay)
				assert.Empty(t, recreated.LastCheckStatus)
				assert.Zero(t, recreated.LastCheckAt)
				assert.Zero(t, recreated.LastCheckQuota)
				assert.Equal(t, deleted.CreatedTime, recreated.CreatedTime)
				input.Enabled, input.Ratio, input.Version = true, 0.7, &recreated.Version
				require.NoError(t, UpdateUserGroupRatioRules(root.Id, target.Id, []UserGroupRatioInput{input}, at(20, 14, 0)))
				current, err := ResolvePersonalGroupRatio(target.Id, input.Group, at(20, 14, 0))
				require.NoError(t, err)
				require.NotNil(t, current)
				assert.Equal(t, original.RuleID, current.RuleID)
				assert.Equal(t, recreated.Version+1, current.Version)
				assert.Equal(t, 0.7, current.Ratio)
				assert.Equal(t, 0.4, original.Ratio)
				assert.ErrorIs(t, DeleteUserGroupRatioRule(root.Id, target.Id, input.Group, original.Version, at(20, 14, 0)), ErrPersonalGroupVersionConflict)
				stale := input
				stale.Version = &original.Version
				assert.ErrorIs(t, UpdateUserGroupRatioRules(root.Id, target.Id, []UserGroupRatioInput{stale}, at(20, 14, 0)), ErrPersonalGroupVersionConflict)
				assert.ErrorIs(t, BeginPersonalGroupSpendGuard("recreated-old-guard", original, at(20, 14, 0)), ErrPersonalGroupPolicyChanged)
				require.NoError(t, BeginPersonalGroupSpendGuard("recreated-new-guard", current, at(20, 14, 0)))
				require.NoError(t, BeginPersonalGroupSpendIntent("recreated-old-final", original, 15, at(20, 14, 0)))
				require.NoError(t, CompletePersonalGroupSpendIntent("recreated-old-final"))
				require.NoError(t, CompletePersonalGroupSpendIntent("recreated-old-final"))
				require.NoError(t, CancelPersonalGroupSpendIntent("delete-guard"))
				require.NoError(t, CancelPersonalGroupSpendIntent("recreated-new-guard"))
				require.NoError(t, db.First(&daily, daily.ID).Error)
				assert.EqualValues(t, 90, daily.Quota, "old snapshots settle once across deletion and recreation")
				otherCurrent, err := ResolvePersonalGroupRatio(target.Id, other.Group, at(20, 14, 0))
				require.NoError(t, err)
				assert.Equal(t, otherOriginal.RuleID, otherCurrent.RuleID)
				assert.Equal(t, otherOriginal.Version, otherCurrent.Version)
				assert.Equal(t, otherOriginal.Ratio, otherCurrent.Ratio)
			})

			t.Run("deletion_rechecks_permissions_and_allows_removed_groups", func(t *testing.T) {
				owner := User{Username: "personal-delete-owner", AffCode: "personal-delete-owner", Role: common.RoleCommonUser, Status: common.UserStatusEnabled}
				blockedAdmin := User{Username: "personal-delete-admin", AffCode: "personal-delete-admin", Role: common.RoleAdminUser, Status: common.UserStatusDisabled}
				require.NoError(t, db.Create(&owner).Error)
				require.NoError(t, db.Create(&blockedAdmin).Error)
				rule := UserGroupRatio{UserID: owner.Id, Group: "removed-global-group", Ratio: 0.2, MinDailyQuota: 100, Enabled: true, Version: 3}
				require.NoError(t, db.Create(&rule).Error)
				assert.False(t, ratio_setting.ContainsGroupRatio(rule.Group))
				for _, actorID := range []int{owner.Id, blockedAdmin.Id, 0} {
					assert.Error(t, DeleteUserGroupRatioRule(actorID, owner.Id, rule.Group, rule.Version, at(20, 12, 0)))
				}
				for _, version := range []int64{0, -1} {
					assert.Error(t, DeleteUserGroupRatioRule(root.Id, owner.Id, rule.Group, version, at(20, 12, 0)))
				}
				assert.ErrorIs(t, DeleteUserGroupRatioRule(root.Id, user.Id, rule.Group, rule.Version, at(20, 12, 0)), ErrPersonalGroupVersionConflict)
				assert.ErrorIs(t, DeleteUserGroupRatioRule(root.Id, owner.Id, "missing-rule", rule.Version, at(20, 12, 0)), ErrPersonalGroupVersionConflict)
				require.NoError(t, db.Model(&owner).Update("role", common.RoleAdminUser).Error)
				assert.Error(t, DeleteUserGroupRatioRule(admin.Id, owner.Id, rule.Group, rule.Version, at(20, 12, 0)), "target promotion must be rechecked inside the transaction")
				require.NoError(t, db.Model(&owner).Update("role", common.RoleRootUser).Error)
				assert.Error(t, DeleteUserGroupRatioRule(admin.Id, owner.Id, rule.Group, rule.Version, at(20, 12, 0)))
				var unchanged UserGroupRatio
				require.NoError(t, db.First(&unchanged, rule.ID).Error)
				assert.True(t, unchanged.Enabled)
				assert.Equal(t, rule.Version, unchanged.Version)
				require.NoError(t, DeleteUserGroupRatioRule(root.Id, owner.Id, rule.Group, rule.Version, at(20, 12, 0)))
				rules, err := ListUserGroupRatios(owner.Id)
				require.NoError(t, err)
				assert.Empty(t, rules)
			})

			t.Run("validity_boundaries_and_frozen_pricing", func(t *testing.T) {
				target := User{Username: "personal-validity", AffCode: "personal-validity", Role: common.RoleCommonUser, Status: common.UserStatusEnabled}
				require.NoError(t, db.Create(&target).Error)
				zero, starts, ends := int64(0), at(25, 12, 0).Unix(), at(25, 14, 0).Unix()
				dailyCheck := false
				input := UserGroupRatioInput{Group: "default", Ratio: 0.2, MinDailyQuota: 100, Enabled: true, Version: &zero, DailyCheckEnabled: &dailyCheck, StartsAt: &starts, EndsAt: &ends}
				require.NoError(t, UpdateUserGroupRatioRules(root.Id, target.Id, []UserGroupRatioInput{input}, at(24, 12, 0)))
				for _, tc := range []struct {
					at     int64
					status string
					active bool
				}{
					{starts - 1, "scheduled", false}, {starts, "active", true}, {ends - 1, "active", true}, {ends, "expired", false},
				} {
					priced, err := ResolvePersonalGroupRatio(target.Id, input.Group, time.Unix(tc.at, 0))
					require.NoError(t, err)
					if tc.active {
						require.NotNil(t, priced)
						assert.Equal(t, tc.at, priced.PricedAt)
						assert.Equal(t, 0.2, priced.Ratio)
					} else {
						assert.Nil(t, priced, "boundaries apply without a worker run")
					}
					views, err := GetPersonalGroupRatioRules(target.Id, time.Unix(tc.at, 0))
					require.NoError(t, err)
					require.Len(t, views, 1)
					assert.Equal(t, tc.active, views[0].IsEffectiveAt(time.Unix(tc.at, 0)))
					assert.Equal(t, tc.status, views[0].Status)
					assert.False(t, views[0].DailyCheckEnabled)
					assert.Zero(t, views[0].MinDailyQuota)
					for _, status := range []string{"scheduled", "active", "expired", "grace_period", "pending_settlement"} {
						listed, err := ListManagedUserGroupRatios(context.Background(), root.Id, UserGroupRatioListOptions{Page: 1, PageSize: 20, UserID: target.Id, Status: status}, time.Unix(tc.at, 0))
						require.NoError(t, err)
						if status == tc.status {
							assert.EqualValues(t, 1, listed.Total)
							require.Len(t, listed.Items, 1)
							assert.Equal(t, tc.status, listed.Items[0].Status)
							assert.False(t, listed.Items[0].DailyCheckEnabled)
						} else {
							assert.Zero(t, listed.Total)
							assert.Empty(t, listed.Items)
						}
					}
				}
				frozen, err := ResolvePersonalGroupRatio(target.Id, input.Group, time.Unix(ends-1, 0))
				require.NoError(t, err)
				require.NotNil(t, frozen)
				require.NoError(t, BeginPersonalGroupSpendGuard("timed-before-end", frozen, time.Unix(ends+1, 0)), "first pricing before expiry permits delayed reservation")
				require.NoError(t, BeginPersonalGroupSpendGuard("timed-before-end", frozen, time.Unix(ends+2, 0)))
				for _, pricedAt := range []int64{0, starts - 1, ends, ends + 1} {
					invalid := *frozen
					invalid.PricedAt = pricedAt
					assert.ErrorIs(t, BeginPersonalGroupSpendGuard(fmt.Sprintf("timed-invalid-%d", pricedAt), &invalid, time.Unix(ends+2, 0)), ErrPersonalGroupPolicyChanged)
				}
				require.NoError(t, CheckPersonalGroupRatios(time.Unix(ends+1, 0)))
				var expired UserGroupRatio
				require.NoError(t, db.First(&expired, frozen.RuleID).Error)
				assert.True(t, expired.Enabled, "expiry is dynamic and preserves the frozen version")
				assert.Equal(t, frozen.Version, expired.Version)
				assert.Empty(t, expired.LastCheckDay)
				require.NoError(t, BeginPersonalGroupSpendIntent("timed-after-end-final", frozen, 20, time.Unix(ends+2, 0)))
				require.NoError(t, CompletePersonalGroupSpendIntent("timed-after-end-final"))
				require.NoError(t, CompletePersonalGroupSpendIntent("timed-after-end-final"))
				var daily UserGroupSpendDaily
				require.NoError(t, db.Where("rule_id = ?", frozen.RuleID).First(&daily).Error)
				assert.EqualValues(t, 20, daily.Quota)
				assert.ErrorIs(t, UpdateUserGroupRatioRules(root.Id, target.Id, []UserGroupRatioInput{input}, time.Unix(ends+3, 0)), ErrPersonalGroupAlreadyExists)
				input.Enabled, input.Version, input.StartsAt, input.EndsAt = false, &expired.Version, nil, nil
				require.NoError(t, UpdateUserGroupRatioRules(root.Id, target.Id, []UserGroupRatioInput{input}, time.Unix(ends+3, 0)))
				input.Version = &zero
				assert.ErrorIs(t, UpdateUserGroupRatioRules(root.Id, target.Id, []UserGroupRatioInput{input}, time.Unix(ends+3, 0)), ErrPersonalGroupAlreadyExists)
				require.NoError(t, db.First(&expired, frozen.RuleID).Error)
				assert.Equal(t, starts, expired.StartsAt, "omitted boundaries preserve an existing expired window")
				assert.Equal(t, ends, expired.EndsAt)
				require.NoError(t, DeleteUserGroupRatioRule(root.Id, target.Id, input.Group, expired.Version, time.Unix(ends+4, 0)))
				input.Enabled = true
				require.NoError(t, UpdateUserGroupRatioRules(root.Id, target.Id, []UserGroupRatioInput{input}, time.Unix(ends+5, 0)))
				var recreated UserGroupRatio
				require.NoError(t, db.First(&recreated, frozen.RuleID).Error)
				assert.Equal(t, expired.Version+2, recreated.Version)
				assert.Zero(t, recreated.StartsAt, "a deleted rule is recreated with new-grant defaults")
				assert.Zero(t, recreated.EndsAt)
			})

			t.Run("future_start_and_optional_daily_assessment", func(t *testing.T) {
				target := User{Username: "personal-daily", AffCode: "personal-daily", Role: common.RoleCommonUser, Status: common.UserStatusEnabled}
				require.NoError(t, db.Create(&target).Error)
				starts, ends := at(22, 10, 0).Unix(), at(25, 10, 0).Unix()
				input := UserGroupRatioInput{Group: "default", Ratio: 0.3, MinDailyQuota: 100, Enabled: true, StartsAt: &starts, EndsAt: &ends}
				require.NoError(t, UpdateUserGroupRatioRules(root.Id, target.Id, []UserGroupRatioInput{input}, at(20, 12, 0)))
				require.NoError(t, CheckPersonalGroupRatios(at(21, 0, 10)))
				rules, err := GetPersonalGroupRatioRules(target.Id, at(21, 0, 10))
				require.NoError(t, err)
				require.Len(t, rules, 1)
				assert.Equal(t, "scheduled", rules[0].Status)
				assert.Empty(t, rules[0].LastCheckDay)
				rules, err = GetPersonalGroupRatioRules(target.Id, at(22, 10, 0))
				require.NoError(t, err)
				assert.Equal(t, "grace_period", rules[0].Status)
				require.NoError(t, CheckPersonalGroupRatios(at(23, 0, 10)))
				rules, err = GetPersonalGroupRatioRules(target.Id, at(23, 0, 10))
				require.NoError(t, err)
				assert.True(t, rules[0].Enabled)
				assert.Equal(t, "2026-11-22", rules[0].CheckedThroughDay)
				assert.Equal(t, "grace", rules[0].LastCheckStatus)
				frozen, err := ResolvePersonalGroupRatio(target.Id, input.Group, at(23, 12, 0))
				require.NoError(t, err)
				require.NotNil(t, frozen)
				require.NoError(t, BeginPersonalGroupSpendIntent("timed-daily-pending", frozen, 100, at(23, 12, 0)))
				require.NoError(t, CheckPersonalGroupRatios(at(24, 0, 10)))
				rules, err = GetPersonalGroupRatioRules(target.Id, at(24, 0, 10))
				require.NoError(t, err)
				assert.Equal(t, "pending_settlement", rules[0].Status)
				require.NoError(t, CheckPersonalGroupRatios(at(25, 10, 0)))
				rules, err = GetPersonalGroupRatioRules(target.Id, at(25, 10, 0))
				require.NoError(t, err)
				assert.Equal(t, "expired", rules[0].Status, "pending spending cannot extend validity")
				assert.Equal(t, frozen.Version, rules[0].Version)
				assert.EqualValues(t, 1, rules[0].TodayPending)
				require.NoError(t, CompletePersonalGroupSpendIntent("timed-daily-pending"))
				// Reconfigure the same rule as an unlimited grant without daily checks.
				zero, disabled := int64(0), false
				input.StartsAt, input.EndsAt, input.DailyCheckEnabled, input.Version = &zero, &zero, &disabled, &rules[0].Version
				require.NoError(t, UpdateUserGroupRatioRules(root.Id, target.Id, []UserGroupRatioInput{input}, at(25, 11, 0)))
				require.NoError(t, CheckPersonalGroupRatios(at(29, 0, 10)))
				rules, err = GetPersonalGroupRatioRules(target.Id, at(29, 0, 10))
				require.NoError(t, err)
				assert.True(t, rules[0].Enabled)
				assert.Equal(t, "active", rules[0].Status)
				assert.False(t, rules[0].DailyCheckEnabled)
				assert.Zero(t, rules[0].MinDailyQuota)
				assert.Empty(t, rules[0].CheckedThroughDay)
				assert.Empty(t, rules[0].LastCheckStatus)
				legacy := &PersonalGroupRatioSnapshot{RuleID: rules[0].ID, UserID: target.Id, Group: input.Group, Version: rules[0].Version, Ratio: input.Ratio}
				require.NoError(t, BeginPersonalGroupSpendGuard("timeless-legacy-guard", legacy, at(29, 12, 0)))
			})

			t.Run("duration_validation_and_unique_creation", func(t *testing.T) {
				target := User{Username: "personal-duration", AffCode: "personal-duration", Role: common.RoleCommonUser, Status: common.UserStatusEnabled}
				require.NoError(t, db.Create(&target).Error)
				zero, duration, disabled := int64(0), int64(7200), false
				input := UserGroupRatioInput{Group: "default", Ratio: 0.25, Enabled: true, Version: &zero, DailyCheckEnabled: &disabled, DurationSeconds: &duration}
				for _, invalid := range []UserGroupRatioInput{
					{Group: "default", Ratio: 0.25, Enabled: true, DailyCheckEnabled: &disabled, StartsAt: new(int64(-1))},
					{Group: "default", Ratio: 0.25, Enabled: true, DailyCheckEnabled: &disabled, EndsAt: new(int64(ratio_setting.MaxGroupRatioTimestamp + 1))},
					{Group: "default", Ratio: 0.25, Enabled: true, DailyCheckEnabled: &disabled, StartsAt: new(at(25, 12, 0).Unix()), EndsAt: new(at(25, 12, 0).Unix())},
					{Group: "default", Ratio: 0.25, Enabled: true, DailyCheckEnabled: &disabled, EndsAt: new(at(24, 12, 0).Unix())},
					{Group: "default", Ratio: 0.25, Enabled: true, DailyCheckEnabled: &disabled, DurationSeconds: new(int64(3600))},
					{Group: "default", Ratio: 0.25, Enabled: false, DailyCheckEnabled: &disabled, DurationSeconds: &duration},
					{Group: "default", Ratio: 0.25, Enabled: true, DailyCheckEnabled: &disabled, DurationSeconds: &duration, StartsAt: &zero},
					{Group: "default", Ratio: 0.25, Enabled: true, DailyCheckEnabled: &disabled, DurationSeconds: &duration, EndsAt: &zero},
				} {
					assert.ErrorIs(t, UpdateUserGroupRatioRules(root.Id, target.Id, []UserGroupRatioInput{invalid}, at(25, 12, 0)), ErrPersonalGroupValidityInvalid)
				}
				for _, minimum := range []int64{-1, common.MaxWalletQuota + 1} {
					invalid := input
					invalid.MinDailyQuota = minimum
					assert.ErrorIs(t, UpdateUserGroupRatioRules(root.Id, target.Id, []UserGroupRatioInput{invalid}, at(25, 12, 0)), ErrPersonalGroupMinimumInvalid)
				}
				invalid := input
				invalid.DailyCheckEnabled = new(true)
				assert.ErrorIs(t, UpdateUserGroupRatioRules(root.Id, target.Id, []UserGroupRatioInput{invalid}, at(25, 12, 0)), ErrPersonalGroupMinimumInvalid)
				var results [2]error
				var wait sync.WaitGroup
				for i := range results {
					wait.Go(func() {
						results[i] = UpdateUserGroupRatioRules(root.Id, target.Id, []UserGroupRatioInput{input}, at(25, 12, 0))
					})
				}
				wait.Wait()
				if results[0] != nil {
					results[0], results[1] = results[1], results[0]
				}
				require.NoError(t, results[0])
				assert.ErrorIs(t, results[1], ErrPersonalGroupAlreadyExists, "concurrent creates cannot overwrite the existing grant")
				rules, err := GetPersonalGroupRatioRules(target.Id, at(25, 12, 0))
				require.NoError(t, err)
				require.Len(t, rules, 1)
				assert.Equal(t, at(25, 12, 0).Unix(), rules[0].StartsAt)
				assert.Equal(t, at(25, 14, 0).Unix(), rules[0].EndsAt)
				assert.EqualValues(t, 1, rules[0].Version)
				assert.False(t, rules[0].DailyCheckEnabled)
			})

			t.Run("database_errors_do_not_fall_back_or_revoke", func(t *testing.T) {
				require.NoError(t, db.Callback().Query().Before("gorm:query").Register("personal-ratio:test-error", func(tx *gorm.DB) {
					if tx.Statement.Table == "user_group_ratios" {
						_ = tx.AddError(errors.New("test storage unavailable"))
					}
				}))
				t.Cleanup(func() { assert.NoError(t, db.Callback().Query().Remove("personal-ratio:test-error")) })
				_, err := ResolvePersonalGroupRatio(user.Id, "default", at(15, 13, 0))
				assert.Error(t, err)
				assert.Error(t, CheckPersonalGroupRatios(at(16, 0, 10)))
			})
		})
	}
}

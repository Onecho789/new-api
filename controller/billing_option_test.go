package controller

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestUpdateOptionRejectsInvalidTaskBillingExpressions(t *testing.T) {
	const pluginKey = "billing-save-probe"
	const modelName = "billing-save-model"
	source := `
export const meta = {
  apiVersion: 1, key: "billing-save-probe", name: "Billing Save Probe", version: "1.0.0", author: {name: "Test"},
  models: ["billing-save-model"], fetchMode: "per_task",
  usageSchema: {seconds: {type: "number", unit: "second"}}
};
export function buildSubmitRequest() { return {}; }
export function parseSubmitResponse() { return {}; }
export function buildQueryRequest() { return {}; }
export function parseTaskResult() { return {}; }
`
	_, err := jsplugin.DefaultRegistry.Register(source, jsplugin.Options{})
	require.NoError(t, err)
	t.Cleanup(func() { jsplugin.DefaultRegistry.Unregister(pluginKey) })

	tests := []struct {
		name       string
		expression string
		errorText  string
	}{
		{
			name:       "invalid syntax",
			expression: `tier("base",`,
			errorText:  "expr compile error",
		},
		{
			name:       "undeclared usage key",
			expression: `tier("base", u("clips") * 0.1)`,
			errorText:  `usage key \"clips\" is not declared`,
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			expressions, marshalErr := common.Marshal(map[string]string{modelName: testCase.expression})
			require.NoError(t, marshalErr)
			body, marshalErr := common.Marshal(OptionUpdateRequest{
				Key:   "billing_setting.billing_expr",
				Value: string(expressions),
			})
			require.NoError(t, marshalErr)
			recorder := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(recorder)
			context.Request = httptest.NewRequest(http.MethodPut, "/api/option/", strings.NewReader(string(body)))

			UpdateOption(context)

			assert.Equal(t, http.StatusOK, recorder.Code)
			assert.Contains(t, recorder.Body.String(), `"success":false`)
			assert.Contains(t, recorder.Body.String(), modelName)
			assert.Contains(t, recorder.Body.String(), testCase.errorText)
		})
	}
}

func TestUpdateOptionRejectsUsageExpressionWithoutTaskPlugin(t *testing.T) {
	const modelName = "billing-save-model-without-plugin"
	expressions, err := common.Marshal(map[string]string{
		modelName: `u("mode") == "std" ? 1 : 2`,
	})
	require.NoError(t, err)
	body, err := common.Marshal(OptionUpdateRequest{
		Key:   "billing_setting.billing_expr",
		Value: string(expressions),
	})
	require.NoError(t, err)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(
		http.MethodPut,
		"/api/option/",
		strings.NewReader(string(body)),
	)

	UpdateOption(context)

	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, recorder.Body.String(), `"success":false`)
	assert.Contains(t, recorder.Body.String(), modelName)
	assert.Contains(t, recorder.Body.String(), "mode")
	assert.Contains(t, recorder.Body.String(), "no task plugin usage schema")
}

func TestUpdateOptionAliasBillingExprUsesPluginSchema(t *testing.T) {
	database := modelManagementDB(t, "sqlite", "")
	require.NoError(t, database.AutoMigrate(&model.Log{}))
	const pluginKey = "billing-alias-probe"
	source := `
export const meta = {
  apiVersion: 1, key: "billing-alias-probe", name: "Billing Alias Probe", version: "1.0.0", author: {name: "Test"},
  models: ["declared-model"], fetchMode: "per_task",
  usageSchema: {seconds: {type: "number", unit: "second"}, image_count: {type: "number", unit: "count"}},
  usageProfiles: [{models: ["declared-model"], schema: {seconds: {type: "number", unit: "second"}}}]
};
export function buildSubmitRequest() { return {}; }
export function parseSubmitResponse() { return {}; }
export function buildQueryRequest() { return {}; }
export function parseTaskResult() { return {}; }
`
	_, err := jsplugin.DefaultRegistry.Register(source, jsplugin.Options{})
	require.NoError(t, err)
	t.Cleanup(func() { jsplugin.DefaultRegistry.Unregister(pluginKey) })

	mapping := `{"alias-model":"declared-model"}`
	require.NoError(t, model.DB.Create(&model.Channel{
		Id:           1,
		Type:         54,
		Key:          "key-1",
		Status:       common.ChannelStatusEnabled,
		Name:         "ch-1",
		Group:        "default",
		Models:       "alias-model,declared-model",
		ModelMapping: &mapping,
	}).Error)
	model.InitChannelCache()

	saved := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error {
		saved[key] = value
		return nil
	}))
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(saved))
	})

	putExpr := func(modelName, expression string) *httptest.ResponseRecorder {
		t.Helper()
		expressions, marshalErr := common.Marshal(map[string]string{modelName: expression})
		require.NoError(t, marshalErr)
		body, marshalErr := common.Marshal(OptionUpdateRequest{
			Key:   "billing_setting.billing_expr",
			Value: string(expressions),
		})
		require.NoError(t, marshalErr)
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest(http.MethodPut, "/api/option/", strings.NewReader(string(body)))
		UpdateOption(context)
		return recorder
	}

	accepted := putExpr("alias-model", `u("seconds")`)
	assert.Equal(t, http.StatusOK, accepted.Code)
	assert.Contains(t, accepted.Body.String(), `"success":true`)

	rejectedKey := putExpr("alias-model", `u("image_count")`)
	assert.Equal(t, http.StatusOK, rejectedKey.Code)
	assert.Contains(t, rejectedKey.Body.String(), `"success":false`)
	assert.Contains(t, rejectedKey.Body.String(), `usage key \"image_count\" is not declared`)

	rejectedDeclared := putExpr("declared-model", `u("image_count")`)
	assert.Contains(t, rejectedDeclared.Body.String(), `"success":false`)
	assert.Contains(t, rejectedDeclared.Body.String(), `usage key \"image_count\" is not declared`)

	unresolvable := putExpr("unknown-alias-model", `u("seconds")`)
	assert.Equal(t, http.StatusOK, unresolvable.Code)
	assert.Contains(t, unresolvable.Body.String(), `"success":false`)
	assert.Contains(t, unresolvable.Body.String(), "no task plugin usage schema")
}

// Covers configuration persistence, validation, reservation and reconciliation
// through the same public entry points used by the relay.
func TestPreConsumePolicyDatabaseMatrix(t *testing.T) {
	previousConfig := config.GlobalConfig.ExportAllConfigs()
	previousUnit, previousBatch := common.QuotaPerUnit, common.BatchUpdateEnabled
	common.QuotaPerUnit, common.BatchUpdateEnabled = 500000, false
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(previousConfig))
		common.QuotaPerUnit, common.BatchUpdateEnabled = previousUnit, previousBatch
	})
	for _, dialect := range []struct{ kind, env string }{{"sqlite", ""}, {"mysql", "TEST_MYSQL_DSN"}, {"postgres", "TEST_POSTGRES_DSN"}} {
		t.Run(dialect.kind, func(t *testing.T) {
			if dialect.env != "" && os.Getenv(dialect.env) == "" {
				t.Skip("set " + dialect.env + " to run this database")
			}
			db := modelManagementDB(t, dialect.kind, os.Getenv(dialect.env))
			require.NoError(t, db.AutoMigrate(&model.Token{}, &model.UserGroupRatio{}))
			for key, value := range map[string]string{
				"quota_setting.trust_quota_usd":        "10.5",
				"quota_setting.pre_consume_multiplier": "1.5",
			} {
				var response struct{ Success bool }
				modelManagementRequest(t, UpdateOption, http.MethodPut, "/api/option/", OptionUpdateRequest{Key: key, Value: value}, &response)
				require.True(t, response.Success)
				var saved model.Option
				require.NoError(t, db.Where(&model.Option{Key: key}).First(&saved).Error)
				assert.Equal(t, value, saved.Value)
			}
			var savedOptions []model.Option
			require.NoError(t, db.Find(&savedOptions).Error)
			stored := map[string]string{}
			for _, option := range savedOptions {
				stored[option.Key] = option.Value
			}
			for range 2 {
				operation_setting.GetQuotaSetting().TrustQuotaUSD = 10
				operation_setting.GetQuotaSetting().PreConsumeMultiplier = 1
				require.NoError(t, config.GlobalConfig.LoadFromDB(stored))
				assert.Equal(t, 10.5, operation_setting.GetQuotaSetting().TrustQuotaUSD)
				assert.Equal(t, 1.5, operation_setting.GetQuotaSetting().PreConsumeMultiplier)
			}
			for _, tc := range []struct{ key, value string }{
				{"trust_quota_usd", "-1"}, {"trust_quota_usd", "NaN"}, {"trust_quota_usd", "+Inf"},
				{"pre_consume_multiplier", "0"}, {"pre_consume_multiplier", "-0.5"},
				{"pre_consume_multiplier", "NaN"}, {"pre_consume_multiplier", "Inf"},
				{"pre_consume_multiplier", "1e309"}, {"pre_consume_multiplier", ""},
			} {
				key := "quota_setting." + tc.key
				var response struct{ Success bool }
				modelManagementRequest(t, UpdateOption, http.MethodPut, "/api/option/", OptionUpdateRequest{Key: key, Value: tc.value}, &response)
				assert.False(t, response.Success, "%s=%q", key, tc.value)
				var saved model.Option
				require.NoError(t, db.Where(&model.Option{Key: key}).First(&saved).Error)
				assert.Equal(t, stored[key], saved.Value, "invalid saves must preserve the previous value")
			}
			require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
				"billing_setting.billing_mode":    `{"policy-model":"tiered_expr"}`,
				"billing_setting.billing_expr":    `{"policy-model":"tier(\"base\", p * 3 + c * 15)"}`,
				"group_ratio_setting.group_ratio": `{"default":1}`,
			}))
			cases := []struct {
				name                  string
				threshold, multiplier float64
				wallet, token         int
				force, unlimited      bool
				wantHeld              int
			}{
				{"above threshold", 10, 1, 5500000, 5500000, false, false, 0},
				{"custom threshold", 20, 1, 5500000, 5500000, false, false, 1500},
				{"zero disables bypass", 0, 1, 5500000, 5500000, false, false, 1500},
				{"wallet equals threshold", 10, 1, 5000000, 5500000, false, false, 1500},
				{"token equals threshold", 10, 1, 5500000, 5000000, false, false, 1500},
				{"fractional threshold", 10.5, 1, 5250001, 5250001, false, false, 0},
				{"unlimited token", 10, 1, 5500000, 0, false, true, 0},
				{"forced reservation", 10, 1, 5500000, 5500000, true, false, 1500},
				{"half input cost", 0, 0.5, 100000, 100000, false, false, 750},
				{"fractional multiple refunds excess", 0, 2.5, 100000, 100000, false, false, 3750},
			}
			for i, tc := range cases {
				t.Run(tc.name, func(t *testing.T) {
					require.NoError(t, model.UpdateOption("quota_setting.trust_quota_usd", strconv.FormatFloat(tc.threshold, 'f', -1, 64)))
					require.NoError(t, model.UpdateOption("quota_setting.pre_consume_multiplier", strconv.FormatFloat(tc.multiplier, 'f', -1, 64)))
					user := model.User{Username: fmt.Sprintf("policy-user-%d", i), Quota: tc.wallet, Group: "default", AffCode: fmt.Sprintf("policy-aff-%d", i)}
					require.NoError(t, db.Create(&user).Error)
					token := model.Token{UserId: user.Id, Key: fmt.Sprintf("policy-token-%d", i), RemainQuota: tc.token, UnlimitedQuota: tc.unlimited}
					require.NoError(t, db.Create(&token).Error)
					ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
					ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
					ctx.Set("token_quota", tc.token)
					info := &relaycommon.RelayInfo{UserId: user.Id, TokenId: token.Id, TokenKey: token.Key, TokenUnlimited: tc.unlimited, ForcePreConsume: tc.force, OriginModelName: "policy-model", UserGroup: "default", UsingGroup: "default", BillingRequestInput: &billingexpr.RequestInput{}}
					info.UserSetting.BillingPreference = "wallet_only"
					price, err := helper.ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{MaxTokens: 10000})
					require.NoError(t, err)
					require.Nil(t, service.PreConsumeBilling(ctx, price.QuotaToPreConsume, info))
					assert.Equal(t, tc.wantHeld, info.FinalPreConsumedQuota)
					require.NoError(t, db.First(&user, user.Id).Error)
					assert.Equal(t, tc.wallet-tc.wantHeld, user.Quota)
					if !tc.unlimited {
						require.NoError(t, db.First(&token, token.Id).Error)
						assert.Equal(t, tc.token-tc.wantHeld, token.RemainQuota)
					}
					_, actual, _ := service.TryTieredSettle(info, billingexpr.TokenParams{P: 1000, C: 100, Len: 1000})
					assert.Equal(t, 2250, actual)
					require.NoError(t, info.Billing.Settle(actual))
					require.NoError(t, info.Billing.Settle(actual))
					require.NoError(t, db.First(&user, user.Id).Error)
					assert.Equal(t, tc.wallet-actual, user.Quota)
					if !tc.unlimited {
						require.NoError(t, db.First(&token, token.Id).Error)
						assert.Equal(t, tc.token-actual, token.RemainQuota)
					}
				})
			}
		})
	}
}

func TestPreConsumeMultiplierRejectsInvalidRuntimeAndOverflow(t *testing.T) {
	previous := config.GlobalConfig.ExportAllConfigs()
	t.Cleanup(func() { require.NoError(t, config.GlobalConfig.LoadFromDB(previous)) })
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.billing_mode":    `{"policy-overflow":"tiered_expr"}`,
		"billing_setting.billing_expr":    `{"policy-overflow":"tier(\"base\", p * 3)"}`,
		"group_ratio_setting.group_ratio": `{"default":1}`,
	}))
	for _, multiplier := range []float64{0, -0.5, math.NaN(), math.Inf(1), math.MaxFloat64} {
		operation_setting.GetQuotaSetting().PreConsumeMultiplier = multiplier
		ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
		ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
		info := &relaycommon.RelayInfo{OriginModelName: "policy-overflow", UserGroup: "default", UsingGroup: "default", BillingRequestInput: &billingexpr.RequestInput{}}
		_, err := helper.ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{})
		require.Error(t, err)
		assert.Nil(t, info.Billing)
	}
}

// Exercise the actual pricing, reservation, usage settlement, daily assessment,
// and next-request billing together; balances, token quota and logs must agree.
func TestPersonalGroupRatioBillingLifecycleDatabaseMatrix(t *testing.T) {
	previousConfig := config.GlobalConfig.ExportAllConfigs()
	previousUnit, previousBatch, previousLogs := common.QuotaPerUnit, common.BatchUpdateEnabled, common.LogConsumeEnabled
	common.QuotaPerUnit, common.BatchUpdateEnabled, common.LogConsumeEnabled = 500000, false, true
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(previousConfig))
		common.QuotaPerUnit, common.BatchUpdateEnabled, common.LogConsumeEnabled = previousUnit, previousBatch, previousLogs
	})
	for _, dialect := range []struct{ kind, env string }{{"sqlite", ""}, {"mysql", "TEST_MYSQL_DSN"}, {"postgres", "TEST_POSTGRES_DSN"}} {
		t.Run(dialect.kind, func(t *testing.T) {
			if dialect.env != "" && os.Getenv(dialect.env) == "" {
				t.Skip("set " + dialect.env + " to run this database")
			}
			db := modelManagementDB(t, dialect.kind, os.Getenv(dialect.env))
			require.NoError(t, db.AutoMigrate(&model.Token{}, &model.Log{}, &model.UserGroupRatio{}, &model.UserGroupSpendIntent{}, &model.UserGroupSpendDaily{}))
			require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
				"billing_setting.billing_mode":          `{"personal-expr":"tiered_expr","personal-fixed":"tiered_expr"}`,
				"billing_setting.billing_expr":          `{"personal-expr":"tier(\"base\", p * 2 + c * 20)","personal-fixed":"tier(\"request\", fixed(0.004))"}`,
				"group_ratio_setting.group_ratio":       `{"default":1,"personal-paid":1.5,"personal-special":1.5}`,
				"group_ratio_setting.group_group_ratio": `{"default":{"personal-special":0.75}}`,
				"quota_setting.pre_consume_multiplier":  "1",
			}))
			require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"personal-legacy":1}`))
			require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(`{"personal-legacy":10}`))
			root := model.User{Username: "lifecycle-root", AffCode: "lifecycle-root", Role: common.RoleRootUser, Status: common.UserStatusEnabled}
			require.NoError(t, db.Create(&root).Error)
			location := time.FixedZone(model.PersonalGroupRatioTimezone, 8*60*60)
			now := time.Now().In(location)
			today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, location)
			checkAt := today.AddDate(0, 0, 1).Add(10 * time.Minute)
			for _, pricing := range []string{"personal-legacy", "personal-expr", "personal-fixed"} {
				for _, tc := range []struct {
					name, group string
					minimum     int64
					keep        bool
					nextRatio   float64
					nextCharge  int
				}{
					{"below_normal", "personal-paid", 1001, false, 1.5, 3000},
					{"below_special", "personal-special", 1001, false, 0.75, 1500},
					{"exact_minimum", "personal-paid", 1000, true, 0.5, 1000},
					{"above_minimum", "personal-paid", 999, true, 0.5, 1000},
				} {
					t.Run(pricing+"/"+tc.name, func(t *testing.T) {
						identity := pricing + "-" + tc.name
						user := model.User{Username: identity, AffCode: identity, Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", Quota: 100000}
						require.NoError(t, db.Create(&user).Error)
						token := model.Token{UserId: user.Id, Key: identity, RemainQuota: 100000}
						require.NoError(t, db.Create(&token).Error)
						input := model.UserGroupRatioInput{Group: tc.group, Ratio: 0.5, MinDailyQuota: tc.minimum, Enabled: true}
						require.NoError(t, model.UpdateUserGroupRatioRules(root.Id, user.Id, []model.UserGroupRatioInput{input}, today.AddDate(0, 0, -1)))
						chargeRequest := func(wantRatio float64, wantCharge int) {
							t.Helper()
							walletBefore, tokenBefore := user.Quota, token.RemainQuota
							ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
							ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
							ctx.Set("token_quota", token.RemainQuota)
							requestID := common.NewRequestId()
							ctx.Set(common.RequestIdKey, requestID)
							info := &relaycommon.RelayInfo{UserId: user.Id, TokenId: token.Id, TokenKey: token.Key, ForcePreConsume: true, OriginModelName: pricing, UserGroup: "default", UsingGroup: tc.group, BillingRequestInput: &billingexpr.RequestInput{}, StartTime: time.Now(), ChannelMeta: &relaycommon.ChannelMeta{}}
							info.UserSetting.BillingPreference = "wallet_only"
							price, err := helper.ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{})
							require.NoError(t, err)
							assert.Equal(t, wantRatio, price.GroupRatioInfo.GroupRatio)
							require.Nil(t, service.PreConsumeBilling(ctx, price.QuotaToPreConsume, info))
							service.PostTextConsumeQuota(ctx, info, &dto.Usage{PromptTokens: 1000, CompletionTokens: 100, TotalTokens: 1100}, nil)
							require.NoError(t, db.First(&user, user.Id).Error)
							require.NoError(t, db.First(&token, token.Id).Error)
							assert.Equal(t, walletBefore-wantCharge, user.Quota)
							assert.Equal(t, tokenBefore-wantCharge, token.RemainQuota)
							var log model.Log
							require.NoError(t, db.Where("request_id = ?", requestID).First(&log).Error)
							assert.Equal(t, wantCharge, log.Quota)
							require.NoError(t, info.Billing.Settle(wantCharge))
							require.NoError(t, db.First(&user, user.Id).Error)
							require.NoError(t, db.First(&token, token.Id).Error)
							assert.Equal(t, walletBefore-wantCharge, user.Quota, "settlement retry must not charge twice")
							assert.Equal(t, tokenBefore-wantCharge, token.RemainQuota)
						}
						chargeRequest(0.5, 1000)
						for range 2 {
							require.NoError(t, model.CheckPersonalGroupRatios(checkAt))
						}
						views, err := model.GetPersonalGroupRatioRules(user.Id, checkAt)
						require.NoError(t, err)
						require.Len(t, views, 1)
						assert.Equal(t, tc.keep, views[0].Enabled)
						assert.EqualValues(t, 1000, views[0].LastCheckQuota)
						assert.Zero(t, views[0].TodayPending)
						chargeRequest(tc.nextRatio, tc.nextCharge)
						input.Ratio = 0.25
						require.NoError(t, model.UpdateUserGroupRatioRules(root.Id, user.Id, []model.UserGroupRatioInput{input}, time.Now()))
						chargeRequest(0.25, 500)
						var daily model.UserGroupSpendDaily
						require.NoError(t, db.Where("rule_id = ? AND day = ?", views[0].ID, model.PersonalGroupRatioDay(now)).First(&daily).Error)
						wantDaily := int64(1500)
						if tc.keep {
							wantDaily += int64(tc.nextCharge)
						}
						assert.Equal(t, wantDaily, daily.Quota, "only net discounted charges qualify")
					})
				}
			}
		})
	}
}

func TestGroupSpecialRatioScheduleDatabaseMatrix(t *testing.T) {
	previous := ratio_setting.GroupGroupRatio2JSONString()
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(previous)) })
	const legacyKey = ratio_setting.GroupGroupRatioOptionKey
	const namespacedKey = ratio_setting.GroupGroupRatioConfigKey
	const scheduled = `{"member":{"legacy":0.8,"free":0,"timed":{"ratio":0.4,"enabled":true,"starts_at":2000,"ends_at":3000},"disabled":{"ratio":0.1,"enabled":false,"starts_at":0,"ends_at":0},"after":{"ratio":0.3,"enabled":true,"starts_at":2000,"ends_at":0},"before":{"ratio":0.2,"enabled":true,"starts_at":0,"ends_at":3000}}}`
	for _, dialect := range []struct{ kind, env string }{{"sqlite", ""}, {"mysql", "TEST_MYSQL_DSN"}, {"postgres", "TEST_POSTGRES_DSN"}} {
		t.Run(dialect.kind, func(t *testing.T) {
			if dialect.env != "" && os.Getenv(dialect.env) == "" {
				t.Skip("set " + dialect.env + " to run this database")
			}
			db := modelManagementDB(t, dialect.kind, os.Getenv(dialect.env))
			require.NoError(t, db.AutoMigrate(&model.Task{}))
			require.NoError(t, db.Create(&model.Option{Key: legacyKey, Value: `{"member":{"legacy":0.8,"free":0}}`}).Error)
			for range 2 {
				model.InitOptionMap()
				assert.JSONEq(t, `{"member":{"legacy":0.8,"free":0}}`, ratio_setting.GroupGroupRatio2JSONString())
			}
			var untouched int64
			require.NoError(t, db.Model(&model.Option{}).Where(&model.Option{Key: namespacedKey}).Count(&untouched).Error)
			assert.Zero(t, untouched, "loading a legacy option must not migrate or rewrite it")

			for _, key := range []string{legacyKey, namespacedKey} {
				t.Run(key, func(t *testing.T) {
					var response struct{ Success bool }
					modelManagementRequest(t, UpdateOption, http.MethodPut, "/api/option/", OptionUpdateRequest{Key: key, Value: scheduled}, &response)
					require.True(t, response.Success)
					var stored []model.Option
					require.NoError(t, db.Where(map[string]any{"key": []string{legacyKey, namespacedKey}}).Find(&stored).Error)
					require.Len(t, stored, 2)
					for _, option := range stored {
						assert.Equal(t, scheduled, option.Value)
					}
					for range 2 {
						model.InitOptionMap()
						assert.JSONEq(t, scheduled, ratio_setting.GroupGroupRatio2JSONString())
						assert.Equal(t, scheduled, common.OptionMap[legacyKey])
						assert.Equal(t, scheduled, common.OptionMap[namespacedKey])
					}
				})
			}

			for _, tc := range []struct {
				name, group string
				second      int64
				ratio       float64
				active      bool
			}{
				{"before start", "timed", 1999, -1, false},
				{"at start", "timed", 2000, 0.4, true},
				{"before end", "timed", 2999, 0.4, true},
				{"at end", "timed", 3000, -1, false},
				{"disabled", "disabled", 2500, -1, false},
				{"no start bound", "before", 1, 0.2, true},
				{"no end bound", "after", ratio_setting.MaxGroupRatioTimestamp, 0.3, true},
				{"legacy timeless", "legacy", ratio_setting.MaxGroupRatioTimestamp, 0.8, true},
				{"legacy zero", "free", 2500, 0, true},
				{"exact group identity", "TIMED", 2500, -1, false},
			} {
				t.Run(tc.name, func(t *testing.T) {
					ratio, active := ratio_setting.GetGroupGroupRatioAt("member", tc.group, time.Unix(tc.second, 0))
					assert.Equal(t, tc.active, active)
					assert.Equal(t, tc.ratio, ratio)
				})
			}
			frozen := ratio_setting.GetGroupGroupRatiosAt("member", time.Unix(2500, 0))
			assert.Equal(t, map[string]float64{"legacy": 0.8, "free": 0, "timed": 0.4, "after": 0.3, "before": 0.2}, frozen)
			frozen["timed"] = 9
			ratio, active := ratio_setting.GetGroupGroupRatioAt("member", "timed", time.Unix(2500, 0))
			assert.True(t, active)
			assert.Equal(t, 0.4, ratio, "mutating a request snapshot must not change configuration")

			for _, tc := range []struct{ name, value string }{
				{"null root", `null`}, {"array root", `[]`}, {"null group", `{"member":null}`},
				{"null rule", `{"member":{"timed":null}}`}, {"string rule", `{"member":{"timed":"0.5"}}`},
				{"negative ratio", `{"member":{"timed":-0.1}}`}, {"overflow ratio", `{"member":{"timed":1e309}}`},
				{"unsafe ratio", `{"member":{"timed":9007199254740992}}`},
				{"missing field", `{"member":{"timed":{"ratio":0.5,"starts_at":0,"ends_at":0}}}`},
				{"unknown field", `{"member":{"timed":{"ratio":0.5,"enabled":true,"starts_at":0,"ends_at":0,"extra":1}}}`},
				{"null enabled", `{"member":{"timed":{"ratio":0.5,"enabled":null,"starts_at":0,"ends_at":0}}}`},
				{"fractional time", `{"member":{"timed":{"ratio":0.5,"enabled":true,"starts_at":1.5,"ends_at":0}}}`},
				{"negative time", `{"member":{"timed":{"ratio":0.5,"enabled":true,"starts_at":-1,"ends_at":0}}}`},
				{"out of range time", `{"member":{"timed":{"ratio":0.5,"enabled":true,"starts_at":0,"ends_at":253402300800}}}`},
				{"empty interval", `{"member":{"timed":{"ratio":0.5,"enabled":true,"starts_at":2000,"ends_at":2000}}}`},
				{"reverse interval", `{"member":{"timed":{"ratio":0.5,"enabled":true,"starts_at":2000,"ends_at":1999}}}`},
				{"partial valid map", `{"member":{"valid":0.2,"broken":false}}`},
			} {
				t.Run(tc.name, func(t *testing.T) {
					for _, key := range []string{legacyKey, namespacedKey} {
						var response struct{ Success bool }
						modelManagementRequest(t, UpdateOption, http.MethodPut, "/api/option/", OptionUpdateRequest{Key: key, Value: tc.value}, &response)
						assert.False(t, response.Success)
						var option model.Option
						require.NoError(t, db.Where(&model.Option{Key: key}).First(&option).Error)
						assert.Equal(t, scheduled, option.Value)
						assert.Equal(t, scheduled, common.OptionMap[key])
					}
					require.Error(t, ratio_setting.UpdateGroupGroupRatioByJSONString(tc.value))
					// ConfigManager intentionally tolerates malformed unrelated settings;
					// this custom field must still retain its last valid snapshot.
					_ = config.GlobalConfig.LoadFromDB(map[string]string{namespacedKey: tc.value})
					assert.JSONEq(t, scheduled, ratio_setting.GroupGroupRatio2JSONString())
				})
			}

			t.Run("transaction failure retains both aliases and cache", func(t *testing.T) {
				const callback = "test:group-special-ratio-save-failure"
				require.NoError(t, db.Callback().Update().Before("gorm:update").Register(callback, func(tx *gorm.DB) {
					if option, ok := tx.Statement.Dest.(*model.Option); ok && option.Key == namespacedKey {
						tx.AddError(errors.New("injected special multiplier persistence failure"))
					}
				}))
				t.Cleanup(func() { require.NoError(t, db.Callback().Update().Remove(callback)) })
				require.Error(t, model.UpdateOption(legacyKey, `{"member":{"timed":0.9}}`))
				for _, key := range []string{legacyKey, namespacedKey} {
					var stored model.Option
					require.NoError(t, db.Where(&model.Option{Key: key}).First(&stored).Error)
					assert.Equal(t, scheduled, stored.Value)
					assert.Equal(t, scheduled, common.OptionMap[key])
				}
				assert.JSONEq(t, scheduled, ratio_setting.GroupGroupRatio2JSONString())
			})
			require.Error(t, model.UpdateOptionsBulk(map[string]string{legacyKey: `{}`, namespacedKey: scheduled}))
			assert.JSONEq(t, scheduled, ratio_setting.GroupGroupRatio2JSONString())

			t.Run("concurrent saves keep persistence and published settings consistent", func(t *testing.T) {
				const first = `{"member":{"timed":0.7}}`
				const second = `{"member":{"timed":{"ratio":0,"enabled":false,"starts_at":0,"ends_at":0}}}`
				entered, release, secondStarted := make(chan struct{}), make(chan struct{}), make(chan struct{})
				var enterOnce, releaseOnce sync.Once
				t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })
				const callback = "test:group-special-ratio-concurrent-save"
				require.NoError(t, db.Callback().Update().Before("gorm:update").Register(callback, func(tx *gorm.DB) {
					if option, ok := tx.Statement.Dest.(*model.Option); ok && option.Key == legacyKey && option.Value == first {
						enterOnce.Do(func() { close(entered) })
						<-release
					}
				}))
				t.Cleanup(func() { require.NoError(t, db.Callback().Update().Remove(callback)) })
				results := make(chan error, 2)
				go func() { results <- model.UpdateOption(legacyKey, first) }()
				select {
				case <-entered:
				case <-time.After(10 * time.Second):
					t.Fatal("first save did not reach the persistence barrier")
				}
				go func() {
					close(secondStarted)
					results <- model.UpdateOption(namespacedKey, second)
				}()
				<-secondStarted
				releaseOnce.Do(func() { close(release) })
				for range 2 {
					require.NoError(t, <-results)
				}
				for range 2 {
					model.InitOptionMap()
					assert.JSONEq(t, second, ratio_setting.GroupGroupRatio2JSONString())
					for _, key := range []string{legacyKey, namespacedKey} {
						var stored model.Option
						require.NoError(t, db.Where(&model.Option{Key: key}).First(&stored).Error)
						assert.Equal(t, second, stored.Value)
						assert.Equal(t, second, common.OptionMap[key])
					}
					_, active := ratio_setting.GetGroupGroupRatioAt("member", "timed", time.Unix(2500, 0))
					assert.False(t, active, "reloading either alias must not revive the earlier enabled rule")
				}
			})

			for i, ratio := range []float64{0, 0.4} {
				task := model.Task{TaskID: fmt.Sprintf("scheduled-ratio-%d", i), UserId: 1,
					PrivateData: model.TaskPrivateData{BillingContext: &model.TaskBillingContext{
						GroupRatio: ratio, GroupRatioCaptured: true, ModelRatio: 1, OriginModelName: "scheduled-ratio-probe",
					}}}
				require.NoError(t, db.Create(&task).Error)
				var loaded model.Task
				require.NoError(t, db.First(&loaded, task.ID).Error)
				require.NotNil(t, loaded.PrivateData.BillingContext)
				assert.True(t, loaded.PrivateData.BillingContext.GroupRatioCaptured)
				assert.Equal(t, ratio, loaded.PrivateData.BillingContext.GroupRatio)
			}
		})
	}
}

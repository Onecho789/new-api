package controller

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResponseModelMismatchSettingControlsHistoricalLogResponses(t *testing.T) {
	database, _ := newAuditTestDatabase(t, "sqlite", "")
	require.NoError(t, database.AutoMigrate(&model.Log{}, &model.Option{}))
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousMain, previousLog := common.MainDatabaseType(), common.LogDatabaseType()
	common.OptionMapRWMutex.Lock()
	previousOptions := common.OptionMap
	common.OptionMap = map[string]string{}
	common.OptionMapRWMutex.Unlock()
	model.DB, model.LOG_DB = database, database
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousMain, previousLog)
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousOptions
		common.OptionMapRWMutex.Unlock()
	})

	const other = `{"request_path":"/v1/chat/completions","public_id":9007199254740993,"admin_info":{"admin_id":9007199254740995},"root_info":{"generation":18446744073709551615},"response_model":{"requested_model":"requested","upstream_model":"requested","returned_model":"returned-canary","mismatch":true}}`
	historical := model.Log{UserId: 7, TokenId: 11, Type: model.LogTypeConsume, Other: other}
	require.NoError(t, database.Create(&historical).Error)

	for _, state := range []struct {
		name    string
		value   string
		enabled bool
	}{
		{name: "default", enabled: true},
		{name: "disabled", value: "false", enabled: false},
		{name: "re-enabled", value: "true", enabled: true},
	} {
		t.Run(state.name, func(t *testing.T) {
			if state.value != "" {
				require.NoError(t, model.UpdateOption(common.ResponseModelMismatchEnabledOptionKey, state.value))
				assert.Equal(t, state.enabled, common.IsResponseModelMismatchEnabled())
				var saved model.Option
				require.NoError(t, database.First(&saved, &model.Option{Key: common.ResponseModelMismatchEnabledOptionKey}).Error)
				assert.Equal(t, state.value, saved.Value)
			}
			// Startup must preserve the stored setting rather than resetting it to the default.
			model.InitOptionMap()
			assert.Equal(t, state.enabled, common.IsResponseModelMismatchEnabled())

			for _, endpoint := range []struct {
				name    string
				handler gin.HandlerFunc
				role    int
			}{
				{name: "user", handler: GetUserLogs, role: common.RoleCommonUser},
				{name: "admin", handler: GetAllLogs, role: common.RoleAdminUser},
				{name: "root", handler: GetAllLogs, role: common.RoleRootUser},
				{name: "token", handler: GetLogByKey, role: common.RoleCommonUser},
			} {
				t.Run(endpoint.name, func(t *testing.T) {
					recorder := httptest.NewRecorder()
					context, _ := gin.CreateTestContext(recorder)
					context.Request = httptest.NewRequest(http.MethodGet, "/api/log/", nil)
					context.Set("id", 7)
					context.Set("token_id", 11)
					context.Set("role", endpoint.role)
					endpoint.handler(context)
					require.Equal(t, http.StatusOK, recorder.Code)
					var response struct {
						Success bool            `json:"success"`
						Data    json.RawMessage `json:"data"`
					}
					require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
					require.True(t, response.Success, recorder.Body.String())
					var logs []model.Log
					if endpoint.name == "token" {
						require.NoError(t, common.Unmarshal(response.Data, &logs))
					} else {
						var page struct {
							Items []model.Log `json:"items"`
							Total int         `json:"total"`
						}
						require.NoError(t, common.Unmarshal(response.Data, &page))
						require.Equal(t, 1, page.Total)
						logs = page.Items
					}
					require.Len(t, logs, 1)
					var metadata map[string]json.RawMessage
					require.NoError(t, common.UnmarshalJsonStr(logs[0].Other, &metadata))
					if state.enabled {
						assert.JSONEq(t, `{"requested_model":"requested","upstream_model":"requested","returned_model":"returned-canary","mismatch":true}`, string(metadata["response_model"]))
					} else {
						assert.NotContains(t, metadata, "response_model")
						assert.NotContains(t, recorder.Body.String(), "returned-canary")
					}
					assert.Equal(t, `"/v1/chat/completions"`, string(metadata["request_path"]))
					assert.Equal(t, "9007199254740993", string(metadata["public_id"]))
					if endpoint.role >= common.RoleAdminUser {
						assert.Equal(t, `{"admin_id":9007199254740995}`, string(metadata["admin_info"]))
					} else {
						assert.NotContains(t, metadata, "admin_info")
					}
					if endpoint.role == common.RoleRootUser {
						assert.Equal(t, `{"generation":18446744073709551615}`, string(metadata["root_info"]))
					} else {
						assert.NotContains(t, metadata, "root_info")
					}
				})
			}
			var stored model.Log
			require.NoError(t, database.First(&stored, historical.Id).Error)
			assert.Equal(t, other, stored.Other)
		})
	}

	for _, invalid := range []string{"", "invalid", "TRUE", "T", "1", "0", "False", "F", " true", "false "} {
		t.Run("reject invalid option "+invalid, func(t *testing.T) {
			require.Error(t, model.UpdateOption(common.ResponseModelMismatchEnabledOptionKey, invalid))
			require.Error(t, model.UpdateOptionsBulk(map[string]string{common.ResponseModelMismatchEnabledOptionKey: invalid}))
			var stored model.Option
			require.NoError(t, database.First(&stored, &model.Option{Key: common.ResponseModelMismatchEnabledOptionKey}).Error)
			assert.Equal(t, "true", stored.Value)
			assert.True(t, common.IsResponseModelMismatchEnabled())
		})
	}
}

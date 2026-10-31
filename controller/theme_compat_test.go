package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpdateOptionRejectsRetiredFrontendTheme(t *testing.T) {
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = httptest.NewRequest(
		http.MethodPut,
		"/api/option/",
		strings.NewReader(`{"key":"theme.frontend","value":"classic"}`),
	)

	UpdateOption(context)

	assert.Equal(t, http.StatusOK, response.Code)
	assert.JSONEq(t, `{"success":false,"message":"The Classic frontend has been removed. The theme can only be set to default","message_key":"The Classic frontend has been removed. The theme can only be set to default"}`, response.Body.String())
}

func TestGetStatusAdvertisesDefaultDashboard(t *testing.T) {
	previousMap := common.OptionMap
	common.OptionMap = map[string]string{}
	t.Cleanup(func() { common.OptionMap = previousMap })
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)

	GetStatus(context)

	var payload struct {
		Success bool           `json:"success"`
		Data    map[string]any `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
	assert.True(t, payload.Success)
	assert.Equal(t, "default", payload.Data["theme"])
}

func TestGetStatusAdvertisesResponseModelMismatchSetting(t *testing.T) {
	common.OptionMapRWMutex.RLock()
	previousMap := common.OptionMap
	common.OptionMapRWMutex.RUnlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousMap
		common.OptionMapRWMutex.Unlock()
	})

	for _, test := range []struct {
		name     string
		value    string
		expected bool
	}{
		{name: "missing defaults enabled", value: "", expected: true},
		{name: "explicitly enabled", value: "true", expected: true},
		{name: "disabled", value: "false", expected: false},
		{name: "numeric false", value: "0", expected: false},
		{name: "invalid stored value", value: "invalid", expected: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			common.OptionMapRWMutex.Lock()
			if test.value == "" {
				common.OptionMap = map[string]string{}
			} else {
				common.OptionMap = map[string]string{
					common.ResponseModelMismatchEnabledOptionKey: test.value,
				}
			}
			common.OptionMapRWMutex.Unlock()

			response := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(response)
			context.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)
			GetStatus(context)

			var payload struct {
				Data map[string]any `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
			assert.Equal(t, test.expected, payload.Data["response_model_mismatch_enabled"])
		})
	}
}

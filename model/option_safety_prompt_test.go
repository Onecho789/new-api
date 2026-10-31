package model

import (
	"strconv"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 安全提示词由前端以 safety_prompt.* 两个扁平键写入，必须能落到内存配置上，
// 否则保存后转发链路读不到新值。
func TestHandleConfigUpdateAppliesSafetyPrompt(t *testing.T) {
	settings := system_setting.GetSafetyPromptSettings()
	originalEnabled, originalPrompt := settings.Enabled, settings.Prompt
	t.Cleanup(func() {
		settings.Enabled, settings.Prompt = originalEnabled, originalPrompt
	})

	require.True(t, handleConfigUpdate(system_setting.SafetyPromptOptionKey, "custom rules"))
	require.True(t, handleConfigUpdate("safety_prompt.enabled", strconv.FormatBool(true)))

	assert.Equal(t, "custom rules", settings.Prompt)
	assert.True(t, settings.Enabled)
	assert.Equal(t, "custom rules", system_setting.GetEnabledSafetyPrompt())

	require.True(t, handleConfigUpdate("safety_prompt.enabled", strconv.FormatBool(false)))
	assert.Empty(t, system_setting.GetEnabledSafetyPrompt())
}

// 提示词会随每个请求发往上游，超长值必须在保存时被拒绝。
func TestValidateOptionValueRejectsOversizedSafetyPrompt(t *testing.T) {
	atLimit := strings.Repeat("好", system_setting.MaxSafetyPromptRunes)
	require.NoError(t, validateOptionValue(system_setting.SafetyPromptOptionKey, atLimit))

	assert.Error(t, validateOptionValue(system_setting.SafetyPromptOptionKey, atLimit+"好"))
}

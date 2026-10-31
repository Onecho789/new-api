package service

import (
	"testing"

	"github.com/QuantumNous/new-api/setting"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// setSensitiveWords 覆盖全局敏感词表，并在测试结束后恢复。
func setSensitiveWords(t *testing.T, words []string) {
	t.Helper()
	original := setting.SensitiveWords
	setting.SensitiveWords = words
	t.Cleanup(func() {
		setting.SensitiveWords = original
	})
}

// 敏感词命中判定是拦截入口的依据：漏判会让配置静默失效，
// 误判会拦掉正常请求，两个方向都必须锁住。
func TestCheckSensitiveText(t *testing.T) {
	tests := []struct {
		name      string
		words     []string
		text      string
		wantHit   bool
		wantWords []string
	}{
		{
			name:      "exact match",
			words:     []string{"test_sensitive"},
			text:      "这是一个 test_sensitive 的请求",
			wantHit:   true,
			wantWords: []string{"test_sensitive"},
		},
		{
			name:      "case insensitive match",
			words:     []string{"test_sensitive"},
			text:      "TEST_SENSITIVE",
			wantHit:   true,
			wantWords: []string{"test_sensitive"},
		},
		{
			name:      "chinese word match",
			words:     []string{"敏感词"},
			text:      "请求里带了敏感词",
			wantHit:   true,
			wantWords: []string{"敏感词"},
		},
		{
			name:    "no match",
			words:   []string{"test_sensitive"},
			text:    "一个完全正常的请求",
			wantHit: false,
		},
		{
			name:    "empty word list never blocks",
			words:   []string{},
			text:    "test_sensitive",
			wantHit: false,
		},
		{
			name:    "empty text never blocks",
			words:   []string{"test_sensitive"},
			text:    "",
			wantHit: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setSensitiveWords(t, tt.words)

			contains, words := CheckSensitiveText(tt.text)

			assert.Equal(t, tt.wantHit, contains)
			if tt.wantHit {
				require.NotEmpty(t, words)
				assert.Equal(t, tt.wantWords, words)
				return
			}
			assert.Empty(t, words)
		})
	}
}

// 两个开关都必须为真才扫描提示词：关掉任意一个都不应触发检查，
// 否则界面上的开关与实际行为不一致。
func TestShouldCheckPromptSensitive(t *testing.T) {
	originalEnabled := setting.CheckSensitiveEnabled
	originalOnPrompt := setting.CheckSensitiveOnPromptEnabled
	t.Cleanup(func() {
		setting.CheckSensitiveEnabled = originalEnabled
		setting.CheckSensitiveOnPromptEnabled = originalOnPrompt
	})

	tests := []struct {
		name     string
		enabled  bool
		onPrompt bool
		want     bool
	}{
		{name: "both enabled", enabled: true, onPrompt: true, want: true},
		{name: "filtering disabled", enabled: false, onPrompt: true, want: false},
		{name: "prompt scan disabled", enabled: true, onPrompt: false, want: false},
		{name: "both disabled", enabled: false, onPrompt: false, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setting.CheckSensitiveEnabled = tt.enabled
			setting.CheckSensitiveOnPromptEnabled = tt.onPrompt

			assert.Equal(t, tt.want, setting.ShouldCheckPromptSensitive())
		})
	}
}

package relay

import (
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/relayconvert"
	"github.com/QuantumNous/new-api/setting/model_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	testSafetyPrompt  = "SAFETY-RULES"
	testChannelPrompt = "CHANNEL-PROMPT"
)

// setSafetyPrompt 覆盖全局安全提示词配置，并在测试结束后恢复，避免污染其它用例。
func setSafetyPrompt(t *testing.T, enabled bool, prompt string) {
	t.Helper()
	settings := system_setting.GetSafetyPromptSettings()
	originalEnabled, originalPrompt := settings.Enabled, settings.Prompt
	settings.Enabled, settings.Prompt = enabled, prompt
	t.Cleanup(func() {
		settings.Enabled, settings.Prompt = originalEnabled, originalPrompt
	})
}

func newSystemPromptTestContext(t *testing.T) *gin.Context {
	t.Helper()
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	return c
}

func newRelayInfoWithChannelPrompt(channelPrompt string, override bool) *relaycommon.RelayInfo {
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}}
	info.ChannelSetting.SystemPrompt = channelPrompt
	info.ChannelSetting.SystemPromptOverride = override
	return info
}

// 安全提示词必须无条件注入：客户端自带 system 消息时也不能被绕过，
// 这是它与渠道级 SystemPrompt（受 SystemPromptOverride 控制）的核心区别。
func TestApplySystemPromptOpenAIChat(t *testing.T) {
	tests := []struct {
		name           string
		safetyEnabled  bool
		channelPrompt  string
		override       bool
		clientMessages []dto.Message
		wantSystem     string
		wantMessageLen int
	}{
		{
			name:           "safety only, no client system message",
			safetyEnabled:  true,
			clientMessages: []dto.Message{{Role: "user", Content: "hi"}},
			wantSystem:     testSafetyPrompt,
			wantMessageLen: 2,
		},
		{
			name:           "safety injected even when client sends system message and override is off",
			safetyEnabled:  true,
			clientMessages: []dto.Message{{Role: "system", Content: "client rules"}, {Role: "user", Content: "hi"}},
			wantSystem:     testSafetyPrompt + "\nclient rules",
			wantMessageLen: 2,
		},
		{
			name:           "safety before channel prompt when both apply",
			safetyEnabled:  true,
			channelPrompt:  testChannelPrompt,
			clientMessages: []dto.Message{{Role: "user", Content: "hi"}},
			wantSystem:     testSafetyPrompt + "\n" + testChannelPrompt,
			wantMessageLen: 2,
		},
		{
			name:           "channel prompt skipped without override, safety still prepended",
			safetyEnabled:  true,
			channelPrompt:  testChannelPrompt,
			clientMessages: []dto.Message{{Role: "system", Content: "client rules"}, {Role: "user", Content: "hi"}},
			wantSystem:     testSafetyPrompt + "\nclient rules",
			wantMessageLen: 2,
		},
		{
			name:           "channel prompt merged with override, ordered after safety",
			safetyEnabled:  true,
			channelPrompt:  testChannelPrompt,
			override:       true,
			clientMessages: []dto.Message{{Role: "system", Content: "client rules"}, {Role: "user", Content: "hi"}},
			wantSystem:     testSafetyPrompt + "\n" + testChannelPrompt + "\nclient rules",
			wantMessageLen: 2,
		},
		{
			name:           "safety disabled keeps legacy channel-only behaviour",
			channelPrompt:  testChannelPrompt,
			clientMessages: []dto.Message{{Role: "user", Content: "hi"}},
			wantSystem:     testChannelPrompt,
			wantMessageLen: 2,
		},
		{
			name:           "nothing configured leaves request untouched",
			clientMessages: []dto.Message{{Role: "user", Content: "hi"}},
			wantSystem:     "",
			wantMessageLen: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setSafetyPrompt(t, tt.safetyEnabled, testSafetyPrompt)
			c := newSystemPromptTestContext(t)
			info := newRelayInfoWithChannelPrompt(tt.channelPrompt, tt.override)
			request := &dto.GeneralOpenAIRequest{Model: "gpt-4o", Messages: tt.clientMessages}

			applySystemPromptIfNeeded(c, info, request)

			require.Len(t, request.Messages, tt.wantMessageLen)
			if tt.wantSystem == "" {
				assert.Equal(t, "user", request.Messages[0].Role)
				return
			}
			assert.Equal(t, "system", request.Messages[0].Role)
			assert.Equal(t, tt.wantSystem, request.Messages[0].StringContent())
		})
	}
}

// 多模态 system 消息（content 为数组）必须同样被前置，否则数组形式即可绕过安全提示词。
func TestApplySystemPromptOpenAIChatMultimodalSystemMessage(t *testing.T) {
	setSafetyPrompt(t, true, testSafetyPrompt)
	c := newSystemPromptTestContext(t)
	info := newRelayInfoWithChannelPrompt("", false)
	// 从原始 JSON 解析，保持与真实请求一致的 content 结构（[]any）。
	request := &dto.GeneralOpenAIRequest{}
	require.NoError(t, common.UnmarshalJsonStr(`{
		"model": "gpt-4o",
		"messages": [
			{"role": "system", "content": [{"type": "text", "text": "client rules"}]},
			{"role": "user", "content": "hi"}
		]
	}`, request))

	applySystemPromptIfNeeded(c, info, request)

	contents := request.Messages[0].ParseContent()
	require.Len(t, contents, 2)
	assert.Equal(t, testSafetyPrompt, contents[0].Text)
	assert.Equal(t, "client rules", contents[1].Text)
}

// content 结构无法解析成媒体列表时，不能改写或丢弃客户端内容，
// 安全提示词应作为独立的 system 消息插入其前面。
func TestApplySystemPromptOpenAIChatUnparsableSystemContent(t *testing.T) {
	setSafetyPrompt(t, true, testSafetyPrompt)
	c := newSystemPromptTestContext(t)
	info := newRelayInfoWithChannelPrompt("", false)
	systemMessage := dto.Message{Role: "system"}
	systemMessage.Content = map[string]any{"unexpected": "shape"}
	request := &dto.GeneralOpenAIRequest{
		Model:    "gpt-4o",
		Messages: []dto.Message{systemMessage, {Role: "user", Content: "hi"}},
	}

	applySystemPromptIfNeeded(c, info, request)

	require.Len(t, request.Messages, 3)
	assert.Equal(t, "system", request.Messages[0].Role)
	assert.Equal(t, testSafetyPrompt, request.Messages[0].StringContent())
	assert.Equal(t, "system", request.Messages[1].Role)
	assert.Equal(t, map[string]any{"unexpected": "shape"}, request.Messages[1].Content)
	assert.Equal(t, "user", request.Messages[2].Role)
}

// GPT-5 / o 系列的系统角色是 developer，注入必须识别该角色，
// 否则会插入一条重复的 system 消息。
func TestApplySystemPromptOpenAIChatDeveloperRole(t *testing.T) {
	setSafetyPrompt(t, true, testSafetyPrompt)
	c := newSystemPromptTestContext(t)
	info := newRelayInfoWithChannelPrompt("", false)
	request := &dto.GeneralOpenAIRequest{
		Model:    "gpt-5",
		Messages: []dto.Message{{Role: "developer", Content: "client rules"}, {Role: "user", Content: "hi"}},
	}

	applySystemPromptIfNeeded(c, info, request)

	require.Len(t, request.Messages, 2)
	assert.Equal(t, "developer", request.Messages[0].Role)
	assert.Equal(t, testSafetyPrompt+"\nclient rules", request.Messages[0].StringContent())
}

func TestApplyResponsesSystemPrompt(t *testing.T) {
	tests := []struct {
		name             string
		safetyEnabled    bool
		channelPrompt    string
		override         bool
		instructions     string
		wantInstructions string
	}{
		{
			name:             "safety injected when instructions absent",
			safetyEnabled:    true,
			wantInstructions: testSafetyPrompt,
		},
		{
			name:             "safety prepended to existing instructions",
			safetyEnabled:    true,
			instructions:     `"client rules"`,
			wantInstructions: testSafetyPrompt + "\nclient rules",
		},
		{
			name:             "safety replaces blank instructions",
			safetyEnabled:    true,
			instructions:     `"   "`,
			wantInstructions: testSafetyPrompt,
		},
		{
			name:             "channel prompt merged after safety with override",
			safetyEnabled:    true,
			channelPrompt:    testChannelPrompt,
			override:         true,
			instructions:     `"client rules"`,
			wantInstructions: testSafetyPrompt + "\n" + testChannelPrompt + "\nclient rules",
		},
		{
			name:             "safety disabled keeps channel-only behaviour",
			channelPrompt:    testChannelPrompt,
			wantInstructions: testChannelPrompt,
		},
		{
			name:             "nothing configured leaves instructions untouched",
			instructions:     `"client rules"`,
			wantInstructions: "client rules",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setSafetyPrompt(t, tt.safetyEnabled, testSafetyPrompt)
			c := newSystemPromptTestContext(t)
			info := newRelayInfoWithChannelPrompt(tt.channelPrompt, tt.override)
			request := &dto.OpenAIResponsesRequest{Model: "gpt-5"}
			if tt.instructions != "" {
				request.Instructions = []byte(tt.instructions)
			}

			require.NoError(t, applyResponsesSystemPromptIfNeeded(c, info, request))

			if tt.wantInstructions == "" {
				assert.Empty(t, request.Instructions)
				return
			}
			var got string
			require.NoError(t, common.Unmarshal(request.Instructions, &got))
			assert.Equal(t, tt.wantInstructions, got)
		})
	}
}

// Claude 原生请求的 system 既可以是字符串也可以是内容块数组，两种形态都不能被绕过。
func TestApplyClaudeSystemPrompt(t *testing.T) {
	tests := []struct {
		name          string
		safetyEnabled bool
		channelPrompt string
		override      bool
		system        any
		wantSystem    string
	}{
		{
			name:          "safety injected when system absent",
			safetyEnabled: true,
			wantSystem:    testSafetyPrompt,
		},
		{
			name:          "safety prepended to string system",
			safetyEnabled: true,
			system:        "client rules",
			wantSystem:    testSafetyPrompt + "\nclient rules",
		},
		{
			name:          "safety replaces blank string system",
			safetyEnabled: true,
			system:        "   ",
			wantSystem:    testSafetyPrompt,
		},
		{
			name:          "channel prompt skipped without override",
			safetyEnabled: true,
			channelPrompt: testChannelPrompt,
			system:        "client rules",
			wantSystem:    testSafetyPrompt + "\nclient rules",
		},
		{
			name:          "channel prompt merged after safety with override",
			safetyEnabled: true,
			channelPrompt: testChannelPrompt,
			override:      true,
			system:        "client rules",
			wantSystem:    testSafetyPrompt + "\n" + testChannelPrompt + "\nclient rules",
		},
		{
			name:          "safety disabled keeps channel-only behaviour",
			channelPrompt: testChannelPrompt,
			wantSystem:    testChannelPrompt,
		},
		{
			name:       "nothing configured leaves system untouched",
			system:     "client rules",
			wantSystem: "client rules",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setSafetyPrompt(t, tt.safetyEnabled, testSafetyPrompt)
			c := newSystemPromptTestContext(t)
			info := newRelayInfoWithChannelPrompt(tt.channelPrompt, tt.override)
			request := &dto.ClaudeRequest{Model: "claude-sonnet-4-5", System: tt.system}

			applyClaudeSystemPromptIfNeeded(c, info, request)

			if tt.wantSystem == "" {
				assert.Nil(t, request.System)
				return
			}
			require.True(t, request.IsStringSystem())
			assert.Equal(t, tt.wantSystem, request.GetStringSystem())
		})
	}
}

// system 为内容块数组时，安全提示词必须作为独立的首个文本块插入，
// 且不能丢掉客户端原有的块（例如带 cache_control 的块）。
func TestApplyClaudeSystemPromptBlockArray(t *testing.T) {
	setSafetyPrompt(t, true, testSafetyPrompt)
	c := newSystemPromptTestContext(t)
	info := newRelayInfoWithChannelPrompt("", false)
	request := &dto.ClaudeRequest{Model: "claude-sonnet-4-5"}
	// 从原始 JSON 解析，保持与真实请求一致的 system 结构。
	require.NoError(t, common.UnmarshalJsonStr(`{
		"model": "claude-sonnet-4-5",
		"system": [{"type": "text", "text": "client rules"}]
	}`, request))

	applyClaudeSystemPromptIfNeeded(c, info, request)

	blocks := request.ParseSystem()
	require.Len(t, blocks, 2)
	assert.Equal(t, dto.ContentTypeText, blocks[0].Type)
	assert.Equal(t, testSafetyPrompt, blocks[0].GetText())
	assert.Equal(t, "client rules", blocks[1].GetText())
}

// Gemini 的 systemInstruction 由多个 part 组成，注入要落在第一个非空文本 part 上。
func TestApplyGeminiSystemPrompt(t *testing.T) {
	tests := []struct {
		name          string
		safetyEnabled bool
		channelPrompt string
		override      bool
		instructions  *dto.GeminiChatContent
		wantParts     []string
	}{
		{
			name:          "safety injected when system instruction absent",
			safetyEnabled: true,
			wantParts:     []string{testSafetyPrompt},
		},
		{
			name:          "safety injected when parts empty",
			safetyEnabled: true,
			instructions:  &dto.GeminiChatContent{},
			wantParts:     []string{testSafetyPrompt},
		},
		{
			name:          "safety prepended to first part",
			safetyEnabled: true,
			instructions: &dto.GeminiChatContent{
				Parts: []dto.GeminiPart{{Text: "client rules"}, {Text: "more rules"}},
			},
			wantParts: []string{testSafetyPrompt + "\nclient rules", "more rules"},
		},
		{
			name:          "safety prepended to first non-empty part",
			safetyEnabled: true,
			instructions: &dto.GeminiChatContent{
				Parts: []dto.GeminiPart{{}, {Text: "client rules"}},
			},
			wantParts: []string{"", testSafetyPrompt + "\nclient rules"},
		},
		{
			name:          "channel prompt merged after safety with override",
			safetyEnabled: true,
			channelPrompt: testChannelPrompt,
			override:      true,
			instructions: &dto.GeminiChatContent{
				Parts: []dto.GeminiPart{{Text: "client rules"}},
			},
			wantParts: []string{testSafetyPrompt + "\n" + testChannelPrompt + "\nclient rules"},
		},
		{
			name:          "safety disabled keeps channel-only behaviour",
			channelPrompt: testChannelPrompt,
			wantParts:     []string{testChannelPrompt},
		},
		{
			name: "nothing configured leaves parts untouched",
			instructions: &dto.GeminiChatContent{
				Parts: []dto.GeminiPart{{Text: "client rules"}},
			},
			wantParts: []string{"client rules"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setSafetyPrompt(t, tt.safetyEnabled, testSafetyPrompt)
			c := newSystemPromptTestContext(t)
			info := newRelayInfoWithChannelPrompt(tt.channelPrompt, tt.override)
			request := &dto.GeminiChatRequest{SystemInstructions: tt.instructions}

			applyGeminiSystemPromptIfNeeded(c, info, request)

			if len(tt.wantParts) == 0 {
				assert.Nil(t, request.SystemInstructions)
				return
			}
			require.NotNil(t, request.SystemInstructions)
			gotParts := make([]string, 0, len(request.SystemInstructions.Parts))
			for _, part := range request.SystemInstructions.Parts {
				gotParts = append(gotParts, part.Text)
			}
			assert.Equal(t, tt.wantParts, gotParts)
		})
	}
}

// 所有 part 都没有文本时（例如只带内联数据），必须新增文本 part 而不是静默丢弃注入。
func TestApplyGeminiSystemPromptWithoutTextParts(t *testing.T) {
	setSafetyPrompt(t, true, testSafetyPrompt)
	c := newSystemPromptTestContext(t)
	info := newRelayInfoWithChannelPrompt("", false)
	request := &dto.GeminiChatRequest{
		SystemInstructions: &dto.GeminiChatContent{
			Parts: []dto.GeminiPart{{InlineData: &dto.GeminiInlineData{MimeType: "image/png", Data: "abc"}}},
		},
	}

	applyGeminiSystemPromptIfNeeded(c, info, request)

	require.Len(t, request.SystemInstructions.Parts, 2)
	assert.Equal(t, testSafetyPrompt, request.SystemInstructions.Parts[0].Text)
	assert.NotNil(t, request.SystemInstructions.Parts[1].InlineData)
}

// 透传模式下上游收到的是客户端原始请求体，注入不会生效，
// 因此既不能改写请求，也不能留下"已注入"的日志标记。
func TestApplySystemPromptSkippedWhenPassThrough(t *testing.T) {
	t.Run("channel level pass through", func(t *testing.T) {
		setSafetyPrompt(t, true, testSafetyPrompt)
		c := newSystemPromptTestContext(t)
		info := newRelayInfoWithChannelPrompt(testChannelPrompt, true)
		info.ChannelSetting.PassThroughBodyEnabled = true
		request := &dto.GeneralOpenAIRequest{
			Model:    "gpt-4o",
			Messages: []dto.Message{{Role: "user", Content: "hi"}},
		}

		applySystemPromptIfNeeded(c, info, request)

		require.Len(t, request.Messages, 1)
		assert.Equal(t, "user", request.Messages[0].Role)
		assert.False(t, common.GetContextKeyBool(c, constant.ContextKeySafetyPromptInjected))
		assert.False(t, common.GetContextKeyBool(c, constant.ContextKeySystemPromptOverride))
	})

	t.Run("global pass through", func(t *testing.T) {
		setSafetyPrompt(t, true, testSafetyPrompt)
		globalSettings := model_setting.GetGlobalSettings()
		originalPassThrough := globalSettings.PassThroughRequestEnabled
		globalSettings.PassThroughRequestEnabled = true
		t.Cleanup(func() {
			globalSettings.PassThroughRequestEnabled = originalPassThrough
		})

		c := newSystemPromptTestContext(t)
		info := newRelayInfoWithChannelPrompt("", false)
		request := &dto.ClaudeRequest{Model: "claude-sonnet-4-5"}

		applyClaudeSystemPromptIfNeeded(c, info, request)

		assert.Nil(t, request.System)
		assert.False(t, common.GetContextKeyBool(c, constant.ContextKeySafetyPromptInjected))
	})
}

// 注入安全提示词要在日志中留痕，且不能误报渠道级覆盖标记。
func TestSystemPromptInjectionContextMarkers(t *testing.T) {
	t.Run("safety only does not mark channel override", func(t *testing.T) {
		setSafetyPrompt(t, true, testSafetyPrompt)
		c := newSystemPromptTestContext(t)
		info := newRelayInfoWithChannelPrompt("", false)
		request := &dto.GeneralOpenAIRequest{
			Model:    "gpt-4o",
			Messages: []dto.Message{{Role: "system", Content: "client rules"}, {Role: "user", Content: "hi"}},
		}

		applySystemPromptIfNeeded(c, info, request)

		assert.True(t, common.GetContextKeyBool(c, constant.ContextKeySafetyPromptInjected))
		assert.False(t, common.GetContextKeyBool(c, constant.ContextKeySystemPromptOverride))
	})

	t.Run("channel override marked when channel prompt merged", func(t *testing.T) {
		setSafetyPrompt(t, false, testSafetyPrompt)
		c := newSystemPromptTestContext(t)
		info := newRelayInfoWithChannelPrompt(testChannelPrompt, true)
		request := &dto.GeneralOpenAIRequest{
			Model:    "gpt-4o",
			Messages: []dto.Message{{Role: "system", Content: "client rules"}, {Role: "user", Content: "hi"}},
		}

		applySystemPromptIfNeeded(c, info, request)

		assert.False(t, common.GetContextKeyBool(c, constant.ContextKeySafetyPromptInjected))
		assert.True(t, common.GetContextKeyBool(c, constant.ContextKeySystemPromptOverride))
	})

	t.Run("no injection leaves both markers unset", func(t *testing.T) {
		setSafetyPrompt(t, false, testSafetyPrompt)
		c := newSystemPromptTestContext(t)
		info := newRelayInfoWithChannelPrompt("", false)
		request := &dto.GeneralOpenAIRequest{
			Model:    "gpt-4o",
			Messages: []dto.Message{{Role: "user", Content: "hi"}},
		}

		applySystemPromptIfNeeded(c, info, request)

		assert.False(t, common.GetContextKeyBool(c, constant.ContextKeySafetyPromptInjected))
		assert.False(t, common.GetContextKeyBool(c, constant.ContextKeySystemPromptOverride))
	})
}

// HTTP、WebSocket 和 Responses 转 Chat 共用的准备流程都应只注入一次，
// 同时保留模型修饰符的转换结果，并保持重试请求的原始指令完整。
func TestPrepareResponsesRequestSystemPrompt(t *testing.T) {
	for _, transport := range []string{"http", "websocket", "chat conversion", "codex"} {
		t.Run(transport, func(t *testing.T) {
			setSafetyPrompt(t, true, testSafetyPrompt)
			c := newSystemPromptTestContext(t)
			c.Request = httptest.NewRequest("POST", "/v1/responses", nil)
			request := &dto.OpenAIResponsesRequest{
				Model:        "gpt-5.1@effort:high",
				Instructions: []byte(`"client rules"`),
				Input:        []byte(`"hello"`),
			}
			common.SetContextKey(c, constant.ContextKeyOriginalModel, request.Model)
			common.SetContextKey(c, constant.ContextKeyChannelType, constant.ChannelTypeOpenAI)
			common.SetContextKey(c, constant.ContextKeyChannelSetting, dto.ChannelSettings{
				SystemPrompt: testChannelPrompt, SystemPromptOverride: true,
			})
			if transport == "codex" {
				common.SetContextKey(c, constant.ContextKeyChannelType, constant.ChannelTypeCodex)
			}
			if transport == "chat conversion" {
				common.SetContextKey(c, constant.ContextKeyChannelType, constant.ChannelTypeAdvancedCustom)
				common.SetContextKey(c, constant.ContextKeyChannelOtherSetting, dto.ChannelOtherSettings{
					AdvancedCustom: &dto.AdvancedCustomConfig{Routes: []dto.AdvancedCustomRoute{{
						IncomingPath: "/v1/responses", UpstreamPath: "/v1/chat/completions",
						Converter: relayconvert.ConverterOpenAIResponsesToOpenAIChat,
					}}},
				})
			}
			info := relaycommon.GenRelayInfoResponses(c, request)
			for range 2 {
				var payload []byte
				if transport == "websocket" {
					body, relayErr := buildResponsesWSCreatePayload(c, info, *request, nil, "")
					require.Nil(t, relayErr)
					payload = body
				} else {
					_, body, closer, apiErr := PrepareResponsesRequest(c, info, request)
					require.Nil(t, apiErr)
					var err error
					payload, err = io.ReadAll(body)
					require.NoError(t, err)
					require.NoError(t, closer.Close())
				}
				want := testSafetyPrompt + "\n" + testChannelPrompt + "\nclient rules"
				if transport == "chat conversion" {
					var outbound dto.GeneralOpenAIRequest
					require.NoError(t, common.Unmarshal(payload, &outbound))
					require.Len(t, outbound.Messages, 2)
					assert.Equal(t, want, outbound.Messages[0].StringContent())
					assert.Equal(t, "high", outbound.ReasoningEffort)
					assert.Equal(t, "gpt-5.1", outbound.Model)
				} else {
					var outbound dto.OpenAIResponsesRequest
					require.NoError(t, common.Unmarshal(payload, &outbound))
					var instructions string
					require.NoError(t, common.Unmarshal(outbound.Instructions, &instructions))
					assert.Equal(t, want, instructions)
					require.NotNil(t, outbound.Reasoning)
					assert.Equal(t, "high", outbound.Reasoning.Effort)
					assert.Equal(t, "gpt-5.1", outbound.Model)
				}
				assert.JSONEq(t, `"client rules"`, string(request.Instructions))
				assert.True(t, common.GetContextKeyBool(c, constant.ContextKeySafetyPromptInjected))
			}
		})
	}
}

func TestPrepareResponsesRequestPassThroughSkipsSystemPrompt(t *testing.T) {
	for _, global := range []bool{false, true} {
		name := "channel"
		if global {
			name = "global"
		}
		t.Run(name, func(t *testing.T) {
			setSafetyPrompt(t, true, testSafetyPrompt)
			settings := model_setting.GetGlobalSettings()
			original := settings.PassThroughRequestEnabled
			settings.PassThroughRequestEnabled = global
			t.Cleanup(func() { settings.PassThroughRequestEnabled = original })
			const raw = `{"model":"gpt-5.1","input":"hello","instructions":"client rules","vendor_field":true}`
			c := newSystemPromptTestContext(t)
			c.Request = httptest.NewRequest("POST", "/v1/responses", strings.NewReader(raw))
			c.Request.Header.Set("Content-Type", "application/json")
			common.SetContextKey(c, constant.ContextKeyOriginalModel, "gpt-5.1")
			common.SetContextKey(c, constant.ContextKeyChannelType, constant.ChannelTypeOpenAI)
			common.SetContextKey(c, constant.ContextKeyChannelSetting, dto.ChannelSettings{
				SystemPrompt: testChannelPrompt, SystemPromptOverride: true, PassThroughBodyEnabled: !global,
			})
			var request dto.OpenAIResponsesRequest
			require.NoError(t, common.UnmarshalJsonStr(raw, &request))
			info := relaycommon.GenRelayInfoResponses(c, &request)
			_, body, closer, apiErr := PrepareResponsesRequest(c, info, &request)
			require.Nil(t, apiErr)
			payload, err := io.ReadAll(body)
			require.NoError(t, err)
			require.NoError(t, closer.Close())
			assert.Equal(t, raw, string(payload))
			assert.False(t, common.GetContextKeyBool(c, constant.ContextKeySafetyPromptInjected))
			assert.False(t, common.GetContextKeyBool(c, constant.ContextKeySystemPromptOverride))
			storage, err := common.GetBodyStorage(c)
			require.NoError(t, err)
			require.NoError(t, storage.Close())
		})
	}
}
